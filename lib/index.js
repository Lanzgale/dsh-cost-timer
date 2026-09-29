/**
 * dsh-cost-timer 宿主插件。
 *
 * 单一 Loader 行(见 cordis.patch.yml)挂载本模块,职责:
 *  1. 打开/维护账本($DSH_HOME/storages/cost-meter/ledger.json);
 *  2. 包裹 `llm/stream` 瀑布,捕获每次模型调用的 usage 块并按官方价格计费;
 *  3. 提供 `costMeter` 服务(手写 typertRemote 绑定,配合 ./typert 清单走
 *     Typert 网关),客户端经 `remote.costMeter.*` 读写状态与配置。
 *
 * 不导入 cordis/dsh-* 运行时包中的 Service/Context 类:仅用 ctx API 与 Node
 * 内建能力,因此与宿主进程共享同一套运行时实例;dsh-credentials 只用于
 * 余额查询的凭证引用构造(credentialRef 为纯函数,无跨实例状态)。
 */

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Ledger, applyConfigPatch, defaultLedgerPath, localDayKey, pickBalanceInfo, reconcileBalanceDelta, reconcileRechargeRef, zeroDay } from './store.js'
import { createLlmStreamBilling } from './billing-stream.js'
import { OFFICIAL_PRICING_URL, OFFICIAL_PRICING_URL_ZH, normalizePrice, parsePricingHtml, buildPriceCatalog } from './pricing.js'
import { fetchWithRetry } from './net.js'
import { stateSchema } from './typert.host.js'
import { installCostTimerAlarm } from './alarm.js'

export const name = 'cost-timer'

/** 自定义 Provider 余额占位(功能已裁剪,恒为 off;字段保留以兼容 state schema)。 */
function emptyCustomBalance() {
  return {
    status: 'off',
    message: '',
    fetchedAt: 0,
    label: '',
    unit: 'USD',
    remaining: 0,
    maxBudget: null,
    spend: null,
  }
}

// ── 多语言(中/英) ─────────────────────────────────────────────────────────

/** 服务端用户可见文案(zh/en)。 */
const SERVER_MESSAGES = {
  zh: {
    apiKeyMissing: '未配置 DeepSeek API Key(请在 设置→模型 中配置,或导出 {env} 环境变量)',
    balanceHttp: '余额接口 HTTP {code}',
    balanceNoInfos: '余额接口响应缺少 balance_infos',
    balanceEndpointNotOfficial: '余额查询仅支持官方端点(api.deepseek.com):当前配置的 baseURL {url} 不是官方域名,为保护 API Key 已拒绝发起请求',
    pageTooShort: '页面内容过短,可能被网关拦截',
    noModelsParsed: '官方页面中未解析出任何模型价格,页面结构可能已变化,请稍后重试或手动编辑价格',
    configRejected: '配置更新被拒绝:{errors}',
    balanceDisplayOff: '余额显示已关闭,请先在 显示设置 中开启',
    balanceRefreshed: '余额已刷新',
    balanceQueryFailed: '余额查询失败:{message}',
    reconcileWarn: '对账提示:本地账本今日官方渠道费用 {cost} 与官方余额当日变动 {delta} 偏差较大,请核对价格表或近期账单',
    pricesSynced: '已从官方文档同步 {ids} 的价格',
    pricesSyncedFallback: '所选币种官方页同步失败({error}),已回退另一语言官方页,同步 {ids} 的价格;可稍后重试切换回目标币种',
    priceSyncFailed: '官方价格同步失败:{error}',
  },
  en: {
    apiKeyMissing: 'DeepSeek API key not configured (configure it in Settings → Models, or export the {env} environment variable)',
    balanceHttp: 'Balance API returned HTTP {code}',
    balanceNoInfos: 'Balance API response is missing balance_infos',
    balanceEndpointNotOfficial: 'Balance lookup only supports the official endpoint (api.deepseek.com): the configured baseURL {url} is not an official host, so the API key will not be sent there',
    pageTooShort: 'Page content too short; the request may have been blocked by the gateway',
    noModelsParsed: 'No model prices could be parsed from the official page; the page structure may have changed — try again later or edit the price table manually.',
    configRejected: 'Config update rejected: {errors}',
    balanceDisplayOff: 'Balance display is off; enable it in Display settings first',
    balanceRefreshed: 'Balance refreshed',
    balanceQueryFailed: 'Balance query failed: {message}',
    reconcileWarn: 'Reconciliation notice: today\'s local official-channel cost ({cost}) deviates significantly from the official balance change ({delta}); please check the price table or recent bills',
    pricesSynced: 'Synced prices for {ids} from the official docs',
    pricesSyncedFallback: 'Syncing the official page for the selected currency failed ({error}); fell back to the other language page and synced prices for {ids}. You can switch back and retry later.',
    priceSyncFailed: 'Official price sync failed: {error}',
  },
}

/** 取服务端文案(zh/en),支持 {var} 插值。 */
function tmsg(locale, code, vars) {
  const dict = locale === 'en' ? SERVER_MESSAGES.en : SERVER_MESSAGES.zh
  let text = dict[code] ?? code
  if (vars) for (const key of Object.keys(vars)) text = text.split(`{${key}}`).join(String(vars[key]))
  return text
}

/** 从配置解析消息语言:'en' → en;auto/zh → zh(服务端无法探测浏览器)。 */
function localeOf(config) {
  return config?.locale === 'en' ? 'en' : 'zh'
}

// ── 服务 ───────────────────────────────────────────────────────────────────

/** 余额占位(未开启显示或查询失败时的空值)。 */
function emptyBalance() {
  return { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 }
}

/** 官方余额端点:仅允许官方域名(api.deepseek.com),防止 API Key 被发往非官方端点;非法端点返回 null。 */
function balanceEndpoint(baseURL) {
  let base = String(baseURL ?? '').trim().replace(/\/+$/, '')
  if (base.length === 0) base = String(process.env.DEEPSEEK_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (base.length === 0) base = 'https://api.deepseek.com'
  if (/\/v\d+$/i.test(base)) base = base.replace(/\/v\d+$/i, '')
  let host = ''
  try { host = new URL(base).host.toLowerCase() } catch { return null }
  if (host !== 'api.deepseek.com') return null
  return `${base}/user/balance`
}

/**
 * 调用官方开放平台余额接口(GET {base}/user/balance)。
 * 凭证与端点均取自 llm-deepseek 的设置段与凭证服务,与模型请求同一把 Key。
 * @param ctx - 宿主插件上下文。
 * @param locale - 消息语言(zh/en)。
 * @returns { currency, totalBalance, grantedBalance, toppedUpBalance }。
 */
async function queryBalance(ctx, locale) {
  const settings = ctx.get('settings')
  const section = typeof settings?.get === 'function' ? settings.get('llm-deepseek') : undefined
  const baseURL = section?.baseURL
  const apiKeyEnv = typeof section?.apiKeyEnv === 'string' && section.apiKeyEnv.length > 0
    ? section.apiKeyEnv
    : 'DEEPSEEK_API_KEY'
  let apiKey = null
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(credentialRef(apiKeyEnv))
      if (hit?.value !== undefined && hit.value.length > 0) apiKey = hit.value
    } catch {
      // 凭证解析失败时回退到环境变量。
    }
  }
  if (apiKey === null && typeof process.env[apiKeyEnv] === 'string') apiKey = process.env[apiKeyEnv]
  if (apiKey === null || apiKey.length === 0) {
    // 守卫错误(不会自愈,重试无意义)标记 soft:与 coding-plans 的软失败同语义。
    const err = new Error(tmsg(locale, 'apiKeyMissing', { env: apiKeyEnv }))
    err.soft = true
    throw err
  }
  const endpoint = balanceEndpoint(baseURL)
  if (endpoint === null) {
    const err = new Error(tmsg(locale, 'balanceEndpointNotOfficial', { url: String(baseURL ?? '') }))
    err.soft = true
    throw err
  }
  // 瞬时网络错误自动重试(issue #28 同一封装);非 2xx 状态仍按业务错误处理。
  const response = await fetchWithRetry(endpoint, {
    headers: { authorization: `Bearer ${apiKey}` },
  }, { timeoutMs: 15000 })
  if (!response.ok) throw new Error(tmsg(locale, 'balanceHttp', { code: String(response.status) }))
  const data = await response.json()
  // 多币种账号返回 CNY/USD 两条且顺序不稳定(#24/#25):按余额与币种挑选,不固定取首条。
  const info = pickBalanceInfo(data?.balance_infos)
  if (info === undefined) throw new Error(tmsg(locale, 'balanceNoInfos'))
  const num = value => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return {
    currency: typeof info.currency === 'string' ? info.currency : '',
    totalBalance: num(info.total_balance),
    grantedBalance: num(info.granted_balance),
    toppedUpBalance: num(info.topped_up_balance),
  }
}

/** 扩展价格表目录(内置只读;provider → family → model → 价格)。 */
const PRICE_CATALOG = buildPriceCatalog()

/** 组装对客户端的完整账本快照。 */
function buildState(ledger, balance = emptyBalance(), reconcile = { ok: true, message: '' }) {
  const now = Date.now()
  const dayKey = localDayKey(now)
  const monthKey = dayKey.slice(0, 7)
  // 本月费用 = 最近 30 天(含今天,滚动口径,不与自然月对齐;用户口径)。
  const rollStart = new Date(now)
  rollStart.setDate(rollStart.getDate() - 29)
  const rollStartKey = localDayKey(rollStart.getTime())
  // 预算已用金额(美元):按配置周期聚合;custom 区间左闭右闭,结束为空 = 今日。
  const budget = ledger.config?.budget ?? {}
  let budgetUsed
  if (budget.period === 'day') budgetUsed = ledger.today().cost
  else if (budget.period === 'all') budgetUsed = ledger.sumDays(undefined).cost
  else if (budget.period === 'custom') {
    const start = typeof budget.customStart === 'string' ? budget.customStart : null
    const end = typeof budget.customEnd === 'string' && budget.customEnd.length > 0 ? budget.customEnd : dayKey
    budgetUsed = start === null ? 0 : ledger.sumRange(start, end).cost
  } else budgetUsed = ledger.sumDays(monthKey).cost
  const state = {
    today: ledger.today(),
    month: ledger.sumRange(rollStartKey, dayKey),
    total: ledger.sumDays(undefined),
    budgetUsed,
    balance,
    goQuota: { status: 'off', message: '', fetchedAt: 0, rolling: null, weekly: null, monthly: null },
    customBalance: emptyCustomBalance(),
    // 余额差交叉校验提示(issue #18):本地今日合计与官方余额当日变动偏差超阈时 ok=false。
    reconcile,
    // 当日余额基准(零点首次拉取/充值后重置):供卡片起始余额条显示。无基准时为 null。
    balanceRef: ledger.balanceRef ?? null,
    // 充值基准(卡片余额条满格;不随日期重置)。旧宿主/未拉取过余额时为 null。
    rechargeRef: ledger.rechargeRef ?? null,
    codingPlans: {},
    history: ledger.history(90),
    config: ledger.config,
    priceCatalog: PRICE_CATALOG,
    meta: {
      now,
      timezoneOffsetMinutes: -new Date(now).getTimezoneOffset(),
      dayKey,
      monthKey,
    },
  }
  // 可用性兑底:若快照与 strict codec 漂移(新增字段 schema 未同步等),
  // 逐级降级(剔目录 → 空额度状态)重试,而不是让整个 getState 被拒导致「账本不可用」。
  const check = stateSchema.safeParse(state)
  if (check.success) return state
  console.warn('[dsh-cost-timer] state 与 codec 漂移,尝试降级恢复可用性:', JSON.stringify(check.error.issues?.slice(0, 3) ?? check.error))
  // 注意剔除键必须用解构省略而非赋 undefined:priceCatalog 是 schema 声明的
  // optional 键,显式 undefined 键会被网关 JSON 安全校验拒绝(值合法但属性不安全)。
  const { priceCatalog: _dropped, ...stateNoCatalog } = state
  const attempts = [
    stateNoCatalog,
    { ...stateNoCatalog, codingPlans: {} },
    { ...stateNoCatalog, codingPlans: {}, balance: emptyBalance() },
  ]
  for (const fallback of attempts) {
    if (stateSchema.safeParse(fallback).success) return fallback
  }
  return state
}

/** 带超时抓取官方定价页(瞬时网络错误自动重试,issue #28 同一封装)。 */
async function fetchPricingHtml(locale, pricingCurrency) {
  // 官方价格币种(issue #47):人民币 → 中文页(元计价),美元 → 英文页($计价)。
  const url = pricingCurrency === 'CNY' ? OFFICIAL_PRICING_URL_ZH : OFFICIAL_PRICING_URL
  const response = await fetchWithRetry(url, {
    headers: { 'user-agent': 'dsh-cost-timer/0.4 (DeepSeek Harness plugin)' },
  }, { timeoutMs: 20000 })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const text = await response.text()
  if (text.length < 500) throw new Error(tmsg(locale, 'pageTooShort'))
  return text
}

// ── 会话家族(本会话 + 它派出去的子代理) ───────────────────────────────────

/**
 * 子代理在 DSH 里是一个**独立会话**:它的每次模型调用都带着自己的会话 id 记账
 * (dsh-subagent-in-process-driver 用 `sessionId: childId` 新建子会话),账本因此
 * 把子代理的钱记在子会话那一行,只有会话头的 `parentSession` 指回派它的父会话
 * (孙代理再指向子代理)。所以「当前会话花了多少」必须把家族连同后代一起求和,
 * 否则子代理那部分会漏在这行之外(2026-09-28 用户指出:
 * 「子代理是当前会话派出去的助手,直接合并计算」)。
 *
 * 父子关系只能读会话头,账本按 (日期, 会话) 记账、不含父指针。数据源优先
 * sessionQuery(含已持久化、当前不活跃的子会话 —— 子代理跑完即销毁,只查实时
 * 注册表会漏掉昨天刚跑完的),拿不到时退回实时会话注册表 ctx.sessions。
 *
 * 不直接用 sessionQuery.traceSession():它对不存在的会话抛错(账本里可能有会话
 * 已被清理的旧行),且会把祖先/后代整份克隆出来,这里只要 id、还要跨调用复用。
 */

/** 家族关系缓存(毫秒):本关系的消费方是 30s 一次的账本轮询,5s 内复用不影响新鲜度。 */
const FAMILY_CACHE_MS = 5000

/** 列会话头,折叠出「父会话 id → 直接子会话 id 列表」。 */
async function childrenIndex(ctx) {
  const records = []
  const sq = ctx.get('sessionQuery')
  if (sq !== undefined && typeof sq.listSessions === 'function') {
    try {
      for (const record of await sq.listSessions()) records.push(record)
    } catch (error) {
      console.warn(`[dsh-cost-timer] 会话家族:读会话清单失败: ${String((error && error.message) || error)}`)
    }
  }
  if (records.length === 0) {
    const registry = ctx.get('sessions')
    if (registry !== undefined && typeof registry.list === 'function') {
      for (const session of registry.list()) records.push({ header: session?.header })
    }
  }
  const children = new Map()
  for (const record of records) {
    const header = record === null || typeof record !== 'object' ? undefined : record.header
    if (header === null || typeof header !== 'object') continue
    const id = String(header.id ?? '')
    const parent = String(header.parentSession ?? '')
    // parent === id 防脏数据自环(与自家比较时反复入队)。
    if (id.length === 0 || parent.length === 0 || parent === id) continue
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [id])
    else siblings.push(id)
  }
  return children
}

/**
 * 造一个「会话家族读取器」:内部缓存父子关系 5s,返回该会话自身 + 全部后代代理的 id。
 * 读不到任何父子关系时退化成只含自身 —— 与改造前的行为一致,不会让这一行消失。
 * @param ctx - 宿主插件上下文。
 * @returns (rootId: string) => Promise<string[]>。
 */
function makeSessionFamilyReader(ctx) {
  let atMs = 0
  let children = null
  return async function sessionFamilyIds(rootId) {
    const now = Date.now()
    if (children === null || now - atMs >= FAMILY_CACHE_MS) {
      children = await childrenIndex(ctx).catch(error => {
        console.warn(`[dsh-cost-timer] 会话家族:构建父子关系失败: ${String((error && error.message) || error)}`)
        return new Map()
      })
      atMs = now
    }
    const ids = [rootId]
    const seen = new Set(ids)
    // 边遍历边追加(BFS):子代理还能再派孙代理,一层层展开到没有后代为止。
    for (let i = 0; i < ids.length; i += 1) {
      for (const child of children.get(ids[i]) ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        ids.push(child)
      }
    }
    return ids
  }
}

/**
 * 造一个「会话 → 根会话」解析器:账本按 (日期, 会话) 记账、行里没有父指针,父子关系只在
 * 会话头里(parentSession),所以要把子代理的钱并到派它的会话头上,得先让每个 id 沿父子
 * 关系一路上溯到最顶层的祖先。读不到关系时解析成自身 —— 退化成「不合并」,不会让任何一行
 * 凭空消失(与 sessionFamilyIds 同一个 5s 缓存策略)。
 *
 * 用途是**统计口径**:用户只关心「这个会话一共花了多少」。子代理单列出来既看不出是哪一个,
 * 清掉子代理会话后又会与账单对不上(2026-09-29 用户口径:「直接把子代理账单算到会话上」)。
 * @param ctx - 宿主插件上下文。
 * @returns (ids: string[]) => Promise<Map<string, string>> 子会话 id → 根会话 id。
 */
function makeSessionRootReader(ctx) {
  let atMs = 0
  let parentOf = null
  return async function sessionRootsOf(ids) {
    const now = Date.now()
    if (parentOf === null || now - atMs >= FAMILY_CACHE_MS) {
      const children = await childrenIndex(ctx).catch(error => {
        console.warn(`[dsh-cost-timer] 会话家族:构建父子关系失败: ${String((error && error.message) || error)}`)
        return new Map()
      })
      parentOf = new Map()
      for (const [parent, kids] of children) for (const kid of kids) if (!parentOf.has(kid)) parentOf.set(kid, parent)
      atMs = now
    }
    const out = new Map()
    for (const raw of Array.isArray(ids) ? ids : []) {
      const id = String(raw ?? '')
      if (id.length === 0) continue
      const seen = new Set([id])
      let cur = id
      // 子代理还能再派孙代理,一路上溯;seen 兼作脏数据自环保护。
      for (;;) {
        const up = parentOf.get(cur)
        if (up === undefined || seen.has(up)) break
        seen.add(up)
        cur = up
      }
      out.set(id, cur)
    }
    return out
  }
}

/** 合并一份 provider→用量 分桶(账本行自带;并到根行后仍要保持形状完整,严格 codec 才不丢字段)。 */
function addProviderModel(into, from) {
  if (from === null || typeof from !== 'object') return into
  for (const [key, bucket] of Object.entries(from)) {
    if (bucket === null || typeof bucket !== 'object') continue
    const cur = into[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
    cur.input += Number(bucket.input) || 0
    cur.output += Number(bucket.output) || 0
    cur.cacheRead += Number(bucket.cacheRead) || 0
    cur.cacheWrite += Number(bucket.cacheWrite) || 0
    cur.reasoning += Number(bucket.reasoning) || 0
    cur.calls += Number(bucket.calls) || 0
    cur.cost += Number(bucket.cost) || 0
    into[key] = cur
  }
  return into
}

/**
 * 把一天里的子代理行并进它所属的根会话行(只在**下发前**换口径,账本本身一个字节都不动)。
 * 数值字段相加,总费用不变,只是不再单独占行;标题只认根会话自己的(子代理的标题是
 * 「子代理 xxx」,并进去只会误导),at 取最早。
 * @param ctx - 宿主插件上下文。
 * @param sessions - 该日的会话行数组。
 * @returns 合并后的行数组(按 cost 倒序)。
 */
async function foldSubagentRows(ctx, sessions) {
  const rows = Array.isArray(sessions)
    ? sessions.filter(row => row !== null && typeof row === 'object' && String(row.id ?? '').length > 0)
    : []
  if (rows.length === 0) return rows
  const roots = await makeSessionRootReader(ctx)(rows.map(row => String(row.id)))
  const byRoot = new Map()
  for (const row of rows) {
    const id = String(row.id)
    const rootId = roots.get(id) ?? id
    let target = byRoot.get(rootId)
    if (target === undefined) {
      target = { id: rootId, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
      byRoot.set(rootId, target)
    }
    target.input += Number(row.input) || 0
    target.output += Number(row.output) || 0
    target.cacheRead += Number(row.cacheRead) || 0
    target.cacheWrite += Number(row.cacheWrite) || 0
    target.reasoning += Number(row.reasoning) || 0
    target.calls += Number(row.calls) || 0
    target.cost += Number(row.cost) || 0
    if (Number.isFinite(row.at)) target.at = target.at === undefined ? row.at : Math.min(target.at, row.at)
    if (id === rootId && typeof row.title === 'string' && row.title.length > 0) target.title = row.title
    if (row.byProviderModel !== undefined) target.byProviderModel = addProviderModel(target.byProviderModel ?? {}, row.byProviderModel)
  }
  return [...byRoot.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
}

/**
 * 创建 costMeter 服务对象。手写 `typertRemote` 绑定(service/serviceKey/namespace)
 * 满足 Typert 网关的 validateBinding 校验;方法按清单参数顺序位置调用。
 * @param ctx - 宿主插件上下文。
 * @param ledger - 账本。
 * @returns 服务对象。
 */
function createService(ctx, ledger) {
  const sessionFamilyIds = makeSessionFamilyReader(ctx)
  // 余额进程内缓存:display=off 时不清缓存但不下发;按 refreshMinutes 过期。
  let balanceCache = { fetchedAt: 0, value: emptyBalance() }
  // 余额差对账提示(drift 时 ok=false 携带文案,其余静默)。
  let reconcileNotice = { ok: true, message: '' }

  const balanceConfig = () => ledger.config?.balance ?? { display: 'both', refreshMinutes: 5 }

  /** 按需刷新余额(过期或 force);失败落 error 状态,不影响其余状态字段。 */
  const ensureBalance = async (force = false) => {
    const config = balanceConfig()
    if (config.display === 'off') {
      balanceCache = { fetchedAt: Date.now(), value: emptyBalance() }
      return
    }
    const interval = Math.max(1, Number(config.refreshMinutes) || 5) * 60_000
    if (!force && Date.now() - balanceCache.fetchedAt < interval) return
    if (balanceCache.inFlight !== undefined) {
      await balanceCache.inFlight
      return
    }
    const task = queryBalance(ctx, localeOf(ledger.config)).then(result => {
      balanceCache = { fetchedAt: Date.now(), value: { status: 'ok', message: '', fetchedAt: Date.now(), ...result } }
      // 余额差交叉校验(issue #18):官方余额当日变动 vs 本地账本今日官方渠道费用,偏差超阈提示。
      // issue #36:Coding Plan / 自定义 Provider 的费用不动官方余额,对账只统计 deepseek 渠道,否则订阅用户会恒报 drift。
      if (balanceCache.value.status === 'ok') {
        const nowMs = Date.now()
        const usd = v => '$' + Number(v).toFixed(4)
        // balanceRef(当日余额基准:零点/充值后重置)无论对账开关如何都维护——它是卡片余额条的数据源,
        // 充值后必须重置基准,否则余额条比例停留在充值前;reconcile 开关只控制 drift 警示,不影响基准更新。
        const { ref, event } = reconcileBalanceDelta(ledger.balanceRef, balanceCache.value, ledger.todayOfficialCost(), localDayKey(nowMs), nowMs)
        if (ref !== ledger.balanceRef) {
          ledger.balanceRef = ref
          ledger.scheduleWrite()
        }
        // 卡片余额条的"电池满格"基准(2026-09-17 改版):满格 = 上次充值后的余额,
        // 不随日期重置,仅充值/授信时回满。与上面的对账基准相互独立,必须分别维护。
        const nextRecharge = reconcileRechargeRef(ledger.rechargeRef, balanceCache.value, nowMs)
        if (nextRecharge !== ledger.rechargeRef) {
          ledger.rechargeRef = nextRecharge
          ledger.scheduleWrite()
        }
        reconcileNotice = (ledger.config?.balance?.reconcile ?? true) === true && event !== null && event.kind === 'drift'
          ? { ok: false, message: tmsg(localeOf(ledger.config), 'reconcileWarn', { cost: usd(event.todayCost), delta: usd(event.spent) }) }
          : { ok: true, message: '' }
      }
    }, error => {
      // 软失败(未配置 Key / 非官方端点等守卫错误,不会自愈)标记 fetchedAt 避免无意义重试;
      // 硬失败(网络超时等临时性问题)写入 error 状态但保留外层 fetchedAt——UI 仍显示失败原因,
      // 且下次轮询自动重试,不再被缓存有效期钉死(PR #40 补全)。
      const now = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      if (error && error.soft === true) {
        balanceCache = { fetchedAt: now, value: { ...emptyBalance(), status: 'off', message, fetchedAt: now } }
      } else {
        balanceCache = { ...balanceCache, value: { ...emptyBalance(), status: 'error', message, fetchedAt: now } }
      }
    }).finally(() => {
      if (balanceCache.inFlight === task) delete balanceCache.inFlight
    })
    balanceCache.inFlight = task
    await task
  }

  const build = async (forceBalance = false) => {
    await ensureBalance(forceBalance)
    return buildState(ledger, balanceCache.value, reconcileNotice)
  }

  const service = {
    async getState() {
      return build(false)
    },

    async updateConfig(patch) {
      const { config, errors } = applyConfigPatch(ledger.config, patch)
      if (errors.length > 0) {
        const locale = patch !== null && typeof patch === 'object' && patch.locale === 'en' ? 'en' : localeOf(ledger.config)
        throw new Error(tmsg(locale, 'configRejected', { errors: errors.join(locale === 'zh' ? ';' : '; ') }))
      }
      ledger.config = config
      if (config.balance?.reconcile !== true) reconcileNotice = { ok: true, message: '' }
      ledger.scheduleWrite()
      return build(false)
    },

    async refreshBalance() {
      const locale = localeOf(ledger.config)
      if (balanceConfig().display === 'off') {
        return { ok: false, message: tmsg(locale, 'balanceDisplayOff') }
      }
      await ensureBalance(true)
      const value = balanceCache.value
      return {
        ok: value.status === 'ok',
        message: value.status === 'ok' ? tmsg(locale, 'balanceRefreshed') : tmsg(locale, 'balanceQueryFailed', { message: value.message }),
        state: buildState(ledger, value, reconcileNotice),
      }
    },

    async fetchPrices() {
      const locale = localeOf(ledger.config)
      try {
        // 官方价格币种(issue #47):CNY 抓中文官方页(人民币价)、USD 抓英文页;
        // 目标页失败(网络错误 / CDN 缓存旧版结构)时回退另一语言页并在结果中注明。
        const wanted = ledger.config.pricingCurrency === 'CNY' ? 'CNY' : 'USD'
        let parsed
        let fallbackError = null
        try {
          parsed = parsePricingHtml(await fetchPricingHtml(locale, wanted))
        } catch (error) {
          fallbackError = error
          parsed = parsePricingHtml(await fetchPricingHtml(locale, wanted === 'CNY' ? 'USD' : 'CNY'))
        }
        const models = { ...ledger.config.prices.models }
        for (const [id, raw] of Object.entries(parsed.models)) {
          const entry = normalizePrice(raw)
          if (entry === null) continue
          // 替换语义:官方页条目字段完整,跨币种切换时不残留另一币种的旧字段。
          models[id] = entry
        }
        const def = normalizePrice(parsed.default)
        const patch = {
          prices: {
            ...ledger.config.prices,
            models,
            // 价表币种标记 + 兜底价随页面同步,避免切换币种后残留旧币种数字。
            currency: parsed.currency === 'CNY' ? 'CNY' : 'USD',
            ...(def === null ? {} : { default: def }),
          },
          priceSource: 'official',
          fetchedAt: new Date().toISOString(),
        }
        if (typeof parsed.effectiveAt === 'string') patch.peakEffectiveAt = parsed.effectiveAt
        else patch.peakEffectiveAt = new Date().toISOString() // 页面已无生效时间:两档方案即时生效
        if (Array.isArray(parsed.peakWindows) && parsed.peakWindows.length > 0) {
          patch.peakWindows = parsed.peakWindows
        }
        const { config, errors } = applyConfigPatch(ledger.config, patch)
        if (errors.length > 0) throw new Error(errors.join(';'))
        ledger.config = config
        ledger.scheduleWrite()
        const ids = Object.keys(parsed.models)
        const joined = ids.join(locale === 'zh' ? '、' : ', ')
        return {
          ok: true,
          message: fallbackError === null
            ? tmsg(locale, 'pricesSynced', { ids: joined })
            : tmsg(locale, 'pricesSyncedFallback', { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError), ids: joined }),
          state: await build(false),
        }
      } catch (error) {
        const detail = error?.code === 'ERR_NO_MODELS'
          ? tmsg(locale, 'noModelsParsed')
          : (error instanceof Error ? error.message : String(error))
        return {
          ok: false,
          message: tmsg(locale, 'priceSyncFailed', { error: detail }),
        }
      }
    },

    async resetHistory() {
      ledger.days = {}
      ledger.scheduleWrite()
      return build(false)
    },

    // 按需读取某一天的完整记录(含会话明细;issue #22):history() 输出为轻量副本
    // 不含会话,历史各天的会话明细由本 RPC 展开时才拉取,避免 state 膨胀。
    async getDaySessions(date) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('invalid date')
      }
      const day = ledger.days[date]
      if (day === undefined) return zeroDay(date)
      const copy = ledger.copyDay(day)
      // 统计口径:子代理的钱算到派它的会话头上(见 foldSubagentRows)。copyDay 返回的是
      // 全新对象,改它不会碰到账本;日合计字段原样保留,所以总数一分不变。
      copy.sessions = await foldSubagentRows(ctx, copy.sessions)
      return copy
    },

    // 本会话的家族 id(自身 + 全部子代理/孙代理):客户端「今日当前会话」按家族
    // 求和 —— 子代理是独立会话、账本单独成行,不合并就漏计(见 makeSessionFamilyReader)。
    async getSessionFamily(sessionId) {
      const root = typeof sessionId === 'string' ? sessionId.trim() : ''
      if (root.length === 0) return { ids: [] }
      return { ids: await sessionFamilyIds(root) }
    },
  }
  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'costMeter', namespace: 'costMeter' },
  })
  return service
}

// ── 插件主体 ───────────────────────────────────────────────────────────────

/**
 * 挂载账本、llm/stream 计费包裹、会话投影与 costMeter 服务。
 * @param ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  const ledger = Ledger.open()

  // 卸载/退出前最终落盘。
  ctx.effect(() => () => ledger.close(), 'cost-timer: ledger close')

  // 包裹 llm/stream:捕获 usage 块(位于 finish 之前),按官方价格计入账本。
  // 本插件是链尾监听者,next() 即适配器流;仅透传数据块,不改变流协议。
  // 嵌套去重(issue #48):modlens/vision-router 等包装路由在自身 stream()
  // 体内再发起 ctx.llm.stream(),旧实现在瀑布每层都记账(同请求 ×2~3);
  // createLlmStreamBilling 用 AsyncLocalStorage 深度标记识别嵌套调用,
  // 只由最外层记一次。
  ctx.on('llm/stream', createLlmStreamBilling({
    account: (usage, model, sessionId, atMs, provider) => {
      ledger.account({
        input: usage.inputTokens ?? 0,
        output: usage.outputTokens ?? 0,
        cacheRead: usage.cacheReadTokens ?? 0,
        cacheWrite: usage.cacheWriteTokens ?? 0,
        reasoning: usage.reasoningTokens ?? 0,
      }, model, sessionId, atMs, provider)
    },
  }))

  // RPC 服务:客户端经 remote.costMeter.* 调用(./typert 清单由 typert-loader 注册)。
  ctx.provide('costMeter', createService(ctx, ledger))

  // 平价投递:宿主看表 + 按会话排队(见 ./alarm.js),到下一个平价段起点把队列投进对应会话;
  // 配置/状态独立存储,不碰 ledger 严格 codec。
  try {
    installCostTimerAlarm(ctx)
    // 启动默认静默(2026-09-17 改,与其它插件一致):只报**需要你注意**的情况 ——
    // 账本落在非默认位置。常规启动不再刷屏。
    // 2026-09-29 起也不再打印「平价投递:N 个会话留了言,xx 投递」:到点自动投递是后台
    // 自己的事,启动时刷这一行只会让人以为有待办;要看就直接看浮窗里的投递表格。
    const notes = []
    if (ledger.path !== defaultLedgerPath()) notes.push(`账本位于非默认位置:${ledger.path}`)
    if (notes.length > 0) console.log(`[dsh-cost-timer] ${notes.join(' | ')}`)
  } catch (error) {
    console.warn('[dsh-cost-timer] 平价投递安装失败: ' + String((error && error.message) || error))
  }
}
