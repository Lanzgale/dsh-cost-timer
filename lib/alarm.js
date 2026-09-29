/**
 * dsh-cost-timer — 平价投递(host 侧)。
 *
 * 机制(2026-09-30 简化:每个会话**一条留言**,到点投递一次,没有队列/草稿之分):
 *  - 会话输入框上方有个「平价投递」面板(见 lib/client.js),里面写的文字按会话存在本文件;
 *  - 到期时刻:已在平价段内 → **就是现在**(下一拍轮询投出去);在高峰段 → 下一个平价段起点;
 *  - 到点把这条留言投给该会话(agent.followup)并**清空留言**(一次性)。会话是用户自己
 *    在用的,本来就活着,**通常不需要唤醒**;到点时若它已冷(例如中途重启过 DSH),
 *    不唤醒、留言原地保留,等它再次变活且仍处于平价段内时补投;
 *  - 错过某个段起点就顺延到下一个平价段起点,**绝不在高峰段投递**(省钱原则)。
 *
 * 存储(~/.local/share/dsh-cost-timer/alarm.json,不碰 ledger 严格 codec):
 *  { version: 3, sessions: { [sessionId]: { armed, text, dueAt, last, lastError } } }
 *
 * 路由(同源 HTTP,与账本 codec 无关):
 *  GET  /plugins/dsh-cost-timer/alarm/overview    总览(开关按钮 / 浮窗表格共用)
 *  POST /plugins/dsh-cost-timer/alarm/session     保存某会话的 armed / text
 *  POST /plugins/dsh-cost-timer/alarm/deliver     立即投递一次(排障用,忽略时段)
 *  POST /plugins/dsh-cost-timer/alarm/clear       清掉某会话的留言(排障用)
 *  GET  /plugins/dsh-cost-timer/titles?ids=a,b    会话 id → 标题(统计表格用)
 *
 * 时段规则(北京时间,与 cost-timer 峰谷显示同源):
 *  - 周末(周六/周日,北京日历日,2026-08-23 新规):全天平价,整日一段;
 *  - 工作日:高峰 09:00–12:00 与 14:00–18:00,其余平价(早/午/晚三段)。
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
// 段起点检测轮询:只需在段起点附近发现一次,10 分钟一次足够。
// DSH_COST_TIMER_POLL_MS 仅供调试/自动化测试覆盖(默认 10 分钟)。
const POLL_MS = Number(process.env.DSH_COST_TIMER_POLL_MS) || 600_000

const VERSION = 3
/** 单会话队列上限。 */
const MAX_TEXT_CHARS = 4000

// ── 北京时间峰谷判定 ───────────────────────────────────────────────────────

const BJ_OFFSET_MS = 8 * 3600 * 1000
const DAY_MS = 86400000

/** 北京时间某刻的日历日索引与星期(0=周日 … 6=周六;1970-01-01 周四)。 */
function beijingDay(atMs) {
  const day = Math.floor((atMs + BJ_OFFSET_MS) / DAY_MS)
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
  return Math.floor(((atMs + BJ_OFFSET_MS) % DAY_MS) / 3600000)
}

/** 是否平价(北京时间)。 */
export function isOffpeak(atMs = Date.now()) {
  const { weekday } = beijingDay(atMs)
  if (weekday === 0 || weekday === 6) return true // 周末全天谷
  const h = beijingHour(atMs)
  return !((h >= 9 && h < 12) || (h >= 14 && h < 18))
}

/** 平价段标识(每段每会话去重用):周末整日一段,工作日按 早/午/晚 三段。 */
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

/** 平价段中文名(展示用:只给段名,前缀词「平价」由调用方拼,避免叠字)。 */
export function segmentLabel(key) {
  if (key === null || typeof key !== 'string') return null
  const name = key.split('#')[1]
  if (name === 'weekend') return '周末全天'
  if (name === 'morn') return '凌晨'
  if (name === 'noon') return '午间'
  if (name === 'eve') return '晚间'
  return null
}

/** 某平价段的起点时刻(UTC 毫秒);键非法时返回 null。 */
export function segmentStartMs(key) {
  if (typeof key !== 'string') return null
  const [date, name] = key.split('#')
  const base = Date.parse(`${date}T00:00:00+08:00`)
  if (!Number.isFinite(base)) return null
  const hour = name === 'noon' ? 12 : name === 'eve' ? 18 : 0
  return base + hour * 3600000
}

/**
 * 严格晚于 atMs 的下一个平价段起点(北京时间日历;周末整日一段)。
 * @returns {{ at: number, key: string } | null}
 */
export function nextOffpeakStart(atMs = Date.now()) {
  const dayIndex = Math.floor((atMs + BJ_OFFSET_MS) / DAY_MS)
  for (let offset = 0; offset <= 8; offset += 1) {
    const index = dayIndex + offset
    const weekday = (index + 4) % 7
    // 该北京日 00:00 对应的 UTC 毫秒
    const dayStart = index * DAY_MS - BJ_OFFSET_MS
    const hours = (weekday === 0 || weekday === 6) ? [0] : [0, 12, 18]
    for (const hour of hours) {
      const at = dayStart + hour * 3600000
      if (at > atMs) return { at, key: offpeakSegmentKey(at) }
    }
  }
  return null
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

/** 规范化一个会话记录(超长截断,不抛错)。 */
function sanitizeEntry(raw) {
  const entry = {
    // armed = 该会话的闹钟开关;旧版本用的是 editing(面板展开),读旧配置时按 true 迁移。
    armed: raw?.armed === true || (raw?.armed === undefined && raw?.editing === true),
    // text = 待投递的留言;更早的版本把它叫 draft(面板里的草稿),一并迁移过来。
    text: typeof raw?.text === 'string'
      ? raw.text.slice(0, MAX_TEXT_CHARS)
      : (typeof raw?.draft === 'string' ? raw.draft.slice(0, MAX_TEXT_CHARS) : ''),
    // dueAt = 到期时刻(UTC 毫秒)。旧版本存的是段起点键 dueSegment,读的时候换算过来。
    dueAt: Number.isFinite(Number(raw?.dueAt))
      ? Number(raw.dueAt)
      : (typeof raw?.dueSegment === 'string' ? segmentStartMs(raw.dueSegment) : null),
    last: null,
    lastError: null,
  }
  if (raw?.last !== null && typeof raw?.last === 'object') {
    const at = Number(raw.last.at)
    if (Number.isFinite(at)) {
      entry.last = {
        segment: typeof raw.last.segment === 'string' ? raw.last.segment : null,
        at,
        count: Number.isFinite(Number(raw.last.count)) ? Number(raw.last.count) : 0,
        // text = 这次投出去的原文。客户端靠它判断"输入框里那条是不是刚投出去那条",
        // 从而把输入框清干净 —— 不清的话草稿桥会把它当成新写的内容再投一次。
        text: typeof raw.last.text === 'string' ? raw.last.text.slice(0, MAX_TEXT_CHARS) : '',
      }
    }
  }
  if (typeof raw?.lastError === 'string' && raw.lastError.trim()) entry.lastError = raw.lastError.slice(0, 200)
  return entry
}

function emptyCfg() {
  return { version: VERSION, sessions: {} }
}

function loadCfg() {
  const raw = readJson(CFG_PATH, null)
  const cfg = emptyCfg()
  const sessions = raw !== null && typeof raw === 'object' && raw.sessions !== null && typeof raw.sessions === 'object'
    ? raw.sessions
    : null
  // 旧版(全局单条提醒)配置没有可迁移的队列,直接以空队列模型开张。
  if (sessions === null) return cfg
  for (const [sid, value] of Object.entries(sessions)) {
    if (typeof sid !== 'string' || sid.length === 0) continue
    cfg.sessions[sid] = sanitizeEntry(value)
  }
  return cfg
}

/** 丢弃完全空白的会话记录,避免配置文件无限增长。 */
function pruneSessions(cfg) {
  for (const [sid, entry] of Object.entries(cfg.sessions)) {
    const blank = !entry.armed && entry.text.trim() === ''
      && entry.last === null && entry.lastError === null
    if (blank) delete cfg.sessions[sid]
  }
}

// ── 会话工具(标题解析 / 空白判定) ─────────────────────────────────────────

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

/**
 * 目标会话是否是「空白会话」(新建但还没发过消息)。
 *
 * 空白会话没有在办的事,投进去只会让它无谓地读文件、烧 token,因此不投
 * (队列保留)。判定依据是 host 侧 sessionController.list() 摘要里的 blank 位
 * (与 GUI 会话列表同源)。服务缺失或读取失败时返回 false —— 判定不了就不拦截。
 */
async function isBlankSession(ctx, sessionId) {
  const controller = ctx.get('sessionController')
  if (!controller || typeof controller.list !== 'function') return false
  try {
    const result = await controller.list({})
    const items = result && Array.isArray(result.items) ? result.items : []
    const row = items.find((item) => item && item.sessionId === sessionId)
    return row !== undefined && row.blank === true
  } catch {
    return false
  }
}

// ── 消息构造(createUserMessage 等价,零依赖) ───────────────────────────────

/**
 * 投递用的消息:内容就是用户写的那条原文。
 *
 * source 用 `user` 而不是 `plugin`:DSH 的对话界面把**插件来源**的用户消息折成一行
 * 「上下文注入」(点开才看得到正文),而这条留言本来就是用户自己写的,应当像他自己
 * 发的一样出现在对话里 —— 否则用户会以为"消息没发出去"(2026-09-29 实测反馈)。
 * 官方定时投递(dsh-schedule)用 plugin 来源,是因为它投的是给模型看的提醒框;
 * 我们投的是用户的原话,口径不同。
 */
function buildReminderMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

// ── 安装(由 lib/index.js apply 调用) ──────────────────────────────────────

export function installCostTimerAlarm(ctx) {
  let cfg = loadCfg()
  let disposed = false
  let timer = null
  let ticking = false

  const log = (...a) => console.log('[dsh-cost-timer]', ...a)
  const warn = (...a) => console.warn('[dsh-cost-timer]', ...a)

  const saveCfg = () => {
    pruneSessions(cfg)
    try { writeJsonAtomic(CFG_PATH, cfg) } catch (e) { warn('配置写入失败', String(e)) }
  }

  const agents = () => ctx.get('agents')

  const pendingCount = () => Object.values(cfg.sessions).filter((entry) => entry.text.trim() !== '').length

  /**
   * 保存后归一化预约:**有留言才有"开着"**,留言清空就同时关掉开关、清掉预约。
   * 到期时刻的口径(用户定):已经在平价段里 → 就是现在(下一拍轮询投出去,最多晚 10 分钟);
   * 还在高峰段 → 等下一个平价段的起点。
   *
   * 「留言清空 → armed=false」是核心不变量:开关的含义就是"我有一条留言排着队",
   * 没有留言就没有"开着"这件事(2026-09-29 用户把同步改成显式操作后定的口径)。
   * 它同时是防止残留文本被投出去的第二道闸(第一道在客户端:输入框一空就通知作废)。
   */
  const syncDue = (entry, now) => {
    if (entry.text.trim() === '') {
      const had = entry.dueAt !== null || entry.armed === true
      entry.dueAt = null
      entry.armed = false
      return had
    }
    if (!Number.isFinite(entry.dueAt)) {
      entry.dueAt = isOffpeak(now) ? now : (nextOffpeakStart(now)?.at ?? null)
      return true
    }
    return false
  }

  /**
   * 把某会话的留言投递一次(一次性:投成功即清空留言与预约)。
   * 目标冷/空白/已消失时不投、留言原样留着,由调用方决定下一次什么时候再试。
   * @returns {{ ok: boolean, delivered: number, reason: string | null }}
   */
  async function deliver(sessionId, entry, now) {
    if (disposed) return { ok: false, delivered: 0, reason: 'disposed' }
    const text = entry.text
    if (text.trim() === '') return { ok: false, delivered: 0, reason: 'empty' }
    const agent = agents()?.get(sessionId)
    if (!agent) return { ok: false, delivered: 0, reason: 'cold' }
    if (await isBlankSession(ctx, sessionId)) return { ok: false, delivered: 0, reason: 'blank' }
    try {
      const idle = agent.whenIdle ? agent.whenIdle() : null
      if (idle) await Promise.race([idle, new Promise((resolve) => setTimeout(resolve, 15_000))])
      if (disposed) return { ok: false, delivered: 0, reason: 'disposed' }
      if (agents()?.get(sessionId) !== agent) return { ok: false, delivered: 0, reason: 'cold' }
      agent.followup(buildReminderMessage(text))
    } catch (error) {
      const reason = String((error && error.message) || error)
      entry.lastError = reason
      saveCfg()
      warn('投递失败', sessionId, reason)
      return { ok: false, delivered: 0, reason }
    }
    // 一条留言 = 投一次:投完关掉开关(界面上的按钮随之变灰 = 「已发送,没有待投递的东西」),
    // 并把这轮的原文记进 last。关掉开关是关键 —— 否则输入框里残留的原文会被草稿桥当成
    // "用户又写了一遍"重新排队,下一拍再投一次(2026-09-29 实测的重复投递就是这个)。
    entry.text = ''
    entry.dueAt = null
    entry.armed = false
    entry.lastError = null
    entry.last = { segment: offpeakSegmentKey(now), at: now, count: 1, text: text.slice(0, MAX_TEXT_CHARS) }
    saveCfg()
    log(`已投递留言 → ${sessionId}`)
    return { ok: true, delivered: 1, reason: null }
  }

  /**
   * 段边沿轮询:对每个「有留言且段起点已过」的会话投递。
   * 高峰段一律不投(顺延到下一个平价段起点);目标冷/空白则跳过、留言保留,
   * 等它变活且仍在平价段内时由下一拍(或 agent/created 触发)补投。
   */
  async function tick(now = Date.now()) {
    if (disposed || ticking) return
    ticking = true
    try {
      const offpeak = isOffpeak(now)
      let dirty = false
      for (const [sessionId, entry] of Object.entries(cfg.sessions)) {
        if (entry.text.trim() === '') continue
        // 开关关掉的一律不投:投递的前提是"用户开着这个闹钟"。
        // 残留文本(客户端没清干净等意外)不该在用户不知情时被发出去。
        if (entry.armed !== true) { if (syncDue(entry, now)) dirty = true; continue }
        if (syncDue(entry, now)) dirty = true
        if (!Number.isFinite(entry.dueAt) || now < entry.dueAt) continue
        if (!offpeak) continue
        await deliver(sessionId, entry, now) // 内部成功/失败都会落盘
      }
      if (dirty) saveCfg()
    } finally {
      ticking = false
    }
  }
  timer = setInterval(() => { void tick() }, POLL_MS)

  // 冷却的留言在「会话被打开」的瞬间补投,不必等下一拍轮询(仍受平价段限制)。
  ctx.effect(() => ctx.on('agent/created', ({ agent }) => {
    const entry = cfg.sessions[agent?.id]
    if (!disposed && entry !== undefined && entry.text.trim() !== '') void tick()
  }), 'dsh-cost-timer: alarm wake catch-up')

  // ── 路由(同源) ───────────────────────────────────────────────────────────

  const sessionView = (sessionId, title, now) => {
    const entry = cfg.sessions[sessionId]
    if (entry === undefined) return null
    const live = agents()?.get(sessionId) !== undefined
    return {
      id: sessionId,
      title,
      armed: entry.armed,
      text: entry.text,
      status: entry.text.trim() !== '' ? 'ready' : 'empty',
      dueAt: entry.dueAt,
      live,
      last: entry.last,
      lastError: entry.lastError,
    }
  }

  const buildOverview = async (now = Date.now()) => {
    const next = nextOffpeakStart(now)
    const ids = Object.keys(cfg.sessions)
    // 标题一次性批量解析(按会话逐个读会话日志会明显变慢)。
    const titles = await resolveTitles(ctx, ids)
    const sessions = []
    for (const sessionId of ids) {
      const view = sessionView(sessionId, titles[sessionId] || '', now)
      if (view !== null) sessions.push(view)
    }
    const segment = offpeakSegmentKey(now)
    return {
      version: VERSION,
      phase: {
        offpeak: isOffpeak(now),
        segment,
        segmentLabel: segmentLabel(segment),
        nextAt: next ? next.at : null,
        nextLabel: next ? segmentLabel(next.key) : null,
      },
      limits: { textChars: MAX_TEXT_CHARS },
      sessions,
    }
  }

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
    const fail = (res, status, message) => send(res, status, { ok: false, error: message })
    const readJsonBody = async (req) => {
      const text = await readBody(req)
      try {
        const body = JSON.parse(text || '{}')
        return body !== null && typeof body === 'object' ? body : {}
      } catch {
        return null
      }
    }

    // 总览:窄条 / 排队编辑器 / 浮窗总览表格共用一份数据。
    route('/plugins/dsh-cost-timer/alarm/overview', async (req, res) => {
      try {
        send(res, 200, { ok: true, overview: await buildOverview() })
      } catch (e) {
        fail(res, 500, String((e && e.message) || e))
      }
    })

    // 增量保存某会话:{sessionId, armed?, text?}。
    // 留言从空变成有内容时预约下一个平价段起点;清空则连预约一起清掉。
    route('/plugins/dsh-cost-timer/alarm/session', async (req, res) => {
      try {
        if (req.method !== 'POST') return fail(res, 405, 'use POST')
        const body = await readJsonBody(req)
        if (body === null) return fail(res, 400, 'invalid JSON body')
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
        if (!sessionId) return fail(res, 400, 'sessionId required')
        const now = Date.now()
        const entry = cfg.sessions[sessionId] ?? sanitizeEntry({})
        if (typeof body.armed === 'boolean') entry.armed = body.armed
        // 不变量:**没开着就不接受留言**(开着 = 有一条留言排着队,两者必须同时成立)。
        // 关闭留言 / 已经关着的会话收到残留文本,都一律清空 —— 这是防止"用户不知情时被投出去"
        // 的最后一道闸(前两道:客户端清输入框、syncDue 里"空留言则关开关")。
        if (entry.armed !== true) entry.text = ''
        else if (typeof body.text === 'string') entry.text = body.text.slice(0, MAX_TEXT_CHARS)
        syncDue(entry, now)
        cfg.sessions[sessionId] = entry
        saveCfg()
        const overview = await buildOverview(now)
        send(res, 200, {
          ok: true,
          session: overview.sessions.find((row) => row.id === sessionId) ?? null,
          overview,
        })
      } catch (e) {
        fail(res, 500, String((e && e.message) || e))
      }
    })

    // 立即投递(手动,忽略时段与预约点;目标冷/空白时如实回报,不唤醒)。
    route('/plugins/dsh-cost-timer/alarm/deliver', async (req, res) => {
      try {
        if (req.method !== 'POST') return fail(res, 405, 'use POST')
        const body = await readJsonBody(req)
        if (body === null) return fail(res, 400, 'invalid JSON body')
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
        if (!sessionId) return fail(res, 400, 'sessionId required')
        const entry = cfg.sessions[sessionId]
        if (entry === undefined || entry.text.trim() === '') {
          return send(res, 200, { ok: true, result: { ok: false, delivered: 0, reason: 'empty' }, overview: await buildOverview() })
        }
        const result = await deliver(sessionId, entry, Date.now())
        send(res, 200, { ok: true, result, overview: await buildOverview() })
      } catch (e) {
        fail(res, 500, String((e && e.message) || e))
      }
    })

    // 清掉某会话的留言与面板标记(整条记录删除);控制台/排障用。
    route('/plugins/dsh-cost-timer/alarm/clear', async (req, res) => {
      try {
        if (req.method !== 'POST') return fail(res, 405, 'use POST')
        const body = await readJsonBody(req)
        if (body === null) return fail(res, 400, 'invalid JSON body')
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
        if (!sessionId) return fail(res, 400, 'sessionId required')
        delete cfg.sessions[sessionId]
        saveCfg()
        send(res, 200, { ok: true, overview: await buildOverview() })
      } catch (e) {
        fail(res, 500, String((e && e.message) || e))
      }
    })

    // 会话 id → 标题批量解析(统计表格用)。ids 逗号分隔,上限 200。
    route('/plugins/dsh-cost-timer/titles', async (req, res) => {
      try {
        const raw = String(param(req, 'ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
        const titles = await resolveTitles(ctx, raw)
        send(res, 200, { ok: true, titles })
      } catch (e) {
        fail(res, 500, String((e && e.message) || e))
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
  const pending = pendingCount()
  return {
    dataDir: DATA_DIR,
    pendingSessions: pending,
    nextDeliveryAt: pending > 0 ? nextOffpeakStart()?.at ?? null : null,
    reloadCfg: () => { cfg = loadCfg() },
  }
}
