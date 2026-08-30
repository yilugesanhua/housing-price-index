const { createHash } = require('node:crypto')
const cheerio = require('cheerio')

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS
const OFFICIAL_HOST = 'www.stats.gov.cn'
const OFFICIAL_LIST_URL = 'https://www.stats.gov.cn/sj/zxfb/index.html'
const MONTH_GRID_CALENDAR_URL = 'https://www.stats.gov.cn/sj/fbrc/index_fbrc.html'
const RELEASE_CALENDAR_URL = 'https://www.stats.gov.cn/sj/fbrc/bnxxfb/'
const OFFICIAL_RELEASE_PREFIXES = ['/sj/zxfb/', '/xxgk/sjfb/zxfb2020/']
const DISCOVERY_MINUTES = Object.freeze([15, 35, 55])
const DISCOVERY_OBSERVATION_ROOT = 'housing-data/discovery/observations'
const DEFAULT_CLOUD_STORAGE_ROOT = 'cloud://cloud1-d3gpdx70w5d05c68c.636c-cloud1-d3gpdx70w5d05c68c-1456861154'
const MAX_FETCH_ATTEMPTS = 3
const RETRY_DELAY_MS = 800
const REQUEST_TIMEOUT_MS = 30_000
const KNOWN_REPORT_NAMES = new Set([
  '商品住宅销售价格指数月度报告',
  '70个大中城市商品住宅销售价格变动情况',
])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isStatMonth(value) {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(value || '')
}

function nextStatMonth(value) {
  if (!isStatMonth(value)) throw new Error('统计月份格式无效')
  const date = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function timestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : null
}

function floorMinute(value) {
  return Math.floor(value / MINUTE_MS) * MINUTE_MS
}

function scheduleKindAt(value) {
  if (!Number.isFinite(value)) return null
  const date = new Date(value)
  const hour = date.getUTCHours()
  const minute = date.getUTCMinutes()
  if (hour === 1 && minute === 0) return 'calendar'
  if (hour >= 1 && hour <= 9 && DISCOVERY_MINUTES.includes(minute)) return 'discovery'
  return null
}

function isExpectedScheduleSlot(value) {
  return scheduleKindAt(value) !== null
}

function buildSlotId(plannedAt) {
  const parsed = timestamp(plannedAt)
  if (parsed === null || !isExpectedScheduleSlot(parsed)) throw new Error('时段计划时间无效')
  return new Date(parsed).toISOString()
}

function parseSlotId(slotId) {
  if (typeof slotId !== 'string') return null
  const parsed = timestamp(slotId)
  if (parsed === null || new Date(parsed).toISOString() !== slotId || !isExpectedScheduleSlot(parsed)) return null
  return makeSlot(parsed)
}

function observationObjectKey(slotId) {
  const parsed = parseSlotId(slotId)
  if (!parsed) throw new Error('观察对象时段身份无效')
  return `${DISCOVERY_OBSERVATION_ROOT}/${sha256(parsed.slot_id)}.json`
}

function observationFileId(slotId) {
  return `${DEFAULT_CLOUD_STORAGE_ROOT}/${observationObjectKey(slotId)}`
}

function makeSlot(plannedAt) {
  const kind = scheduleKindAt(plannedAt)
  if (!kind) return null
  const planned_at = new Date(plannedAt).toISOString()
  return { slot_id: planned_at, kind, planned_at, planned_at_ms: plannedAt }
}

function latestScheduledSlot(now = Date.now(), lookbackMinutes = 24 * 60) {
  if (!Number.isFinite(now) || !Number.isSafeInteger(lookbackMinutes) || lookbackMinutes < 1) return null
  const latestMinute = floorMinute(now)
  for (let offset = 0; offset <= lookbackMinutes; offset += 1) {
    const candidate = latestMinute - offset * MINUTE_MS
    const slot = makeSlot(candidate)
    if (slot) return slot
  }
  return null
}

function previousScheduledSlot(plannedAt, lookbackMinutes = 24 * 60) {
  const parsed = timestamp(plannedAt)
  if (parsed === null) return null
  return latestScheduledSlot(parsed - MINUTE_MS, lookbackMinutes)
}

function slotsForControllerTick(now = Date.now()) {
  const current = latestScheduledSlot(now)
  if (!current) return []
  const previous = previousScheduledSlot(current.planned_at_ms)
  const slots = previous ? [previous, current] : [current]
  return slots.filter((slot, index) => slots.findIndex((candidate) => candidate.slot_id === slot.slot_id) === index)
}

function slotPolicy(slot) {
  if (!slot || !['calendar', 'discovery'].includes(slot.kind) || !Number.isFinite(slot.planned_at_ms)) {
    throw new Error('时段记录无效')
  }
  const plannedAt = slot.planned_at_ms
  const nextBoundary = slot.kind === 'calendar' ? plannedAt + 15 * MINUTE_MS : plannedAt + 20 * MINUTE_MS
  const dailyCutoff = Date.UTC(
    new Date(plannedAt).getUTCFullYear(),
    new Date(plannedAt).getUTCMonth(),
    new Date(plannedAt).getUTCDate(),
    10,
    0,
    0,
    0,
  )
  const retryDeadlineAt = Math.min(nextBoundary, dailyCutoff)
  return {
    ...slot,
    start_deadline_at: new Date(plannedAt + 2 * MINUTE_MS).toISOString(),
    start_deadline_at_ms: plannedAt + 2 * MINUTE_MS,
    retry_deadline_at: new Date(retryDeadlineAt).toISOString(),
    retry_deadline_at_ms: retryDeadlineAt,
  }
}

function discoverySlotsForBeijingDate(dateText) {
  const match = /^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(dateText || '')
  if (!match) throw new Error('北京时间日期无效')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const validation = new Date(Date.UTC(year, month - 1, day))
  if (validation.getUTCFullYear() !== year || validation.getUTCMonth() !== month - 1 || validation.getUTCDate() !== day) {
    throw new Error('北京时间日期无效')
  }
  const slots = []
  for (let hour = 1; hour <= 9; hour += 1) {
    for (const minute of DISCOVERY_MINUTES) slots.push(makeSlot(Date.UTC(year, month - 1, day, hour, minute)))
  }
  return slots
}

function scheduledSlotsForBeijingDate(dateText) {
  const discoverySlots = discoverySlotsForBeijingDate(dateText)
  const firstDiscovery = discoverySlots[0]
  const calendarSlot = makeSlot(firstDiscovery.planned_at_ms - 15 * MINUTE_MS)
  return [calendarSlot, ...discoverySlots]
}

function beijingDateText(value) {
  if (!Number.isFinite(value)) throw new Error('北京时间无效')
  return new Date(value + 8 * 60 * MINUTE_MS).toISOString().slice(0, 10)
}

function previousBeijingDate(dateText) {
  const parsed = Date.parse(`${dateText}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) throw new Error('北京时间日期无效')
  return new Date(parsed - DAY_MS).toISOString().slice(0, 10)
}

function dueSlotsForController(now = Date.now()) {
  if (!Number.isFinite(now)) return []
  // Keep the prior Beijing day eligible until the next controller cycle can
  // write explicit expired records. A scheduler outage therefore leaves an
  // auditable missing-slot result instead of silently losing that day.
  const currentDate = beijingDateText(now)
  const dates = [previousBeijingDate(currentDate), currentDate]
  return dates.flatMap((dateText) => scheduledSlotsForBeijingDate(dateText))
    .filter((slot) => slot.planned_at_ms <= now && now - slot.planned_at_ms <= DAY_MS)
    .filter((slot, index, slots) => slots.findIndex((candidate) => candidate.slot_id === slot.slot_id) === index)
    .sort((left, right) => left.planned_at_ms - right.planned_at_ms)
}

function cleanText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractStatMonth(title) {
  const match = String(title || '').match(/(20\d{2})年(\d{1,2})月份/)
  if (!match) return null
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? `${match[1]}-${String(month).padStart(2, '0')}` : null
}

function isOfficialReleaseUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === OFFICIAL_HOST && url.pathname.endsWith('.html')
      && OFFICIAL_RELEASE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  } catch {
    return false
  }
}

function assertOfficialUrl(value, allowedPrefixes) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== OFFICIAL_HOST || !allowedPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
    throw new Error(`官方来源重定向到白名单外地址：${value}`)
  }
  return url
}

function canonicalCalendarText(calendar) {
  return JSON.stringify({
    year: calendar.year,
    source_urls: calendar.source_urls ?? [calendar.source_url],
    raw_content_sha256: calendar.raw_content_sha256,
    entries: calendar.entries,
  })
}

function buildReleaseIdempotencyKey(expectedStatMonth, officialUrl) {
  if (!isStatMonth(expectedStatMonth) || !isOfficialReleaseUrl(officialUrl)) throw new Error('发现交接身份无效')
  return sha256(`${expectedStatMonth}\n${officialUrl}`)
}

function evaluateReleaseSchedule(calendar, manifest, now = new Date()) {
  const datasetAsOf = typeof manifest?.dataset_as_of === 'string' ? manifest.dataset_as_of : null
  const nextEntry = (calendar?.entries || []).find((entry) => !datasetAsOf || entry.expected_stat_month > datasetAsOf) ?? null
  if (!nextEntry) {
    return { should_check_official: false, release_window: 'calendar_exhausted', scheduled_release_at: null, expected_stat_month: null, days_until_release: null }
  }
  const scheduledTime = Date.parse(nextEntry.scheduled_at)
  if (!Number.isFinite(scheduledTime)) throw new Error(`发布预告包含无效时间：${nextEntry.scheduled_at}`)
  const millisecondsUntilRelease = scheduledTime - now.getTime()
  const daysUntilRelease = Math.ceil(millisecondsUntilRelease / DAY_MS)
  const earlyPollingMs = 30 * MINUTE_MS
  const overdueMs = 60 * MINUTE_MS
  if (millisecondsUntilRelease > earlyPollingMs) {
    return { should_check_official: false, release_window: 'waiting', scheduled_release_at: nextEntry.scheduled_at, expected_stat_month: nextEntry.expected_stat_month, days_until_release: daysUntilRelease }
  }
  return {
    should_check_official: true,
    release_window: now.getTime() - scheduledTime >= overdueMs ? 'overdue' : 'active',
    scheduled_release_at: nextEntry.scheduled_at,
    expected_stat_month: nextEntry.expected_stat_month,
    days_until_release: daysUntilRelease,
  }
}

function waitingResult(decision, manifest, checkedAt) {
  const calendarExhausted = decision.release_window === 'calendar_exhausted'
  return {
    status: 'waiting',
    checked_at: checkedAt,
    dataset_as_of: typeof manifest?.dataset_as_of === 'string' ? manifest.dataset_as_of : null,
    latest_official_month: null,
    latest_official_url: null,
    next_check_due_at: typeof manifest?.next_check_due_at === 'string' ? manifest.next_check_due_at : null,
    scheduled_release_at: decision.scheduled_release_at,
    expected_stat_month: decision.expected_stat_month,
    days_until_release: decision.days_until_release,
    release_window: decision.release_window,
    official_list_checked: false,
    official_release_detected: false,
    reasons: [calendarExhausted
      ? '本年度日程中没有晚于当前数据集的发布安排，等待国家统计局更新年度预告'
      : `下一期 ${decision.expected_stat_month} 数据预告于 ${decision.scheduled_release_at} 发布，尚未进入检查窗口`],
  }
}

function evaluateLatestCheck(discovery, manifest, now = new Date(), decision = null) {
  const reasons = []
  const pages = Array.isArray(discovery?.pages) ? discovery.pages : []
  const datedPages = pages
    .map((page) => ({ ...page, stat_month: extractStatMonth(page?.title) }))
    .filter((page) => Boolean(page.stat_month))
  const latestPage = datedPages.sort((left, right) => right.stat_month.localeCompare(left.stat_month))[0] ?? null
  const datasetAsOf = typeof manifest?.dataset_as_of === 'string' ? manifest.dataset_as_of : null
  const nextCheckDueAt = typeof manifest?.next_check_due_at === 'string' ? manifest.next_check_due_at : null
  const expectedNextMonth = isStatMonth(datasetAsOf) ? nextStatMonth(datasetAsOf) : null

  if (pages.length === 0) reasons.push('官方发布列表未发现任何70城住宅价格页面')
  else if (datedPages.length === 0) reasons.push('发现的官方页面标题无法解析统计月份，页面结构可能已变化')
  if (!isStatMonth(datasetAsOf)) reasons.push('发布清单缺少有效的 dataset_as_of')
  if (!nextCheckDueAt || !Number.isFinite(Date.parse(nextCheckDueAt))) reasons.push('发布清单缺少有效的 next_check_due_at')
  if (decision?.expected_stat_month && expectedNextMonth && decision.expected_stat_month !== expectedNextMonth) {
    reasons.push(`官方日程预期月份 ${decision.expected_stat_month} 与当前数据的严格下一月 ${expectedNextMonth} 不一致`)
  }
  if (latestPage && datasetAsOf && latestPage.stat_month < datasetAsOf) reasons.push(`官方发现结果最新为 ${latestPage.stat_month}，早于已发布的 ${datasetAsOf}`)
  if (latestPage && expectedNextMonth && latestPage.stat_month > expectedNextMonth) reasons.push(`官方发现结果最新为 ${latestPage.stat_month}，跳过了当前数据的严格下一月 ${expectedNextMonth}`)

  let status = reasons.length > 0 ? 'anomaly' : 'current'
  if (status === 'current' && latestPage && expectedNextMonth && latestPage.stat_month === expectedNextMonth) {
    status = 'update_available'
    reasons.push(`国家统计局已发布 ${latestPage.stat_month}，当前网站仍为 ${datasetAsOf}`)
  } else if (status === 'current' && !decision && nextCheckDueAt && now.getTime() > Date.parse(nextCheckDueAt)) {
    status = 'anomaly'
    reasons.push(`已超过下次检查期限 ${nextCheckDueAt}`)
  }

  const officialReleaseDetected = Boolean(decision?.expected_stat_month && latestPage && latestPage.stat_month === decision.expected_stat_month)
  if (status === 'current' && decision?.release_window === 'overdue' && !officialReleaseDetected) {
    status = 'anomaly'
    reasons.push(`已超过预告发布时间1小时，仍未发现 ${decision.expected_stat_month} 正式发布页；可能延期或官方页面结构已变化`)
  } else if (status === 'current' && decision?.release_window === 'active' && !officialReleaseDetected) {
    reasons.push(`已进入 ${decision.expected_stat_month} 发布窗口，尚未发现正式发布页，将按计划继续检查`)
  }

  if (status === 'current' && !decision) reasons.push('官方最新月份与当前发布月份一致，且未超过检查期限')
  return {
    status,
    checked_at: typeof discovery?.checked_at === 'string' ? discovery.checked_at : now.toISOString(),
    dataset_as_of: datasetAsOf,
    latest_official_month: latestPage?.stat_month ?? null,
    latest_official_url: latestPage?.href ?? null,
    next_check_due_at: nextCheckDueAt,
    scheduled_release_at: decision?.scheduled_release_at ?? null,
    expected_stat_month: decision?.expected_stat_month ?? null,
    days_until_release: decision?.days_until_release ?? null,
    release_window: decision?.release_window ?? null,
    official_list_checked: true,
    official_release_detected: officialReleaseDetected,
    reasons,
  }
}

function scoreReleaseReportName(value) {
  const name = cleanText(value).replace(/[\s，,。；;：:（）()、]/g, '')
  if (KNOWN_REPORT_NAMES.has(name)) return 100
  if (!name.includes('住宅') || !name.includes('价格')) return 0
  if (!/(商品|销售)/.test(name) || !/(指数|变动|变化)/.test(name)) return 0
  const hasCityScope = /(70个大中城市|七十个大中城市|70城|大中城市)/.test(name)
  const hasMonthlyScope = /(月度|月报)/.test(name)
  if (!hasCityScope && !hasMonthlyScope) return 0
  return 5
    + (name.includes('商品住宅') ? 2 : 0)
    + (name.includes('销售价格') ? 2 : 0)
    + (hasCityScope ? 3 : 0)
    + (hasMonthlyScope ? 2 : 0)
    + (/(报告|情况)/.test(name) ? 1 : 0)
}

function findReportRow($) {
  const candidates = $('tr').map((_, row) => {
    const cells = $(row).find('td').map((__, cell) => cleanText($(cell).text())).get()
    const reportName = cells[1] ?? ''
    return { row, reportName, score: scoreReleaseReportName(reportName) }
  }).get().filter((candidate) => candidate.score > 0).sort((left, right) => right.score - left.score)
  if (candidates.length === 0) throw new Error('发布预告页面未找到70城商品住宅销售价格报告')
  if (candidates[1]?.score === candidates[0].score) {
    throw new Error(`发布预告存在多个同等匹配报告，无法安全选择：${candidates[0].reportName}；${candidates[1].reportName}`)
  }
  return candidates[0]
}

function previousMonth(year, month) {
  const date = new Date(Date.UTC(year, month - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function parseScheduledAt(year, month, dateText, timeText) {
  const dayMatch = cleanText(dateText).match(/^(\d{1,2})(?:\s*[\/／].*)?$/)
  const timeMatch = cleanText(timeText).match(/^(\d{1,2}):(\d{2})$/)
  if (!dayMatch || !timeMatch) throw new Error(`发布预告日期或时间无效：${dateText} ${timeText}`)
  const day = Number(dayMatch[1])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const validation = new Date(Date.UTC(year, month - 1, day))
  if (validation.getUTCFullYear() !== year || validation.getUTCMonth() !== month - 1 || validation.getUTCDate() !== day || hour > 23 || minute > 59) {
    throw new Error(`发布预告日期无效：${dateText}`)
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`
}

function parseReleaseCalendarHtml(html, fetchedAt = new Date().toISOString(), sourceUrl = RELEASE_CALENDAR_URL) {
  const $ = cheerio.load(html)
  const pageText = cleanText($.root().text())
  const year = Number(pageText.match(/(20\d{2})年国家统计局主要统计信息发布日程表/)?.[1])
  if (!Number.isInteger(year)) throw new Error('发布预告页面未找到年度日程表标题')
  const matched = findReportRow($)
  const targetRow = $(matched.row)
  const dateCells = targetRow.find('td').map((_, cell) => cleanText($(cell).text())).get()
  const timeCells = targetRow.next('tr').find('td').map((_, cell) => cleanText($(cell).text())).get()
  if (dateCells.length !== 14 || timeCells.length !== 12) {
    throw new Error(`发布预告目标行结构异常：日期单元格 ${dateCells.length}，时间单元格 ${timeCells.length}`)
  }
  if (dateCells[1] !== matched.reportName) throw new Error('发布预告目标行标题位置发生变化')
  const entries = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const dateText = dateCells[index + 2]
    const timeText = timeCells[index]
    return {
      release_month: `${year}-${String(month).padStart(2, '0')}`,
      expected_stat_month: previousMonth(year, month),
      scheduled_at: parseScheduledAt(year, month, dateText, timeText),
      date_text: dateText,
      time_text: timeText,
    }
  })
  return { year, fetched_at: fetchedAt, source_url: sourceUrl, report_name: matched.reportName, raw_content_sha256: sha256(html), entries }
}

function parseMonthGridDate(value) {
  const match = String(value || '').match(/^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/)
  if (!match) throw new Error(`月度发布日历包含无效日期：${value}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const validation = new Date(Date.UTC(year, month - 1, day))
  if (validation.getUTCFullYear() !== year || validation.getUTCMonth() !== month - 1 || validation.getUTCDate() !== day) throw new Error(`月度发布日历包含无效日期：${value}`)
  return { year, month, day }
}

function parseMonthGridCalendar(text, fetchedAt = new Date().toISOString(), sourceUrl = MONTH_GRID_CALENDAR_URL) {
  let records
  try {
    const normalized = String(text || '').trim().replace(/,\s*]$/, ']')
    const parsed = JSON.parse(normalized)
    if (!Array.isArray(parsed)) throw new Error('root is not an array')
    records = parsed
  } catch (error) {
    throw new Error(`月度发布日历不是有效JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  const candidates = records
    .map((record) => {
      const compactDate = typeof record?.SUB_TITLE === 'string' ? record.SUB_TITLE.trim() : ''
      const reportName = typeof record?.TITLE === 'string' ? cleanText(record.TITLE) : ''
      return { compactDate, reportName, score: scoreReleaseReportName(reportName) }
    })
    .filter((candidate) => candidate.score > 0)
    .map((candidate) => ({ ...candidate, ...parseMonthGridDate(candidate.compactDate) }))
  if (candidates.length === 0) throw new Error('月度发布日历未找到70城商品住宅销售价格报告')
  const years = [...new Set(candidates.map((candidate) => candidate.year))].sort((left, right) => right - left)
  const year = years[0]
  const entries = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const monthly = candidates.filter((candidate) => candidate.year === year && candidate.month === month).sort((left, right) => right.score - left.score)
    if (monthly.length === 0) throw new Error(`月度发布日历缺少${year}年${month}月目标报告`)
    if (monthly[1]?.score === monthly[0].score) throw new Error(`月度发布日历${year}年${month}月存在多个同等匹配报告，无法安全选择`)
    const selected = monthly[0]
    return {
      release_month: `${year}-${String(month).padStart(2, '0')}`,
      expected_stat_month: previousMonth(year, month),
      scheduled_at: parseScheduledAt(year, month, String(selected.day), '9:30'),
      date_text: String(selected.day),
      time_text: '9:30',
    }
  })
  const reportNames = [...new Set(candidates.filter((candidate) => candidate.year === year).map((candidate) => candidate.reportName))]
  return {
    year,
    fetched_at: fetchedAt,
    source_url: sourceUrl,
    source_urls: [sourceUrl],
    report_name: reportNames.join(' / '),
    raw_content_sha256: sha256(text),
    entries,
  }
}

function mergeReleaseCalendars(monthGrid, annual) {
  if (monthGrid.year !== annual.year) throw new Error(`两个官方发布日程年份不一致：${monthGrid.year} 与 ${annual.year}`)
  const entries = monthGrid.entries.map((entry) => {
    const annualEntry = annual.entries.find((candidate) => candidate.release_month === entry.release_month)
    if (!annualEntry) throw new Error(`年度发布日程缺少 ${entry.release_month}`)
    if (entry.scheduled_at.slice(0, 10) !== annualEntry.scheduled_at.slice(0, 10)) {
      throw new Error(`两个官方发布日程的 ${entry.release_month} 日期不一致：${entry.scheduled_at.slice(0, 10)} 与 ${annualEntry.scheduled_at.slice(0, 10)}`)
    }
    return annualEntry
  })
  return {
    ...monthGrid,
    fetched_at: [monthGrid.fetched_at, annual.fetched_at].sort().at(-1) ?? monthGrid.fetched_at,
    source_urls: [monthGrid.source_url, annual.source_url],
    raw_content_sha256: sha256(`${monthGrid.raw_content_sha256}:${annual.raw_content_sha256}`),
    entries,
  }
}

class OfficialResponseError extends Error {
  constructor(message, retryable) {
    super(message)
    this.retryable = retryable
  }
}

function isTransientNetworkFailure(error, seen = new Set()) {
  if (!error || typeof error !== 'object' || seen.has(error)) return false
  seen.add(error)
  // Node fetch raises this DOMException when the per-request AbortSignal
  // expires. It is an upstream transport timeout, so it is safe to retry.
  if (error.name === 'TimeoutError') return true
  if (typeof error.code === 'string' && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.code)) return true
  if (Array.isArray(error.errors) && error.errors.some((nested) => isTransientNetworkFailure(nested, seen))) return true
  return isTransientNetworkFailure(error.cause, seen)
}

function shouldRetry(error) {
  return error instanceof OfficialResponseError ? error.retryable : isTransientNetworkFailure(error)
}

async function fetchOfficialText(url, {
  fetchImpl = globalThis.fetch,
  retryDelayMs = RETRY_DELAY_MS,
  timeoutMs = REQUEST_TIMEOUT_MS,
  purpose = 'monthly release monitoring',
  allowedPrefixes = ['/'],
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('官方来源请求能力不可用')
  assertOfficialUrl(url, allowedPrefixes)
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': `HousingPriceIndexBot/0.1 (+${purpose})` },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response?.ok) {
        throw new OfficialResponseError(`官方来源 ${url} 返回 HTTP ${response?.status}`, response?.status === 408 || response?.status === 429 || response?.status >= 500)
      }
      const finalUrl = response.url || url
      assertOfficialUrl(finalUrl, allowedPrefixes)
      const text = await response.text()
      if (!text) throw new OfficialResponseError(`官方来源 ${finalUrl} 返回空正文`, true)
      return {
        text,
        final_url: finalUrl,
        response: {
          requested_url: url,
          final_url: finalUrl,
          status: response.status,
          content_length: Buffer.byteLength(text),
          content_sha256: sha256(text),
          attempt,
        },
      }
    } catch (error) {
      if (attempt === MAX_FETCH_ATTEMPTS || !shouldRetry(error)) throw error
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs * attempt))
    }
  }
  throw new Error(`官方来源 ${url} 在 ${MAX_FETCH_ATTEMPTS} 次尝试后仍不可用`)
}

async function discoverOfficialPages(requestedLimit = 0, options = {}) {
  const listOptions = { ...options, purpose: 'monthly release monitoring', allowedPrefixes: ['/sj/zxfb/'] }
  const first = await fetchOfficialText(OFFICIAL_LIST_URL, listOptions)
  const declaredPageCount = Number(first.text.match(/createPageHTML\((\d+),/)?.[1] ?? '1')
  if (!Number.isSafeInteger(declaredPageCount) || declaredPageCount < 1 || declaredPageCount > 500) throw new Error('官方发布列表分页数量无效')
  const pageCount = requestedLimit > 0 ? Math.min(requestedLimit, declaredPageCount) : declaredPageCount
  const discovered = []
  const responses = []
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = pageIndex === 0 ? first : await fetchOfficialText(new URL(`index_${pageIndex}.html`, OFFICIAL_LIST_URL).href, listOptions)
    responses.push(page.response)
    const $ = cheerio.load(page.text)
    discovered.push(...$('a[href]').toArray()
      .map((node) => ({
        title: $(node).attr('title')?.trim() || $(node).text().replace(/\s+/g, ' ').trim(),
        href: new URL($(node).attr('href'), OFFICIAL_LIST_URL).href,
      }))
      .filter((item) => /70个大中城市.*住宅销售价格.*变动情况/.test(item.title))
      .filter((item) => isOfficialReleaseUrl(item.href)))
    if (pageIndex + 1 < pageCount) await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
  }
  const pages = [...new Map(discovered.map((item) => [`${item.title}|${item.href}`, item])).values()].sort((left, right) => left.href.localeCompare(right.href))
  return { checked_at: new Date().toISOString(), list_url: OFFICIAL_LIST_URL, pages_checked: pageCount, pages, responses }
}

async function fetchReleaseCalendar(options = {}) {
  const calendarOptions = { ...options, purpose: 'monthly release calendar', allowedPrefixes: ['/sj/fbrc/'] }
  const fetchedAt = new Date().toISOString()
  const [monthGridResult, annualResult] = await Promise.allSettled([
    fetchOfficialText(MONTH_GRID_CALENDAR_URL, calendarOptions),
    fetchOfficialText(RELEASE_CALENDAR_URL, calendarOptions),
  ])
  let monthGrid = null
  let annual = null
  let monthGridError = monthGridResult.status === 'rejected' ? monthGridResult.reason : null
  let annualError = annualResult.status === 'rejected' ? annualResult.reason : null
  if (monthGridResult.status === 'fulfilled') {
    try { monthGrid = parseMonthGridCalendar(monthGridResult.value.text, fetchedAt, monthGridResult.value.final_url) } catch (error) { monthGridError = error }
  }
  if (annualResult.status === 'fulfilled') {
    try { annual = parseReleaseCalendarHtml(annualResult.value.text, fetchedAt, annualResult.value.final_url) } catch (error) { annualError = error }
  }
  if (monthGrid && annual) {
    return {
      ...mergeReleaseCalendars(monthGrid, annual),
      source_responses: [monthGridResult.value.response, annualResult.value.response],
    }
  }
  throw new Error(`官方双源发布日程无法同时核验：月度日历=${String(monthGridError)}；年度日程=${String(annualError)}`)
}

function buildDiscoveryObservation({ slot, attempt, startedAt, completedAt, timingStatus, result, calendar, pointer }) {
  if (!slot || !parseSlotId(slot.slot_id)) throw new Error('观察报告缺少有效时段')
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error('观察报告尝试次数无效')
  if (!['on_time', 'late'].includes(timingStatus)) throw new Error('观察报告时序状态无效')
  if (!result || !['waiting', 'current', 'update_available', 'anomaly'].includes(result.status)) throw new Error('观察报告结果无效')
  const calendarSha256 = sha256(canonicalCalendarText(calendar))
  const idempotencyKey = result.status === 'update_available'
    ? buildReleaseIdempotencyKey(result.expected_stat_month, result.latest_official_url)
    : null
  const stable = {
    slot_id: slot.slot_id,
    attempt,
    status: result.status,
    dataset_as_of: result.dataset_as_of,
    expected_stat_month: result.expected_stat_month,
    latest_official_month: result.latest_official_month,
    latest_official_url: result.latest_official_url,
    release_window: result.release_window,
    official_list_checked: result.official_list_checked,
    official_release_detected: result.official_release_detected,
    calendar_sha256: calendarSha256,
    pointer_sha256: pointer.pointer_sha256,
    idempotency_key: idempotencyKey,
  }
  const observationId = sha256(JSON.stringify(stable))
  const observation = {
    format: 'housing-data-discovery-observation-v1',
    observation_id: observationId,
    slot_id: slot.slot_id,
    task: slot.kind,
    planned_at: slot.planned_at,
    actual_started_at: new Date(startedAt).toISOString(),
    completed_at: new Date(completedAt).toISOString(),
    timing_status: timingStatus,
    status: result.status,
    result,
    pointer: {
      dataset_as_of: pointer.dataset_as_of,
      dataset_version: pointer.dataset_version ?? null,
      pointer_sha256: pointer.pointer_sha256,
    },
    calendar: {
      year: calendar.year,
      source_urls: calendar.source_urls ?? [calendar.source_url],
      raw_content_sha256: calendar.raw_content_sha256,
      calendar_sha256: calendarSha256,
      source_responses: calendar.source_responses ?? [],
    },
    discovery_responses: result.discovery_responses ?? [],
    idempotency_key: idempotencyKey,
    handoff_identity: idempotencyKey ? `housing-data-discovery-v1:${idempotencyKey}` : null,
  }
  return { ...observation, payload_sha256: sha256(JSON.stringify(observation)) }
}

module.exports = {
  MINUTE_MS,
  DAY_MS,
  OFFICIAL_HOST,
  OFFICIAL_LIST_URL,
  MONTH_GRID_CALENDAR_URL,
  RELEASE_CALENDAR_URL,
  DISCOVERY_MINUTES,
  DISCOVERY_OBSERVATION_ROOT,
  DEFAULT_CLOUD_STORAGE_ROOT,
  MAX_FETCH_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  sha256,
  isStatMonth,
  nextStatMonth,
  scheduleKindAt,
  isExpectedScheduleSlot,
  buildSlotId,
  parseSlotId,
  observationObjectKey,
  observationFileId,
  latestScheduledSlot,
  previousScheduledSlot,
  slotsForControllerTick,
  slotPolicy,
  discoverySlotsForBeijingDate,
  scheduledSlotsForBeijingDate,
  beijingDateText,
  dueSlotsForController,
  extractStatMonth,
  isOfficialReleaseUrl,
  canonicalCalendarText,
  buildReleaseIdempotencyKey,
  evaluateReleaseSchedule,
  waitingResult,
  evaluateLatestCheck,
  parseReleaseCalendarHtml,
  parseMonthGridCalendar,
  mergeReleaseCalendars,
  fetchOfficialText,
  discoverOfficialPages,
  fetchReleaseCalendar,
  buildDiscoveryObservation,
}
