/**
 * dsh-cost-timer 的 Host 面 Typert 清单(由 typert-loader 自动扫描注册)。
 * 手写清单,结构与 @deepseek-ai/dsh-typert-generator 产物一致:
 * `./typert` 导出 TYPERT,invocations 的 codec 必须是 zod v4 实例。
 */

import { z } from 'zod'

const num = z.number()

const sessionSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  at: num.optional(),
  input: num,
  output: num,
  cacheRead: num,
  cacheWrite: num,
  reasoning: num.optional(),
  calls: num,
  cost: num,
  byProviderModel: z.record(z.string(), z.object({ input: num, output: num, cacheRead: num, cacheWrite: num, reasoning: num.optional(), calls: num, cost: num })).optional(),
})

const daySchema = z.object({
  date: z.string(),
  input: num,
  output: num,
  cacheRead: num,
  cacheWrite: num,
  reasoning: num.optional(),
  calls: num,
  cost: num,
  byProviderModel: z.record(z.string(), z.object({ input: num, output: num, cacheRead: num, cacheWrite: num, reasoning: num.optional(), calls: num, cost: num })).optional(),
  sessions: z.array(sessionSchema),
})

// 会话家族(2026-09-28):本会话 + 它派出去的子代理/孙代理的会话 id 清单。
// 子代理是独立会话(账本单独成行),客户端靠这份清单把它们的费用合进「今日当前会话」。
const sessionFamilySchema = z.object({
  ids: z.array(z.string()),
})

const priceTierSchema = z.object({
  cacheHit: num,
  cacheMiss: num,
  output: num,
  reasoning: num.optional(),
})

const providerPriceSchema = z.object({
  input: num.optional(),
  cachedInput: num.optional(),
  cacheRead: num.optional(),
  cacheWrite: num.optional(),
  cacheCreation5m: num.optional(),
  cacheCreation1h: num.optional(),
  output: num.optional(),
  reasoning: num.optional(),
  unpriced: z.boolean().optional(),
  billingMode: z.enum(['flat', 'deepseek-peak', 'batch']).optional(),
  sourceUrl: z.string().optional(),
  checkedAt: z.string().optional(),
  notes: z.string().optional(),
})

/** 拓展价格目录条目:兼容三桶价(DeepSeek,含峰谷子档)与两档简写/未核价(第三方)。 */
const catalogEntrySchema = providerPriceSchema.extend({
  cacheHit: num.optional(),
  cacheMiss: num.optional(),
  unpriced: z.boolean().optional(),
  legacy: z.boolean().optional(),
  offPeak: priceTierSchema.optional(),
  peak: priceTierSchema.optional(),
  legacyBase: priceTierSchema.optional(),
})

const priceSchema = z.object({
  cacheHit: num,
  cacheMiss: num,
  output: num,
  reasoning: num.optional(),
  billingMode: z.enum(['flat', 'deepseek-peak', 'batch']).optional(),
  offPeak: priceTierSchema.optional(),
  peak: priceTierSchema.optional(),
  legacy: z.boolean().optional(),
  legacyBase: priceTierSchema.optional(),
  sourceUrl: z.string().optional(),
  checkedAt: z.string().optional(),
  notes: z.string().optional(),
})

const configSchema = z.object({
  locale: z.enum(['auto', 'zh', 'en']),
  sidebar: z.boolean(),
  currency: z.string(),
  symbol: z.string(),
  decimals: num,
  exchangeRate: num,
  // 官方价格币种(issue #47):USD(美元官方价) | CNY(人民币官方价,按汇率折算入账)。
  pricingCurrency: z.enum(['USD', 'CNY']).optional(),
  peakEnabled: z.boolean(),
  peakEffectiveAt: z.string(),
  peakWindows: z.array(z.object({ start: num, end: num })),
  peakNotice: z.boolean().optional(),
  // 峰/谷切换前弹窗提醒:开关(默认开)/提前分钟数(1-30)/类型(峰|谷|两者)。
  peakAlertEnabled: z.boolean().optional(),
  peakAlertAhead: num.optional(),
  peakAlertTarget: z.enum(['peak', 'offpeak', 'both']).optional(),
  peakAlertPosition: z.enum(['corner', 'center']).optional(),
  peakAlertWebNotify: z.boolean().optional(),
  showSessionId: z.boolean().optional(),
  // UI 隐藏开关(issues #45/#46):开启后官方余额/今日消耗金额的对应 UI 区块整体不渲染。
  hideOfficialBalance: z.boolean().optional(),
  hideTodayCost: z.boolean().optional(),
  // 安装前历史自动导入完成时刻(issue #27,内部标记;0/缺席 = 尚未跑过)。
  legacyAutoImportedAt: num.optional(),
  peakStyle: z.enum(['compact', 'classic']).optional(),
  priceMatch: z.enum(['auto', 'exact']).optional(),
  priceOverrides: z.record(z.string(), z.string()).optional(),
  priceTableDisplay: z.record(z.string(), z.boolean()).optional(),
  prices: z.object({
    // 价表币种标记(issue #47,fetchPrices 写入;zod 默认 strip 未知键,须显式声明才能下发)。
    currency: z.enum(['USD', 'CNY']).optional(),
    models: z.record(z.string(), priceSchema),
    default: priceSchema,
    providers: z.record(z.string(), z.object({ models: z.record(z.string(), providerPriceSchema) })).optional(),
  }),
  budget: z.object({
    enabled: z.boolean(),
    amount: num,
    period: z.enum(['day', 'month', 'all', 'custom']),
    customStart: z.union([z.string(), z.null()]),
    customEnd: z.union([z.string(), z.null()]),
    detail: z.boolean(),
  }),
  codingPlans: z.record(z.string(), z.object({
    enabled: z.boolean().optional(),
    display: z.enum(['sidebar', 'settings', 'both', 'off']).optional(),
    refreshMinutes: num.optional(),
    apiKey: z.string().optional(),
    // SCNet 本地计量专用(issue #26):月度 Credits 额度与订阅起始日;其余厂商无此二键。
    planCredits: num.optional(),
    planStart: z.string().optional(),
  })).optional(),
  balance: z.object({
    display: z.enum(['sidebar', 'settings', 'both', 'off']),
    refreshMinutes: num,
    showProgressBar: z.boolean().optional(),
    budgetCap: z.union([num, z.null()]).optional(),
    reconcile: z.boolean().optional(),
    // 更新后提醒:余额图框点击刷新引导是否已处理(issue #37,内部标记)。
    clickHintSeen: z.boolean().optional(),
  }),
  goQuota: z.object({
    enabled: z.boolean(),
    display: z.enum(['sidebar', 'settings', 'both', 'off']),
    refreshMinutes: num,
    apiKey: z.string(),
    main: z.enum(['rolling', 'weekly', 'monthly']),
    detail: z.boolean(),
  }),
  customBalance: z.object({
    enabled: z.boolean(),
    label: z.string(),
    labelEn: z.string().optional(),
    display: z.enum(['sidebar', 'settings', 'both', 'off']),
    unit: z.enum(['USD', 'CNY', 'EUR']).optional(),
    refreshMinutes: num,
    request: z.object({
      url: z.string(),
      method: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.unknown().optional(),
    }),
    extract: z.record(z.string(), z.unknown()),
  }).optional(),
  historyDays: num,
  fetchedAt: z.union([z.string(), z.null()]),
  priceSource: z.string(),
})

const balanceSchema = z.object({
  status: z.enum(['off', 'ok', 'error']),
  message: z.string(),
  fetchedAt: num,
  currency: z.string(),
  totalBalance: num,
  grantedBalance: num,
  toppedUpBalance: num,
})

const goWindowSchema = z.union([
  z.object({ percent: num, resetsAt: z.string() }),
  z.null(),
])

const goQuotaSchema = z.object({
  status: z.enum(['off', 'ok', 'error']),
  message: z.string(),
  fetchedAt: num,
  rolling: goWindowSchema,
  weekly: goWindowSchema,
  monthly: goWindowSchema,
})

const customBalanceSchema = z.object({
  status: z.enum(['off', 'ok', 'error']),
  message: z.string(),
  fetchedAt: num,
  label: z.string(),
  unit: z.string(),
  remaining: num,
  maxBudget: z.union([num, z.null()]),
  spend: z.union([num, z.null()]),
})

// Coding plan 额度状态条目(运行时合并配置与查询结果;windows 为各用量窗口)。
const codingPlanSchema = z.object({
  enabled: z.boolean(),
  display: z.enum(['sidebar', 'settings', 'both', 'off']),
  refreshMinutes: num,
  apiKey: z.string(),
  status: z.enum(['off', 'ok', 'error']),
  message: z.string(),
  fetchedAt: num,
  windows: z.record(z.string(), z.object({ percent: num.optional(), resetsAt: z.string(), text: z.string().optional() })),
})

export const stateSchema = z.object({
  today: daySchema,
  month: daySchema,
  total: daySchema,
  budgetUsed: num,
  balance: balanceSchema,
  goQuota: goQuotaSchema,
  // optional:兼容旧快照/降级路径(与 codingPlans/priceCatalog 同策略,避免 strict codec 击穿)。
  customBalance: customBalanceSchema.optional(),
  // 余额差交叉校验提示(issue #18):旧快照无此字段,optional 防击穿。
  reconcile: z.object({ ok: z.boolean(), message: z.string() }).optional(),
  // 当日余额基准(零点首次拉取/充值后重置;对账 drift 检测用)。旧快照/未对账时缺失或 null。
  balanceRef: z.object({
    date: z.string(),
    total: num,
    granted: num,
    topped: num,
    currency: z.string().optional(),
    at: num,
  }).nullable().optional(),
  // 充值基准(2026-09-17:卡片余额条满格 = 上次充值后的余额,不随日期重置)。
  // 旧快照无此字段,optional 防击穿(getState 校验失败会整体不可用)。
  rechargeRef: z.object({
    total: num,
    granted: num,
    topped: num,
    currency: z.string().optional(),
    at: num,
  }).nullable().optional(),
  codingPlans: z.record(z.string(), codingPlanSchema),
  history: z.array(daySchema),
  config: configSchema,
  priceCatalog: z.record(z.string(), z.record(z.string(), z.record(z.string(), catalogEntrySchema))).optional(),
  meta: z.object({
    now: num,
    timezoneOffsetMinutes: num,
    dayKey: z.string(),
    monthKey: z.string(),
  }),
})

const patchSchema = z.record(z.string(), z.unknown())

const fetchPricesSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  state: stateSchema.optional(),
})

const _state$codec = { mode: 'strict', typeSymbol: 'dsh-cost-timer#CostState', schema: stateSchema }
const _patch$codec = { mode: 'strict', typeSymbol: 'dsh-cost-timer#ConfigPatch', schema: patchSchema }
const _fetch$codec = { mode: 'strict', typeSymbol: 'dsh-cost-timer#FetchPricesResult', schema: fetchPricesSchema }
const _provider$codec = { mode: 'strict', typeSymbol: 'dsh-cost-timer#CodingPlanProvider', schema: z.string() }
const _day$codec = { mode: 'strict', typeSymbol: 'dsh-cost-timer#DayRecord', schema: daySchema }
const _date$codec = { mode: 'strict', typeSymbol: 'dsh-cost-timer#DayKey', schema: z.string() }
const _sessionFamily$codec = { mode: 'strict', typeSymbol: 'dsh-cost-timer#SessionFamily', schema: sessionFamilySchema }
const _sessionId$codec = { mode: 'strict', typeSymbol: 'dsh-cost-timer#SessionId', schema: z.string() }

export const TYPERT = {
  package: 'dsh-cost-timer',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-cost-timer#costMeter/getState',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'getState',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _state$codec,
    },
    {
      id: 'dsh-cost-timer#costMeter/updateConfig',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'updateConfig',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'patch', wire: 'patch', source: 'json', codec: _patch$codec },
      ],
      result: _state$codec,
    },
    {
      id: 'dsh-cost-timer#costMeter/fetchPrices',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'fetchPrices',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _fetch$codec,
    },
    {
      id: 'dsh-cost-timer#costMeter/refreshBalance',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'refreshBalance',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _fetch$codec,
    },
    {
      id: 'dsh-cost-timer#costMeter/resetHistory',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'resetHistory',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _state$codec,
    },
    {
      id: 'dsh-cost-timer#costMeter/getDaySessions',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'getDaySessions',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'date', wire: 'date', source: 'json', codec: _date$codec },
      ],
      result: _day$codec,
    },
    {
      id: 'dsh-cost-timer#costMeter/getSessionFamily',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'getSessionFamily',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'sessionId', wire: 'sessionId', source: 'json', codec: _sessionId$codec },
      ],
      result: _sessionFamily$codec,
    },
  ],
  model: {
    services: [
      {
        description: 'dsh-cost-timer 账本与配置服务(ctx.costMeter),聚合每日模型用量与费用。Ledger and config service (ctx.costMeter) aggregating daily model usage and cost.',
        summary: 'dsh-cost-timer 账本与配置服务 (dsh-cost-timer ledger & config service)。',
        tags: [],
        jsDoc: '/** dsh-cost-timer 账本与配置服务(ctx.costMeter)。dsh-cost-timer ledger & config service (ctx.costMeter). */',
        key: 'costMeter',
        exportName: 'CostMeterService',
        members: [
          {
            kind: 'method',
            name: 'getState',
            signature: 'getState(): CostState',
            summary: '读取今日/本月/累计聚合、历史记录与当前配置。Read today/month/total aggregates, history, and current config.',
            jsDoc: '/**\n * 读取今日/本月/累计聚合、历史记录与当前配置。\n * @returns 完整账本快照。\n * Read today/month/total aggregates, history, and current config.\n * @returns The full ledger snapshot.\n */',
          },
          {
            kind: 'method',
            name: 'updateConfig',
            signature: 'updateConfig(patch: ConfigPatch): CostState',
            summary: '深合并一份配置补丁并持久化。Deep-merge a config patch and persist it.',
            jsDoc: '/**\n * 深合并一份配置补丁并持久化。\n * @param patch - 配置补丁。\n * @returns 更新后的完整快照。\n * Deep-merge a config patch and persist it.\n * @param patch - The config patch.\n * @returns The updated full snapshot.\n */',
          },
          {
            kind: 'method',
            name: 'fetchPrices',
            signature: 'fetchPrices(): Promise<FetchPricesResult>',
            summary: '抓取官方定价页并应用解析出的价格。Fetch the official pricing page and apply the parsed prices.',
            jsDoc: '/**\n * 抓取官方定价页并应用解析出的价格。\n * @returns 抓取与应用结果。\n * Fetch the official pricing page and apply the parsed prices.\n * @returns The fetch-and-apply result.\n */',
          },
          {
            kind: 'method',
            name: 'refreshBalance',
            signature: 'refreshBalance(): Promise<FetchPricesResult>',
            summary: '立即查询官方开放平台账户余额。Query the official open-platform account balance immediately.',
            jsDoc: '/**\n * 立即查询官方开放平台账户余额。\n * @returns 查询结果与最新快照。\n * Query the official open-platform account balance immediately.\n * @returns The query result and the latest snapshot.\n */',
          },
          {
            kind: 'method',
            name: 'resetHistory',
            signature: 'resetHistory(): CostState',
            summary: '清空全部历史记录。Clear all history records.',
            jsDoc: '/**\n * 清空全部历史记录。\n * @returns 清空后的完整快照。\n * Clear all history records.\n * @returns The full snapshot after clearing.\n */',
          },
          {
            kind: 'method',
            name: 'getDaySessions',
            signature: 'getDaySessions(date: string): DayRecord',
            summary: '按需读取某一天的完整记录(含会话明细)。Read a day\'s full record on demand (with session details).',
            jsDoc: '/**\n * 按需读取某一天的完整记录(含会话明细;历史记录列表为轻量副本不含会话)。\n * @param date - 本地日期键 YYYY-MM-DD。\n * @returns 该日完整记录;不存在时返回零值记录。\n * Read a day\'s full record on demand (with session details; the history list is a light copy without sessions).\n * @param date - Local day key YYYY-MM-DD.\n * @returns The full day record; a zero record when absent.\n */',
          },
          {
            kind: 'method',
            name: 'getSessionFamily',
            signature: 'getSessionFamily(sessionId: string): SessionFamily',
            summary: '返回某会话的家族 id(自身 + 全部子代理/孙代理)。Return one session\'s family ids (itself plus every descendant subagent).',
            jsDoc: '/**\n * 返回某会话的家族 id 清单:自身 + 它派出去的子代理(含嵌套孙代理)。\n * 子代理是独立会话、账本单独成行,客户端据此把子代理费用合进「今日当前会话」。\n * @param sessionId - 会话 id(空字符串返回空清单)。\n * @returns { ids } 家族会话 id 数组,根会话在前。\n * Return one session\'s family ids: itself plus every subagent it delegated to (nested descendants included).\n * @param sessionId - Session id (empty string yields an empty list).\n * @returns { ids } Family session ids, root first.\n */',
          },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}

export default TYPERT
