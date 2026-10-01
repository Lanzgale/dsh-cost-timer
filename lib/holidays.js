/**
 * 节假日表装载 —— 全插件**唯一**读取 `holidays.json` 的地方。
 *
 * 数据在插件根目录（`../holidays.json`，与 README 平级，方便直接翻到）；本文件
 * 只负责读它、校验形状、拼出判定用的集合，**不存任何日期副本**。判定规则本身
 * 在 `./pricing.js`（`offpeakDayZoneAt` / `isPeakHour`），消费方（计费、平价投递、
 * 界面）一律用它，不各自维护一份。
 *
 * 读不到文件时不抛错（插件照常启动），但把错误挂在返回值上，由宿主启动日志
 * 与界面提示显式说出来——失败要响，不静默按"没有节假日"糊过去。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** `holidays.json` 的位置（插件根目录）。 */
export const HOLIDAY_TABLE_PATH = fileURLToPath(new URL('../holidays.json', import.meta.url))

const DAY_MS = 86400000
const BJ_OFFSET_MS = 8 * 3600 * 1000

/**
 * 北京时间日期串 YYYY-MM-DD（atMs 所属的北京日历日）。
 * @param {number} atMs - 时刻（epoch ms）。
 * @returns {string}
 */
export function beijingDateKey(atMs) {
  const d = new Date(atMs + BJ_OFFSET_MS)
  const p = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/** 北京时间年份（atMs 所属的北京日历年）。 */
export function beijingYear(atMs) {
  return new Date(atMs + BJ_OFFSET_MS).getUTCFullYear()
}

/**
 * 读取节假日表。
 *
 * @returns {{
 *   dates: Set<string>, years: Set<number>, path: string, source: string,
 *   error: Error|null,
 *   has(atMs: number): boolean, coveredAt(atMs: number): boolean,
 * }} 判定用的集合 + 覆盖情况；`error` 非空表示表没读进来。
 */
export function loadHolidayTable() {
  let raw = null
  let error = null
  try {
    raw = JSON.parse(readFileSync(HOLIDAY_TABLE_PATH, 'utf8'))
  } catch (cause) {
    error = cause instanceof Error ? cause : new Error(String(cause))
  }
  const dates = new Set()
  const years = new Set()
  const table = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw.years : null
  if (table !== null && typeof table === 'object' && !Array.isArray(table)) {
    for (const [yearLabel, list] of Object.entries(table)) {
      const year = Number(yearLabel)
      if (!Number.isInteger(year) || !Array.isArray(list)) continue
      let kept = 0
      for (const item of list) {
        // 只收形如 YYYY-MM-DD 的串；写错的条目跳过（长度/形状自明，改起来看得见）。
        if (typeof item !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item)) continue
        const at = Date.parse(`${item}T00:00:00+08:00`)
        if (!Number.isFinite(at)) continue
        dates.add(item)
        kept += 1
      }
      if (kept > 0) years.add(year)
    }
  }
  return {
    dates,
    years,
    path: HOLIDAY_TABLE_PATH,
    source: raw !== null && typeof raw === 'object' && typeof raw._出处 === 'string' ? raw._出处 : '',
    error,
    has: atMs => dates.has(beijingDateKey(atMs)),
    coveredAt: atMs => years.has(beijingYear(atMs)),
  }
}

/** 供 selftest 用：北京日索引（1970-01-01 为基准；+4 取模得星期，0=周日）。 */
export function beijingDayIndex(atMs) {
  return Math.floor((atMs + BJ_OFFSET_MS) / DAY_MS)
}
