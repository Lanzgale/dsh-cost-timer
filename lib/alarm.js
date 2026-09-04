/**
 * dsh-cost-timer — 低谷闹钟(host 侧)。
 *
 * 原理(见会话设计):DSH 的 agent 是消息驱动的单步循环,"让某会话做事"的唯一入口
 * 是给它投一条用户消息。本模块 = 宿主看表:低谷时段(谷价,约为峰价一半)开始时,
 * 给「当前打开的会话窗口」投递一条固定提醒,引导其读取用户指定的待办文件。
 *
 * 触发策略(轻量化版,用户确认):同一时刻活跃的 GUI 会话只有一个(根 agent),
 * 因此:
 *  1. 目标 = 当前 live 根会话(agents.roots();网页切走即被 park,不再计入 roots);
 *  2. 边沿触发:轮询检测进入新低谷段(工作日 12:00 / 18:00,周末全天)时,目标
 *     live → 投递(每段一次,state 去重);
 *  3. 打开补发:监听 agent/created——低谷时段新打开(变为 live)的会话若成为当前
 *     目标且本段未投递,立即补投。
 * 高峰段不投(省钱原则),等下一个低谷段。
 *
 * 配置与去重状态独立存储(不碰 ledger 严格 codec):
 *  - ~/.local/share/dsh-cost-timer/alarm.json      (enabled / path)
 *  - ~/.local/share/dsh-cost-timer/alarm-state.json (last: {sessionId: segmentKey})
 *
 * 另提供同源接口把「会话 id → 标题」批量解析给客户端统计表格
 * (账本只存会话 id,标题在会话日志里,经 ctx.sessionQuery.readTitleSnapshots 获取):
 *  GET /plugins/dsh-cost-timer/titles?ids=a,b,c → { ok, titles: { [id]: title|'' } }
 *
 * 时段规则(北京时间,与 cost-timer 峰谷显示同源):
 *  - 周末(周六/周日,北京日历日,2026-08-23 新规):全天低谷;
 *  - 工作日:高峰 09:00–12:00 与 14:00–18:00,其余低谷。
 */

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const DATA_DIR = process.env.DSH_COST_TIMER_DATA_DIR
  ?? join(homedir(), '.local', 'share', 'dsh-cost-timer')
const CFG_PATH = join(DATA_DIR, 'alarm.json')
const STATE_PATH = join(DATA_DIR, 'alarm-state.json')
// 低谷段检测轮询:投递不必赶时间(段内必有触发 + 打开补发走事件即时),10 分钟一次足够。
const POLL_MS = 600_000

/** 默认提醒正文(纯文本,用户可在面板里自由改写;不绑定固定文件)。 */
const DEFAULT_TEXT = [
  '【dsh-cost-timer · 低谷提醒】当前处于 DeepSeek 谷价时段(费用约为高峰的一半),适合处理积压工作。',
  '',
  '请自行判断此刻该做什么:如有工作待办,请处理后在此会话简短汇报;',
  '不需要用户确认的边界内动作(本地读取/整理/生成)可以直接做;',
  'git push / 付费调用 / 删除等默认不自动做,除非你在提示里明确允许。',
].join('\n')

// ── 北京时间峰谷判定 ───────────────────────────────────────────────────────

const BJ_OFFSET_MS = 8 * 3600 * 1000

/** 北京时间某刻的日历日索引与星期(0=周日 … 6=周六;1970-01-01 周四)。 */
function beijingDay(atMs) {
  const day = Math.floor((atMs + BJ_OFFSET_MS) / 86400000)
  return { day, weekday: (day + 4) % 7 }
}

/** 北京时间日期串 YYYY-MM-DD。 */
function beijingDate(atMs) {
  const d = new Date(atMs + BJ_OFFSET_MS)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/** 北京小时(0–23)。 */
function beijingHour(atMs) {
  return Math.floor(((atMs + BJ_OFFSET_MS) % 86400000) / 3600000)
}

/** 是否低谷(北京时间)。 */
export function isOffpeak(atMs = Date.now()) {
  const { weekday } = beijingDay(atMs)
  if (weekday === 0 || weekday === 6) return true // 周末全天谷
  const h = beijingHour(atMs)
  return !((h >= 9 && h < 12) || (h >= 14 && h < 18))
}

/** 低谷段标识(每段每会话去重用):周末整日一段,工作日按 早/午/晚 三段。 */
export function offpeakSegmentKey(atMs = Date.now()) {
  const date = beijingDate(atMs)
  if (!isOffpeak(atMs)) return null
  const { weekday } = beijingDay(atMs)
  if (weekday === 0 || weekday === 6) return `${date}#weekend`
  const h = beijingHour(atMs)
  if (h < 9) return `${date}#morn`
  if (h >= 12 && h < 14) return `${date}#noon`
  return `${date}#eve` // 18:00 后
}

/** 低谷段中文名(展示用)。 */
export function segmentLabel(key) {
  if (key === null) return null
  const name = key.split('#')[1]
  if (name === 'weekend') return '周末全天'
  if (name === 'morn') return '凌晨低谷'
  if (name === 'noon') return '午间低谷'
  return '晚间低谷'
}

// ── 配置读写 ───────────────────────────────────────────────────────────────

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true })
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(path, data) {
  ensureDataDir()
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, path)
}

function defaultCfg() {
  return { enabled: false, text: DEFAULT_TEXT }
}

function loadCfg() {
  const cfg = { ...defaultCfg(), ...readJson(CFG_PATH, {}) }
  cfg.text = typeof cfg.text === 'string' && cfg.text.trim() ? cfg.text : DEFAULT_TEXT
  cfg.enabled = cfg.enabled === true
  return cfg
}

function loadState() {
  const st = readJson(STATE_PATH, {})
  return { last: st.last && typeof st.last === 'object' ? st.last : {} }
}

// ── 会话工具(标题解析 / 当前根目标) ───────────────────────────────────────

/** 批量把会话 id 解析为标题(取会话日志中的最新 title;无则空串)。 */
async function resolveTitles(ctx, ids) {
  const out = {}
  const list = [...new Set(ids.map(String).filter(Boolean))]
  if (list.length === 0) return out
  const sq = ctx.get('sessionQuery')
  if (!sq || typeof sq.readTitleSnapshots !== 'function') {
    for (const id of list) out[id] = ''
    return out
  }
  try {
    const snapshots = await sq.readTitleSnapshots(list)
    const byId = new Map()
    for (const item of snapshots || []) {
      const sid = String(item?.session?.id ?? '')
      if (sid) byId.set(sid, item)
    }
    for (const id of list) {
      const item = byId.get(id)
      out[id] = (item && typeof item.title === 'string' && item.title.trim()) ? item.title : ''
    }
  } catch {
    for (const id of list) out[id] = ''
  }
  return out
}

/** 当前打开的会话窗口:agents.roots() 里的 live 根会话(网页切走即 park,不在 roots)。 */
function currentRootAgent(ctx) {
  const ag = ctx.get('agents')
  if (!ag) return undefined
  const roots = ag.roots()
  if (roots.length === 0) return undefined
  if (roots.length === 1) return roots[0]
  // 多根(罕见:多标签页/后台根):取会话创建时间最新的一个。
  return roots.slice().sort((a, b) => {
    const ta = Number(a?.session?.header?.createdAt) || 0
    const tb = Number(b?.session?.header?.createdAt) || 0
    return tb - ta
  })[0]
}

// ── 消息构造(createUserMessage 等价,零依赖) ───────────────────────────────

function buildReminderMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: (text && text.trim()) ? text : DEFAULT_TEXT }],
    source: { kind: 'plugin', plugin: 'dsh-cost-timer' },
  }
}

// ── 安装(由 lib/index.js apply 调用) ──────────────────────────────────────

export function installCostTimerAlarm(ctx) {
  let cfg = loadCfg()
  let state = loadState()
  let disposed = false
  let timer = null
  let lastSegment = offpeakSegmentKey() // 进程启动时刻段;避免启动即误触发

  const log = (...a) => console.log('[dsh-cost-timer]', ...a)
  const warn = (...a) => console.warn('[dsh-cost-timer]', ...a)

  const saveCfg = () => { try { writeJsonAtomic(CFG_PATH, cfg) } catch (e) { warn('配置写入失败', String(e)) } }
  const saveState = () => { try { writeJsonAtomic(STATE_PATH, state) } catch (e) { warn('状态写入失败', String(e)) } }

  const agents = () => ctx.get('agents')

  /** 投递提醒到某个 live agent(等其空闲,不打断正在进行的步骤)。 */
  async function deliver(agent, segmentKey) {
    if (disposed || !agent) return false
    state.last[agent.id] = segmentKey
    saveState()
    try {
      const idle = agent.whenIdle ? agent.whenIdle() : null
      if (idle) {
        const timeout = new Promise((resolve) => setTimeout(resolve, 15_000))
        await Promise.race([idle, timeout])
      }
      if (disposed) return false
      if (agents()?.get(agent.id) !== agent) return false
      agent.followup(buildReminderMessage(cfg.text))
      log('已提醒当前会话', agent.id, '(', segmentKey, ')')
      return true
    } catch (e) {
      warn('投递失败', agent.id, String(e))
      return false
    }
  }

  /** 低谷段内对「当前打开的会话」投递(若 live 且本段未投)。 */
  async function dispatchCurrent(segmentKey, now) {
    if (!cfg.enabled || segmentKey === null || !isOffpeak(now)) return
    const agent = currentRootAgent(ctx)
    if (!agent) return
    if (state.last[agent.id] === segmentKey) return
    await deliver(agent, segmentKey)
  }

  // 边沿触发轮询:进入新低谷段时提醒当前打开的会话。
  const tick = async () => {
    if (disposed || !cfg.enabled) return
    const now = Date.now()
    const segment = offpeakSegmentKey(now)
    if (segment !== null && segment !== lastSegment) {
      lastSegment = segment
      await dispatchCurrent(segment, now)
    } else if (segment === null) {
      lastSegment = null // 回到高峰:清掉段标记,准备下一次边沿
    }
  }
  timer = setInterval(() => { void tick() }, POLL_MS)

  // 打开补发:低谷段新打开(成为 live 根)且本段未投 → 补投。
  const onAgentCreated = (payload) => {
    const agent = payload?.agent
    if (!agent || disposed || !cfg.enabled) return
    const now = Date.now()
    const segment = offpeakSegmentKey(now)
    if (segment === null || state.last[agent.id] === segment) return
    // 确认它确实是当前目标(新建的根)再投。
    if (currentRootAgent(ctx)?.id !== agent.id) return
    setTimeout(() => { void deliver(agent, segment) }, 1200)
  }
  ctx.on('agent/created', onAgentCreated)

  // ── 路由(同源) ───────────────────────────────────────────────────────────

  let registered = false
  const registerWeb = () => {
    if (registered) return
    const webServer = ctx.get('webServer') ?? ctx.get('httpServer')
    if (webServer === undefined) return
    registered = true
    const route = (path, handler) => {
      ctx.effect(() => webServer.register({ kind: 'exact', path, handler }), 'dsh-cost-timer: ' + path)
    }
    const send = (res, status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(obj))
    }
    const readBody = async (req) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      return Buffer.concat(chunks).toString('utf8')
    }
    const param = (req, key) => {
      try {
        return new URL(req.url ?? '/', 'http://x').searchParams.get(key)
      } catch {
        return null
      }
    }

    // 闹钟总览:{enabled, path, phase, current:{id,title,live}, last}
    route('/plugins/dsh-cost-timer/alarm/overview', async (req, res) => {
      try {
        const now = Date.now()
        const segment = offpeakSegmentKey(now)
        const root = currentRootAgent(ctx)
        const current = root ? { id: root.id, live: true } : null
        if (current) {
          const titles = await resolveTitles(ctx, [current.id])
          current.title = titles[current.id] || ''
        }
        send(res, 200, {
          ok: true,
          overview: {
            enabled: cfg.enabled,
            text: cfg.text,
            current,
            phase: { offpeak: isOffpeak(now), segment, segmentLabel: segmentLabel(segment) },
            last: state.last,
          },
        })
      } catch (e) {
        send(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    })

    // 增量保存:{enabled?} {path?};保存后若正处低谷段则立即补投一拍。
    route('/plugins/dsh-cost-timer/alarm/config', async (req, res) => {
      try {
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'use POST' })
        const body = JSON.parse(await readBody(req) || '{}')
        let changed = false
        if (typeof body.enabled === 'boolean') { cfg.enabled = body.enabled; changed = true }
        if (typeof body.text === 'string') { cfg.text = body.text.trim() ? body.text : DEFAULT_TEXT; changed = true }
        if (changed) {
          saveCfg()
          const now = Date.now()
          const segment = offpeakSegmentKey(now)
          if (segment !== null) { lastSegment = segment; void dispatchCurrent(segment, now) }
        }
        const root = currentRootAgent(ctx)
        const current = root ? { id: root.id, live: true } : null
        if (current) {
          const titles = await resolveTitles(ctx, [current.id])
          current.title = titles[current.id] || ''
        }
        send(res, 200, {
          ok: true,
          overview: {
            enabled: cfg.enabled,
            text: cfg.text,
            current,
            phase: { offpeak: isOffpeak(), segment: offpeakSegmentKey(), segmentLabel: segmentLabel(offpeakSegmentKey()) },
            last: state.last,
          },
        })
      } catch (e) {
        send(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    })

    // 会话 id → 标题批量解析(统计表格用)。ids 逗号分隔,上限 200。
    route('/plugins/dsh-cost-timer/titles', async (req, res) => {
      try {
        const raw = String(param(req, 'ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
        const titles = await resolveTitles(ctx, raw)
        send(res, 200, { ok: true, titles })
      } catch (e) {
        send(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    })
  }

  registerWeb()
  ctx.on('internal/service', (name) => {
    if (name === 'webServer' || name === 'httpServer') registerWeb()
  })

  // 卸载清理。
  ctx.effect(() => () => {
    disposed = true
    if (timer !== null) clearInterval(timer)
  }, 'dsh-cost-timer: alarm lifecycle')

  // 安装摘要交给 index.js 合并到「已加载」单行提示(不在本模块单独打印)。
  return {
    dataDir: DATA_DIR,
    enabled: cfg.enabled,
    reloadCfg: () => { cfg = loadCfg(); state = loadState() },
  }
}
