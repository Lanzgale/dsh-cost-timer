/**
 * dsh-cost-timer — 会话日志扫描（host 侧）。
 *
 * 用途：把"账本"从「拦截 llm/stream 记录」改成「扫会话日志重建」之后，这个模块
 * 就是唯一的记账来源。日志里每次模型调用都带 usage 与毫秒时间戳（峰谷价能精确
 * 还原），并且天然覆盖插件安装之前的历史。
 *
 * 口径（与旧账本对齐，2026-11-19 实测：2026-10-05 起逐日金额/调用数完全一致）：
 *  - `assistant/message` 的 `data.usage`：主对话调用（usage 与 stream 是 data 的
 *    兄弟字段，**不在 message 里**）；
 *  - `compaction/summary` 的 `data.usage`：压缩调用，真实扣费，必须计入；
 *  - 标题生成（`session/title-llm-request`）**不计**——日志里没有 usage，且量级
 *    约 0.00005 美元/次、每月几次，忽略。
 *
 * 去重：同一会话可能同时有 `session.jsonl.zstd`（旧）与 `session.v3.jsonl.zstd`
 * （新），**优先 v3**，没有 v3 才读旧格式，避免同一会话算两遍。
 *
 * 增量：按文件 `size + mtime` 指纹；文件没变就跳过（进度记录在账本 `scan` 段）。
 * 逐次明细不落盘，只落日/会话聚合。
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Ledger, localDayKey } from './store.js'

/** zstd 帧魔数（小端）。 */
const ZSTD_MAGIC = 0xfd2fb528

/**
 * 扫描 zstd 多帧文件，返回每帧的字节区间；末尾不完整的帧记为 `tornStart`（丢弃）。
 * 与 `scripts/dsh-session-dump.mjs` 同一套逻辑（那里是给人用的命令行工具）。
 * @param buffer - 整个文件的字节。
 * @returns {{frames: {start: number, end: number}[], tornStart?: number}} 帧区间。
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error('bad magic at ' + offset)
    offset += 4
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error('reserved frame-header bit')
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error('reserved block type')
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames, tornStart: undefined }
}

/**
 * 枚举所有会话日志，每个会话只取一份（v3 优先）。
 * @param sessionsDir - `$DSH_HOME/sessions`。
 * @returns {{sessionId: string, file: string, size: number}[]} 会话日志清单。
 */
export function listSessionLogs(sessionsDir) {
  const out = []
  let groups
  try {
    groups = readdirSync(sessionsDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const group of groups) {
    if (!group.isDirectory()) continue
    const groupDir = join(sessionsDir, group.name)
    let entries
    try {
      entries = readdirSync(groupDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(groupDir, entry.name)
      const v3 = join(dir, 'session.v3.jsonl.zstd')
      const legacy = join(dir, 'session.jsonl.zstd')
      const file = existsSync(v3) ? v3 : existsSync(legacy) ? legacy : null
      if (file === null) continue
      let size = 0
      try {
        size = readFileSync(file).length
      } catch {
        continue
      }
      // 目录名兜底用原样 id（**不要剥 `session-` 前缀**：客户端传的会话 id 带前缀，
      // 剥了会让「今日当前会话」匹配不到自己那一行）。
      const id = basename(dir)
      out.push({ sessionId: id, file, size })
    }
  }
  return out
}

/**
 * 读一个会话日志，回调每一个计费事件。
 * @param file - 日志绝对路径。
 * @param onEvent - 收到 {at, provider, model, usage} 时调用。
 * @returns {{sessionId: string|null, events: number, skipped: number, torn: boolean}} 统计。
 */
export function scanSessionLog(file, onEvent) {
  const buf = readFileSync(file)
  const { frames, tornStart } = scanZstdFrames(buf)
  let sessionId = null
  let events = 0
  let skipped = 0
  for (const frame of frames) {
    let text
    try {
      text = zstdDecompressSync(buf.subarray(frame.start, frame.end)).toString('utf8')
    } catch {
      skipped += 1
      continue
    }
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      // 字节级过滤：只有带 usage 的行才值得解析。
      if (!line.includes('"usage"')) {
        if (sessionId === null && line.includes('"type":"session"')) {
          try { sessionId = JSON.parse(line)?.id ?? null } catch { skipped += 1 }
        }
        continue
      }
      let ev
      try { ev = JSON.parse(line) } catch { skipped += 1; continue }
      if (ev?.type === 'assistant/message') {
        const usage = ev.data?.usage ?? ev.data?.message?.usage
        if (usage === undefined || usage === null) continue
        const src = ev.data?.message?.source ?? ev.data?.source
        onEvent({
          at: ev.time,
          sessionId,
          provider: src?.provider,
          model: src?.model,
          usage: {
            input: usage.inputTokens,
            output: usage.outputTokens,
            cacheRead: usage.cacheReadTokens,
            cacheWrite: usage.cacheWriteTokens,
            reasoning: usage.reasoningTokens,
          },
        })
        events += 1
      } else if (ev?.type === 'compaction/summary') {
        const usage = ev.data?.usage
        if (usage === undefined || usage === null) continue
        onEvent({
          at: ev.time,
          sessionId,
          provider: ev.data?.provider,
          model: ev.data?.model,
          usage: {
            input: usage.inputTokens,
            output: usage.outputTokens,
            cacheRead: usage.cacheReadTokens,
            cacheWrite: usage.cacheWriteTokens,
            reasoning: usage.reasoningTokens,
          },
        })
        events += 1
      }
    }
  }
  return { sessionId, events, skipped, torn: tornStart !== undefined }
}

/**
 * 从会话日志重建整本账（不落盘，交给调用方决定）。
 *
 * 计费完全走 `Ledger.account()`，与线上拦截口径同源（价格表/峰谷/节假日/汇率）。
 * @param options - {config, holidays, path, migrations, sessionsDir?, since?, progress?}
 *   `since` 为 `YYYY-MM-DD`，早于它的日期直接丢弃（增量重扫时用）。
 * @returns {{ledger: Ledger, meta: {at: number, files: number, events: number, skipped: number, torn: number}}}。
 */
export function rebuildFromLogs(options) {
  const sessionsDir = options.sessionsDir ?? join(resolveDshHome(), 'sessions')
  // 用临时路径：Ledger 会按 path 的目录做 mkdir，传伪路径会在工作目录里造出 `scan:/`。
  const scanPath = options.path ?? join(tmpdir(), 'dsh-cost-timer-scan', 'ledger.json')
  const scan = new Ledger(options.config, {}, scanPath, options.migrations ?? [], options.holidays ?? null)
  let files = 0
  let events = 0
  let skipped = 0
  let torn = 0
  for (const session of listSessionLogs(sessionsDir)) {
    const stats = scanSessionLog(session.file, ev => {
      if (!Number.isFinite(ev.at)) return
      if (options.since !== undefined && localDayKey(ev.at) < options.since) return
      scan.account(ev.usage, ev.model, ev.sessionId ?? session.sessionId, ev.at, ev.provider)
      events += 1
    })
    files += 1
    skipped += stats.skipped
    if (stats.torn) torn += 1
    if (typeof options.progress === 'function') {
      options.progress({ file: session.file, sessionId: session.sessionId, events: stats.events })
    }
  }
  return {
    ledger: scan,
    meta: { at: Date.now(), files, events, skipped, torn },
  }
}
