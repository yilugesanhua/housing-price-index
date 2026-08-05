const dataRuntime = require('../../utils/data-runtime.js')
const dataConfig = require('../../config/data.js')
let snapshot = dataRuntime.getSnapshot()
const versionConfig = require('../../config/version.js')
const locationConfig = require('../../config/location.js')
const { resolveCityId } = require('../../utils/location.js')

const LABELS = {
  metric: { mom: '环比', yoy: '同比' },
  property: { new: '新房', resale: '二手房' },
  size: { all: '全部面积', le90: '90㎡及以下', '90_144': '90–144㎡', gt144: '144㎡以上' },
  range: { 36: '近3年', 60: '近5年', 120: '近10年', 180: '近15年' },
}
const OPTIONS = {
  metric: [{ value: 'mom', label: '环比' }, { value: 'yoy', label: '同比' }],
  property: [{ value: 'new', label: '新房' }, { value: 'resale', label: '二手房' }],
  size: [{ value: 'all', label: '全部面积' }, { value: 'le90', label: '90㎡及以下' }, { value: '90_144', label: '90–144㎡' }, { value: 'gt144', label: '144㎡以上' }],
  range: [{ value: 36, label: '近3年' }, { value: 60, label: '近5年' }, { value: 120, label: '近10年' }, { value: 180, label: '近15年' }],
}
let LOCATION_CITY_IDS = [...snapshot.cityIds].sort((left, right) => left.localeCompare(right, 'en'))
const SERIES_COLORS = ['#176c79', '#2f6fbb', '#9b5b2f']
const MOBILE_STANDARD_CHART_PADDING = [28, 24, 42, 48]
const MOBILE_BREADTH_CHART_PADDING = [28, 12, 34, 32]
const DESKTOP_STANDARD_CHART_PADDING = [28, 48, 60, 48]
const DESKTOP_BREADTH_CHART_PADDING = [28, 32, 46, 32]
const STORAGE_KEY = 'housing-view-state-v1'
const LOCATION_CACHE_KEY = 'housing-location-cache-v1'
const FOCUS_SOURCE_KEY = 'housing-focus-source-v1'
const DEFAULT_STATE = {
  metric: 'mom',
  propertyType: 'new',
  sizeBand: 'all',
  range: 60,
  focusCity: 'beijing',
  cities: ['beijing'],
}

function hasUsableSnapshot(value = snapshot) {
  return value?.dataStatus !== 'unavailable'
    && Array.isArray(value?.months)
    && value.months.length > 0
    && Array.isArray(value?.cityIds)
    && value.cityIds.length > 0
    && Boolean(value?.cityMap?.[DEFAULT_STATE.focusCity])
}

function makeUnavailableView() {
  return {
    state: { ...DEFAULT_STATE, cities: [...DEFAULT_STATE.cities] },
    propertyLabel: LABELS.property[DEFAULT_STATE.propertyType],
    metricLabel: LABELS.metric[DEFAULT_STATE.metric],
    sizeLabel: LABELS.size[DEFAULT_STATE.sizeBand],
    rangeLabel: LABELS.range[DEFAULT_STATE.range],
    propertyIndex: 0,
    metricIndex: 0,
    sizeIndex: 0,
    rangeIndex: 1,
    focusCityIndex: -1,
    focusCityName: '',
    focusTone: 'flat',
    focusMovement: '',
    focusMagnitude: '—',
    focusRank: '—',
    rankedCount: 0,
    featuredCards: [],
    counts: { up: 0, flat: 0, down: 0, missing: 0 },
    selectedCities: [],
    cityOptions: [],
    market: {
      total: 0,
      upWidth: '0%',
      flatWidth: '0%',
      downWidth: '0%',
      nationalCount: 0,
      nationalRank: '—',
      nationalRows: [],
      tierLabel: '',
      tierCount: 0,
      tierRank: '—',
      tierRows: [],
      province: '',
      provinceCount: 0,
      provinceRank: '—',
      provinceRows: [],
    },
    breadthHistory: [],
    breadthChartData: [],
    cumulativeData: [],
    cumulativeLatest: [],
    cumulativeStartMonth: '',
    exactMonths: [],
    exactMonthLabels: [],
    exactMonthIndex: -1,
    exactMonth: '',
    exactData: [],
  }
}

function removeLocationCache() {
  try { wx.removeStorageSync(LOCATION_CACHE_KEY) } catch (_) {}
}

function readValidLocationCache() {
  let cached = null
  try { cached = wx.getStorageSync(LOCATION_CACHE_KEY) } catch (_) { return null }
  if (!cached) return null
  const locatedAt = Number(cached.locatedAt)
  const age = Date.now() - locatedAt
  const knownCity = hasUsableSnapshot() && Boolean(snapshot.cityMap[cached.cityId])
  const valid = typeof cached.cityId === 'string'
    && /^[a-z]+$/.test(cached.cityId)
    && Number.isFinite(locatedAt)
    && locatedAt > 0
    && age >= 0
    && age < locationConfig.cacheDurationMs
    && knownCity
  if (!valid) {
    removeLocationCache()
    return null
  }
  return { cityId: cached.cityId, locatedAt }
}

function formatChange(value) {
  if (value === null || value === undefined) return '—'
  return `${value > 0 ? '+' : ''}${Number(value).toFixed(1)}%`
}

function formatIndex(value) {
  if (value === null || value === undefined) return '—'
  return Number(value).toFixed(1).replace(/\.0$/, '')
}

function formatReleaseDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : value
}

function formatChartMonth(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value
}

function toChartDate(month) {
  return `${month}-01`
}

function isDesktopChartEnvironment() {
  if (typeof wx !== 'object' || typeof wx.getSystemInfoSync !== 'function') return false
  try {
    const platform = wx.getSystemInfoSync().platform
    return platform === 'windows' || platform === 'devtools'
  } catch (_) {
    return false
  }
}

function chartConfig(config, mobilePadding, desktopPadding) {
  return { ...config, padding: isDesktopChartEnvironment() ? desktopPadding : mobilePadding }
}

function chartTooltip(chart, options) {
  chart.tooltip(isDesktopChartEnvironment() ? { ...options, fixed: true } : options)
}

function chartMonthAxis() {
  return {
    // wx-f2 clips canvas-drawn date labels in the Windows simulator. The page
    // supplies equivalent labels there; phones retain the original F2 labels.
    label: isDesktopChartEnvironment() ? false : (text) => ({ fill: '#5f6368', fontSize: 9, text }),
    line: { stroke: '#d8d8de' },
  }
}

function chartAxisLabels(months, count = 5) {
  if (!months.length) return []
  const labelCount = Math.min(count, months.length)
  if (labelCount === 1) return [String(months[0]).slice(2)]
  return Array.from({ length: labelCount }, (_, index) => {
    const monthIndex = Math.round(index * (months.length - 1) / (labelCount - 1))
    return String(months[monthIndex]).slice(2)
  })
}

function seriesCode(state) {
  return `${state.propertyType === 'new' ? 'n' : 'r'}_${{ all: 'a', le90: 's', '90_144': 'm', gt144: 'l' }[state.sizeBand]}`
}

function readSeries(cityId, state) {
  return snapshot.series[cityId]?.[seriesCode(state)] || []
}

function valueAt(cityId, state, index) {
  const offset = state.metric === 'mom' ? 2 : 3
  const values = readSeries(cityId, state)
  if (values.length) return values[index * 4 + offset]
  if (index === snapshot.months.length - 1) return snapshot.latestSeries?.[cityId]?.[seriesCode(state)]?.[offset]
  return null
}

function indexAt(cityId, state, index) {
  const offset = state.metric === 'mom' ? 0 : 1
  const values = readSeries(cityId, state)
  if (values.length) return values[index * 4 + offset]
  if (index === snapshot.months.length - 1) return snapshot.latestSeries?.[cityId]?.[seriesCode(state)]?.[offset]
  return null
}

function tone(value) {
  return value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
}

function normalizeState(candidate) {
  const state = { ...DEFAULT_STATE }
  if (candidate && ['mom', 'yoy'].includes(candidate.metric)) state.metric = candidate.metric
  if (candidate && ['new', 'resale'].includes(candidate.propertyType)) state.propertyType = candidate.propertyType
  if (candidate && ['all', 'le90', '90_144', 'gt144'].includes(candidate.sizeBand)) state.sizeBand = candidate.sizeBand
  if (candidate && availableRangeOptions().some((item) => item.value === Number(candidate.range))) state.range = Number(candidate.range)
  if (candidate && snapshot.cityMap[candidate.focusCity]) state.focusCity = candidate.focusCity
  if (candidate && Array.isArray(candidate.cities)) state.cities = [...new Set(candidate.cities.filter((id) => snapshot.cityMap[id]))].slice(0, 3)
  return state
}

function availableRangeOptions() {
  return snapshot.months.length >= 180 ? OPTIONS.range : OPTIONS.range.filter((item) => item.value < 180)
}

function parseQuery(query) {
  if (!query || query.v !== '1') return null
  return {
    metric: query.metric,
    propertyType: query.type,
    sizeBand: query.size,
    range: Number(query.range),
    focusCity: query.focus,
    cities: typeof query.cities === 'string' ? query.cities.split(',') : undefined,
  }
}

function rankValues(items) {
  const sorted = [...items].sort((left, right) => {
    if (left.value === null) return 1
    if (right.value === null) return -1
    return right.value - left.value || left.cityId.localeCompare(right.cityId)
  })
  const frequency = items.reduce((map, item) => {
    if (item.value !== null && item.value !== undefined) map.set(item.value, (map.get(item.value) || 0) + 1)
    return map
  }, new Map())
  let lastValue = null
  let lastRank = 0
  return sorted.map((item, index) => {
    const rank = item.value === lastValue ? lastRank : index + 1
    lastValue = item.value
    lastRank = rank
    return { ...item, rank, tied: (frequency.get(item.value) || 0) > 1 }
  })
}

function countDirections(values) {
  return values.reduce((result, value) => {
    if (value === null || value === undefined) result.missing += 1
    else if (value > 0) result.up += 1
    else if (value < 0) result.down += 1
    else result.flat += 1
    return result
  }, { up: 0, flat: 0, down: 0, missing: 0 })
}

function buildCityOptions(state, searchText) {
  const query = searchText.trim().toLowerCase().replace(/\s+/g, '')
  const featured = new Set(snapshot.featuredCityIds)
  const ids = [...snapshot.featuredCityIds, ...snapshot.cityIds.filter((id) => !featured.has(id)).sort((left, right) => left.localeCompare(right, 'en'))]
  let previousGroup = ''
  return ids
    .filter((id) => !query || snapshot.cityMap[id].search.replace(/\s+/g, '').includes(query))
    .map((id) => {
      const group = featured.has(id) ? '常用城市' : id[0].toUpperCase()
      const item = {
        id,
        name: snapshot.cityMap[id].name,
        group,
        showGroup: group !== previousGroup,
        selected: state.cities.includes(id),
        disabled: state.cities.length >= 3 && !state.cities.includes(id),
      }
      previousGroup = group
      return item
    })
}

function reportChartError(type, error) {
  const pages = getCurrentPages()
  const page = pages[pages.length - 1]
  if (page) page.setData({ [`${type}ChartError`]: true })
  console.error(`${type} chart failed`, error)
  return null
}

function buildCumulative(state) {
  const start = Math.max(0, snapshot.months.length - state.range)
  const data = []
  const latest = []
  for (const cityId of state.cities) {
    const values = readSeries(cityId, state)
    let value = 100
    let broken = false
    snapshot.months.slice(start).forEach((month, offset) => {
      const momIndex = values[(start + offset) * 4]
      if (offset > 0) {
        if (broken || momIndex === null || momIndex === undefined) broken = true
        else value = value * momIndex / 100
      }
      data.push({ month, city: snapshot.cityMap[cityId].name, cityId, value: broken ? null : Number(value.toFixed(4)) })
    })
    const last = data.filter((item) => item.cityId === cityId).at(-1)
    latest.push({ id: cityId, name: snapshot.cityMap[cityId].name, value: last ? last.value : null, display: last && last.value !== null ? formatIndex(last.value) : '—', change: last && last.value !== null ? formatChange(last.value - 100) : '无法计算' })
  }
  return { data, latest, startMonth: snapshot.months[start] }
}

function buildExactData(state, month, cumulativeData) {
  const monthIndex = snapshot.months.indexOf(month)
  return state.cities.map((cityId) => {
    const values = readSeries(cityId, state)
    const offset = monthIndex * 4
    const cumulative = cumulativeData.find((item) => item.cityId === cityId && item.month === month)
    return {
      id: cityId,
      name: snapshot.cityMap[cityId].name,
      index: formatIndex(values[offset + (state.metric === 'mom' ? 0 : 1)]),
      change: formatChange(values[offset + (state.metric === 'mom' ? 2 : 3)]),
      cumulative: cumulative && cumulative.value !== null ? formatIndex(cumulative.value) : '—',
      releaseDate: formatReleaseDate(snapshot.releaseDates[monthIndex]),
    }
  })
}

function makeView(state, searchText = '', hiddenCityIds = []) {
  const latestIndex = snapshot.months.length - 1
  const latestValues = snapshot.cityIds.map((cityId) => ({ cityId, value: valueAt(cityId, state, latestIndex) }))
  const ranked = rankValues(latestValues.filter((item) => item.value !== null && item.value !== undefined))
  const focus = ranked.find((item) => item.cityId === state.focusCity)
  const counts = countDirections(latestValues.map((item) => item.value))
  const featuredCards = rankValues(snapshot.featuredCityIds.map((cityId) => ({ cityId, value: valueAt(cityId, state, latestIndex) })))
    .map((item) => {
      const values = snapshot.months.slice(-12).map((_, offset) => valueAt(item.cityId, state, snapshot.months.length - 12 + offset))
      return {
        id: item.cityId,
        name: snapshot.cityMap[item.cityId].name,
        rank: item.rank,
        value: formatChange(item.value),
        index: formatIndex(indexAt(item.cityId, state, latestIndex)),
        tone: tone(item.value),
        movement: item.value > 0 ? '上涨' : item.value < 0 ? '下跌' : '持平',
        sparkValues: values,
      }
    })
  const cityOptions = buildCityOptions(state, searchText)
  const focusValue = focus ? focus.value : null
  const profile = snapshot.cityMap[state.focusCity]
  const tierRanked = rankValues(latestValues.filter((item) => snapshot.cityMap[item.cityId].tier === profile.tier && item.value !== null && item.value !== undefined))
  const provinceRanked = rankValues(latestValues.filter((item) => snapshot.cityMap[item.cityId].province === profile.province && item.value !== null && item.value !== undefined))
  const tierFocus = tierRanked.find((item) => item.cityId === state.focusCity)
  const provinceFocus = provinceRanked.find((item) => item.cityId === state.focusCity)
  const marketRow = (item) => ({ id: item.cityId, rank: item.rank, name: snapshot.cityMap[item.cityId].name, value: formatChange(item.value), tone: tone(item.value), current: item.cityId === state.focusCity })
  const start = Math.max(0, snapshot.months.length - state.range)
  const compactBreadth = snapshot.breadthSeries?.[`${seriesCode(state)}_${state.metric}`]
  const breadthHistory = snapshot.months.slice(start).map((month, offset) => {
    const index = start + offset
    if (compactBreadth) {
      const values = compactBreadth.slice(index * 4, index * 4 + 4)
      return { month, up: values[0], flat: values[1], down: values[2], missing: values[3] }
    }
    return { month, ...countDirections(snapshot.cityIds.map((cityId) => valueAt(cityId, state, index))) }
  })
  const breadthChartData = breadthHistory.flatMap((item) => [
    { month: toChartDate(item.month), direction: '上涨', count: item.up },
    { month: toChartDate(item.month), direction: '持平', count: item.flat },
    { month: toChartDate(item.month), direction: '下跌', count: item.down },
  ])
  const cumulative = buildCumulative(state)
  const exactMonths = snapshot.months.slice(start)
  const exactMonth = exactMonths[exactMonths.length - 1]
  return {
    state,
    propertyLabel: LABELS.property[state.propertyType],
    metricLabel: LABELS.metric[state.metric],
    sizeLabel: LABELS.size[state.sizeBand],
    rangeLabel: LABELS.range[state.range],
    propertyIndex: OPTIONS.property.findIndex((item) => item.value === state.propertyType),
    metricIndex: OPTIONS.metric.findIndex((item) => item.value === state.metric),
    sizeIndex: OPTIONS.size.findIndex((item) => item.value === state.sizeBand),
    rangeOptions: availableRangeOptions().map((item) => item.label),
    rangeIndex: availableRangeOptions().findIndex((item) => item.value === state.range),
    focusCityIndex: LOCATION_CITY_IDS.indexOf(state.focusCity),
    focusCityName: snapshot.cityMap[state.focusCity].name,
    focusTone: tone(focusValue),
    focusMovement: focusValue > 0 ? '上涨' : focusValue < 0 ? '下降' : '持平',
    focusMagnitude: focusValue === null ? '—' : `${Math.abs(focusValue).toFixed(1)}%`,
    focusRank: focus ? focus.rank : '—',
    rankedCount: ranked.length,
    featuredCards,
    counts,
    selectedCities: state.cities.map((id, index) => ({ id, name: snapshot.cityMap[id].name, color: SERIES_COLORS[index], seriesIndex: index, hidden: hiddenCityIds.includes(id) })),
    cityOptions,
    market: {
      total: counts.up + counts.flat + counts.down,
      upWidth: `${counts.up / Math.max(1, counts.up + counts.flat + counts.down) * 100}%`,
      flatWidth: `${counts.flat / Math.max(1, counts.up + counts.flat + counts.down) * 100}%`,
      downWidth: `${counts.down / Math.max(1, counts.up + counts.flat + counts.down) * 100}%`,
      nationalCount: ranked.length,
      nationalRank: focus ? focus.rank : '—',
      nationalRows: ranked.map(marketRow),
      tierLabel: profile.tierLabel,
      tierCount: tierRanked.length,
      tierRank: tierFocus ? tierFocus.rank : '—',
      tierRows: tierRanked.map(marketRow),
      province: profile.province,
      provinceCount: provinceRanked.length,
      provinceRank: provinceFocus ? provinceFocus.rank : '—',
      provinceRows: provinceRanked.map(marketRow),
    },
    breadthHistory,
    breadthChartData,
    breadthChartAxisLabels: chartAxisLabels(breadthHistory.map((item) => item.month)),
    trendChartAxisLabels: chartAxisLabels(exactMonths),
    cumulativeChartAxisLabels: chartAxisLabels(exactMonths),
    cumulativeData: cumulative.data,
    cumulativeLatest: cumulative.latest.map((item, index) => ({ ...item, color: SERIES_COLORS[index], seriesIndex: index, hidden: hiddenCityIds.includes(item.id) })),
    cumulativeStartMonth: cumulative.startMonth,
    exactMonths,
    exactMonthLabels: exactMonths.map((month) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`),
    exactMonthIndex: exactMonths.length - 1,
    exactMonth,
    exactData: buildExactData(state, exactMonth, cumulative.data),
  }
}

Page({
  data: {
    datasetAsOf: snapshot.datasetAsOf,
    appVersion: versionConfig.version,
    releaseDate: formatReleaseDate(snapshot.releaseDate),
    coverageStart: snapshot.coverageStart,
    latestOfficialUrl: snapshot.latestOfficialUrl,
    dataSourceLabel: dataRuntime.getSource() === 'remote' ? '云端数据已更新' : '内置数据',
    focusCityNames: LOCATION_CITY_IDS.map((id) => snapshot.cityMap[id].name),
    propertyOptions: OPTIONS.property.map((item) => item.label),
    metricOptions: OPTIONS.metric.map((item) => item.label),
    sizeOptions: OPTIONS.size.map((item) => item.label),
    rangeOptions: availableRangeOptions().map((item) => item.label),
    dataNotice: '',
    dataUnavailable: !hasUsableSnapshot(),
    dataRetrying: false,
    dataUnavailableMessage: '当前没有可验证的住宅价格数据。请联网重试；在撤销状态和完整数据包验证通过前，不展示排名、趋势或市场结论。',
    pickerOpen: false,
    exactOpen: false,
    showExactData: false,
    hiddenCityIds: [],
    searchText: '',
    scrollIntoView: '',
    rankingScrollCity: hasUsableSnapshot() ? DEFAULT_STATE.focusCity : '',
    activeSection: 'overview',
    analysisNavFixed: false,
    desktopChartMode: isDesktopChartEnvironment(),
    trendChartError: false,
    cumulativeChartError: false,
    breadthChartError: false,
    locationStatus: 'idle',
    locatedCityId: '',
    ...(hasUsableSnapshot() ? makeView(DEFAULT_STATE) : makeUnavailableView()),
    onInitChart(F2, config) {
      try {
      console.info('[chart:init] trend', { width: config.width, height: config.height })
      const chart = new F2.Chart(chartConfig(config, MOBILE_STANDARD_CHART_PADDING, DESKTOP_STANDARD_CHART_PADDING))
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      chart.source(page.getTrendData(), {
        month: { type: 'timeCat', mask: 'YY-MM', tickCount: 5, range: [0, 1] },
        change: { tickCount: 5 },
      })
      chartTooltip(chart, {
        showTitle: false,
        showCrosshairs: true,
        showItemMarker: false,
        onChange({ items }) {
          const month = items && items[0] && items[0].origin && items[0].origin.month
          if (!month || !items) return
          items.forEach((item, index) => {
            item.value = formatChange(item.origin && item.origin.change)
            if (index === 0) item.name = `${formatChartMonth(month)}涨跌幅 ${item.name}`
          })
        },
      })
      chart.legend(false)
      chart.axis('month', chartMonthAxis())
      chart.axis('change', { label: (text) => ({ fill: '#5f6368', fontSize: 9, text: `${text}%` }), grid: { stroke: '#e6e6eb', lineWidth: 1 } })
      chart.guide().line({ start: ['min', 0], end: ['max', 0], style: { stroke: '#8e8e93', lineDash: [4, 4], lineWidth: 1 } })
      chart.line().position('month*change').color('city', (city) => {
        const index = page.data.state.cities.findIndex((id) => snapshot.cityMap[id].name === city)
        return SERIES_COLORS[Math.max(0, index)]
      }).shape('city', (city) => {
        const index = page.data.state.cities.findIndex((id) => snapshot.cityMap[id].name === city)
        return index > 0 ? 'dash' : 'line'
      }).size(2)
      chart.animate(false)
      chart.render()
      page.chart = chart
      return chart
      } catch (error) {
        return reportChartError('trend', error)
      }
    },
    onInitCumulativeChart(F2, config) {
      try {
      console.info('[chart:init] cumulative', { width: config.width, height: config.height })
      const chart = new F2.Chart(chartConfig(config, MOBILE_STANDARD_CHART_PADDING, DESKTOP_STANDARD_CHART_PADDING))
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      chart.source(page.getCumulativeData(), {
        month: { type: 'timeCat', mask: 'YY-MM', tickCount: 5, range: [0, 1] },
        value: { tickCount: 5, formatter: formatIndex },
      })
      chartTooltip(chart, {
        showTitle: false,
        showCrosshairs: true,
        showItemMarker: false,
        onChange({ items }) {
          const month = items && items[0] && items[0].origin && items[0].origin.month
          if (month) items[0].name = `${formatChartMonth(month)} ${items[0].name}`
        },
      })
      chart.legend(false)
      chart.axis('month', chartMonthAxis())
      chart.axis('value', { label: (text) => ({ fill: '#5f6368', fontSize: 9, text }), grid: { stroke: '#e6e6eb', lineWidth: 1 } })
      chart.guide().line({ start: ['min', 100], end: ['max', 100], style: { stroke: '#8e8e93', lineDash: [4, 4], lineWidth: 1 } })
      chart.line().position('month*value').color('city', (city) => {
        const index = page.data.state.cities.findIndex((id) => snapshot.cityMap[id].name === city)
        return SERIES_COLORS[Math.max(0, index)]
      }).shape('city', (city) => {
        const index = page.data.state.cities.findIndex((id) => snapshot.cityMap[id].name === city)
        return index > 0 ? 'dash' : 'line'
      }).size(2)
      chart.animate(false)
      chart.render()
      page.cumulativeChart = chart
      return chart
      } catch (error) {
        return reportChartError('cumulative', error)
      }
    },
    onInitBreadthChart(F2, config) {
      try {
      console.info('[chart:init] breadth', { width: config.width, height: config.height })
      const chart = new F2.Chart(chartConfig(config, MOBILE_BREADTH_CHART_PADDING, DESKTOP_BREADTH_CHART_PADDING))
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      chart.source(page.data.breadthChartData, {
        month: { type: 'timeCat', mask: 'YY-MM', tickCount: 5, range: [0, 1] },
        count: { min: 0, max: 70, ticks: [0, 20, 40, 60, 70], nice: false },
      })
      chartTooltip(chart, {
        showTitle: false,
        showCrosshairs: false,
        showItemMarker: true,
        onChange({ items }) {
          const month = items && items[0] && items[0].origin && items[0].origin.month
          if (!month) return
          items[0].name = `${formatChartMonth(month)} ${items[0].name}`
        },
      })
      chart.legend(false)
      chart.axis('month', chartMonthAxis())
      chart.axis('count', { label: (text) => ({ fill: '#5f6368', fontSize: 9, text }), grid: { stroke: '#e6e6eb', lineWidth: 1 } })
      chart.interval().position('month*count').color('direction', ['#c94f45', '#8e8e93', '#167d67']).adjust('stack')
      chart.animate(false)
      chart.render()
      page.breadthChart = chart
      return chart
      } catch (error) {
        return reportChartError('breadth', error)
      }
    },
  },

  onLoad(query) {
    if (isDesktopChartEnvironment() && !this.data.desktopChartMode) this.setData({ desktopChartMode: true })
    const routeState = parseQuery(query)
    let stored = null
    let focusSource = ''
    try { stored = wx.getStorageSync(STORAGE_KEY) } catch (_) {}
    try { focusSource = wx.getStorageSync(FOCUS_SOURCE_KEY) } catch (_) {}
    const cachedLocation = readValidLocationCache()
    this._pendingStateCandidate = routeState || stored || DEFAULT_STATE
    this._hasRouteState = Boolean(routeState)
    this._focusSource = focusSource
    if (cachedLocation) this.setData({ locatedCityId: cachedLocation.cityId })
    if (!hasUsableSnapshot()) return
    this.applyState(normalizeState(this._pendingStateCandidate), false)
    this._pendingStateCandidate = null
    this.maybeAutoLocate()
    const overdue = snapshot.nextCheckDueAt && Date.now() > new Date(snapshot.nextCheckDueAt).getTime()
    if (snapshot.dataStatus !== 'current' || overdue) this.setData({ dataNotice: `当前数据可能未及时更新，请以国家统计局最新发布为准。数据截至 ${snapshot.datasetAsOf}。` })
  },

  onShow() {
    void this.refreshRemoteData()
  },

  refreshRemoteData(options = {}) {
    if (this._refreshPromise) return this._refreshPromise
    this._refreshPromise = this.performRemoteRefresh(options)
      .catch((error) => {
        console.error('[data:update] page refresh failed', error)
        snapshot = dataRuntime.getSnapshot()
        if (!hasUsableSnapshot()) this.enterUnavailableState()
        return { updated: false, source: dataRuntime.getSource(), reason: 'page-refresh-failed', error }
      })
      .finally(() => { this._refreshPromise = null })
    return this._refreshPromise
  },

  async performRemoteRefresh({ force = false } = {}) {
    const requiredCityIds = [...new Set([...(this.data.state?.cities || []), this.data.state?.focusCity].filter(Boolean))]
    // The isolated development preview must retry immediately after a repaired cloud package.
    const result = await dataRuntime.refresh({ requiredCityIds, force: force || dataConfig.previewMode })
    snapshot = dataRuntime.getSnapshot()
    if (!hasUsableSnapshot()) {
      this.enterUnavailableState()
      return result
    }
    if (!result.updated && !this.data.dataUnavailable) return result
    await dataRuntime.ensureCities([...(this.data.state?.cities || []), this.data.state?.focusCity].filter(Boolean))
    snapshot = dataRuntime.getSnapshot()
    LOCATION_CITY_IDS = [...snapshot.cityIds].sort((left, right) => left.localeCompare(right, 'en'))
    const overdue = snapshot.nextCheckDueAt && Date.now() > new Date(snapshot.nextCheckDueAt).getTime()
    this.setData({
      datasetAsOf: snapshot.datasetAsOf,
      releaseDate: formatReleaseDate(snapshot.releaseDate),
      coverageStart: snapshot.coverageStart,
      latestOfficialUrl: snapshot.latestOfficialUrl,
      focusCityNames: LOCATION_CITY_IDS.map((id) => snapshot.cityMap[id].name),
      dataSourceLabel: dataRuntime.getSource() === 'remote' ? (snapshot.months.length >= 180 ? '云端近15年数据已就绪' : '云端数据已更新') : '内置数据',
      dataNotice: snapshot.dataStatus !== 'current' || overdue ? `当前数据可能未及时更新，请以国家统计局最新发布为准。数据截至 ${snapshot.datasetAsOf}。` : '',
      dataUnavailable: false,
      dataUnavailableMessage: '',
    })
    this.applyState(normalizeState(this._pendingStateCandidate || this.data.state), false)
    this._pendingStateCandidate = null
    this.maybeAutoLocate()
    return result
  },

  enterUnavailableState() {
    if (!this.data.dataUnavailable) this._pendingStateCandidate = this.data.state
    ;[this.chart, this.cumulativeChart, this.breadthChart].forEach((chart) => {
      if (chart && typeof chart.destroy === 'function') chart.destroy()
    })
    this.chart = null
    this.cumulativeChart = null
    this.breadthChart = null
    this.setData({
      ...makeUnavailableView(),
      datasetAsOf: snapshot.datasetAsOf,
      releaseDate: formatReleaseDate(snapshot.releaseDate),
      latestOfficialUrl: snapshot.latestOfficialUrl,
      focusCityNames: [],
      pickerOpen: false,
      analysisNavFixed: false,
      dataNotice: '',
      dataUnavailable: true,
      dataUnavailableMessage: '当前没有可验证的住宅价格数据。请联网重试；在撤销状态和完整数据包验证通过前，不展示排名、趋势或市场结论。',
      dataSourceLabel: '数据暂不可用',
    })
  },

  async retryData() {
    if (this.data.dataRetrying) return
    this.setData({ dataRetrying: true, dataUnavailableMessage: '正在重新取得并校验完整数据，请稍候。' })
    try {
      await this.refreshRemoteData({ force: true })
      if (this.data.dataUnavailable) this.setData({ dataUnavailableMessage: '仍未取得通过校验的数据。请检查网络后重试，或查看数据来源与审计说明。' })
    } finally {
      this.setData({ dataRetrying: false })
    }
  },

  maybeAutoLocate() {
    if (this._autoLocationAttempted || this._hasRouteState || this._focusSource === 'manual') return
    if (!locationConfig.autoLocate || !locationConfig.cloudEnvId || !hasUsableSnapshot()) return
    this._autoLocationAttempted = true
    this.locateCurrentCity({ useCache: true })
  },

  onReady() {
    if (this.data.dataUnavailable) return
    this.drawSparklines()
    wx.createSelectorQuery().select('.analysis-nav').boundingClientRect((rect) => {
      if (rect) this._analysisNavTop = rect.top
    }).exec()
  },

  onShareAppMessage() {
    const state = this.data.state
    const path = `/pages/index/index?v=1&metric=${state.metric}&type=${state.propertyType}&range=${state.range}&cities=${state.cities.join(',')}&focus=${state.focusCity}&size=${state.sizeBand}`
    return { title: this.data.dataUnavailable ? '住房小二 · 数据暂不可用' : `住房小二 · 数据截至${snapshot.datasetAsOf}`, path }
  },

  getTrendData() {
    const state = this.data.state
    const start = Math.max(0, snapshot.months.length - state.range)
    return state.cities.filter((cityId) => !this.data.hiddenCityIds.includes(cityId)).flatMap((cityId) => snapshot.months.slice(start).map((month, offset) => ({
      month: toChartDate(month),
      city: snapshot.cityMap[cityId].name,
      change: valueAt(cityId, state, start + offset),
    })))
  },

  getCumulativeData() {
    const start = Math.max(0, snapshot.months.length - this.data.state.range)
    const visibleMonths = new Set(snapshot.months.slice(start))
    return this.data.cumulativeData
      .filter((item) => visibleMonths.has(item.month) && !this.data.hiddenCityIds.includes(item.cityId) && item.value !== null)
      .map((item) => ({ ...item, month: toChartDate(item.month) }))
  },

  drawSparklines() {
    if (this.data.dataUnavailable) return
    const width = 66
    const height = 24
    this.data.featuredCards.forEach((card) => {
      const values = card.sparkValues.filter((value) => value !== null && value !== undefined)
      if (values.length < 2) return
      const min = Math.min(...values, 0)
      const max = Math.max(...values, 0)
      const spread = Math.max(max - min, 0.2)
      const ctx = wx.createCanvasContext(`spark-${card.id}`, this)
      ctx.setStrokeStyle('#176c79')
      ctx.setLineWidth(1.5)
      ctx.beginPath()
      let started = false
      card.sparkValues.forEach((value, index) => {
        if (value === null || value === undefined) { started = false; return }
        const x = index / Math.max(card.sparkValues.length - 1, 1) * width
        const y = height - 2 - (value - min) / spread * (height - 4)
        if (!started) { ctx.moveTo(x, y); started = true }
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
      ctx.draw()
    })
  },

  applyState(state, persist = true) {
    const hiddenCityIds = (this.data.hiddenCityIds || []).filter((id) => state.cities.includes(id))
    this.setData({ ...makeView(state, this.data.searchText || '', hiddenCityIds), hiddenCityIds, rankingScrollCity: '' }, () => {
      this.setData({ rankingScrollCity: state.focusCity }, () => {
        this.drawSparklines()
        if (this.chart) this.chart.changeData(this.getTrendData())
        if (this.cumulativeChart) this.cumulativeChart.changeData(this.getCumulativeData())
        if (this.breadthChart) this.breadthChart.changeData(this.data.breadthChartData)
      })
    })
    if (persist) {
      try { wx.setStorageSync(STORAGE_KEY, state) } catch (_) {}
    }
  },

  onFocusCityChange(event) {
    this._locationGeneration = (this._locationGeneration || 0) + 1
    if (this.data.locationStatus === 'locating') this.setData({ locationStatus: 'idle' })
    const focusCity = LOCATION_CITY_IDS[Number(event.detail.value)]
    this.selectFocusCity(focusCity, 'manual')
  },
  selectFocusCity(focusCity, source, locationGeneration) {
    if (!snapshot.cityMap[focusCity]) return Promise.resolve(false)
    if (source === 'location' && locationGeneration !== undefined && locationGeneration !== this._locationGeneration) return Promise.resolve(false)
    const selectionGeneration = (this._focusSelectionGeneration || 0) + 1
    this._focusSelectionGeneration = selectionGeneration
    const apply = () => {
      if (selectionGeneration !== this._focusSelectionGeneration) return false
      if (source === 'location' && locationGeneration !== undefined && locationGeneration !== this._locationGeneration) return false
      snapshot = dataRuntime.getSnapshot()
      const currentState = this.data.state
      const cities = source === 'location' ? [focusCity] : [...currentState.cities]
      if (source !== 'location' && !cities.includes(focusCity) && cities.length < 3) cities.push(focusCity)
      if (source === 'location') this.setData({ locatedCityId: focusCity })
      this.applyState({ ...currentState, focusCity, cities })
      try { wx.setStorageSync(FOCUS_SOURCE_KEY, source) } catch (_) {}
      return true
    }
    if (dataRuntime.hasCity(focusCity)) return Promise.resolve(apply())
    return dataRuntime.ensureCities([focusCity]).then(apply).catch((error) => {
      console.error('[data:update] selected city download failed', error)
      wx.showToast({ title: '城市数据下载失败，请稍后重试', icon: 'none' })
      return false
    })
  },
  locateCurrentCity(options = {}) {
    if (this.data.locationStatus === 'locating') return
    if (!locationConfig.cloudEnvId || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      wx.showToast({ title: '定位服务待配置，可手动选城', icon: 'none' })
      return
    }

    const locationGeneration = (this._locationGeneration || 0) + 1
    this._locationGeneration = locationGeneration
    if (options.useCache) {
      const cached = readValidLocationCache()
      if (cached) {
        void this.selectFocusCity(cached.cityId, 'location', locationGeneration)
        return
      }
    }

    this.setData({ locationStatus: 'locating' })
    wx.getFuzzyLocation({
      type: 'gcj02',
      isHighAccuracy: false,
      success: ({ latitude, longitude }) => {
        if (locationGeneration !== this._locationGeneration) return
        wx.cloud.callFunction({
          name: locationConfig.cloudFunctionName,
          data: { latitude, longitude },
          success: ({ result }) => {
            if (locationGeneration !== this._locationGeneration) return
            const cityId = resolveCityId(snapshot.cityMap, result && result.city, result && result.province)
            if (!cityId) return this.finishLocation('error', '当前位置未匹配到70城，请手动选择')
            void this.selectFocusCity(cityId, 'location', locationGeneration).then((applied) => {
              if (!applied || locationGeneration !== this._locationGeneration) return
              try { wx.setStorageSync(LOCATION_CACHE_KEY, { cityId, locatedAt: Date.now() }) } catch (_) {}
              this.finishLocation('success', `已定位到${snapshot.cityMap[cityId].name}`)
            })
          },
          fail: () => { if (locationGeneration === this._locationGeneration) this.finishLocation('error', '定位服务暂不可用，请手动选择') },
        })
      },
      fail: (error) => {
        if (locationGeneration !== this._locationGeneration) return
        console.error('[location:fuzzy] getFuzzyLocation failed', error)
        this.finishLocation('error', '未能获取位置，可手动选择城市')
      },
    })
  },
  finishLocation(status, message) {
    this.setData({ locationStatus: status })
    wx.showToast({ title: message, icon: 'none' })
  },
  onPropertyChange(event) { this.applyState({ ...this.data.state, propertyType: OPTIONS.property[Number(event.detail.value)].value }) },
  onMetricChange(event) { this.applyState({ ...this.data.state, metric: OPTIONS.metric[Number(event.detail.value)].value }) },
  onSizeChange(event) { this.applyState({ ...this.data.state, sizeBand: OPTIONS.size[Number(event.detail.value)].value }) },
  onRangeChange(event) {
    const option = availableRangeOptions()[Number(event.detail.value)]
    if (option) this.applyState({ ...this.data.state, range: option.value })
  },
  resetFilters() { this.applyState({ ...this.data.state, metric: DEFAULT_STATE.metric, propertyType: DEFAULT_STATE.propertyType, sizeBand: DEFAULT_STATE.sizeBand, range: DEFAULT_STATE.range }) },
  jumpTo(event) {
    const target = event.currentTarget.dataset.target
    this.setData({ activeSection: target })
    wx.pageScrollTo({ selector: `#${target}`, offsetTop: -110, duration: 260 })
  },
  toggleLegend(event) {
    const id = event.currentTarget.dataset.id
    const hidden = [...this.data.hiddenCityIds]
    const index = hidden.indexOf(id)
    if (index >= 0) hidden.splice(index, 1)
    else {
      if (hidden.length >= this.data.state.cities.length - 1) return wx.showToast({ title: '至少保留一条趋势线', icon: 'none' })
      hidden.push(id)
    }
    this.setData({ hiddenCityIds: hidden, selectedCities: this.data.selectedCities.map((city) => ({ ...city, hidden: hidden.includes(city.id) })) }, () => {
      if (this.chart) this.chart.changeData(this.getTrendData())
      if (this.cumulativeChart) this.cumulativeChart.changeData(this.getCumulativeData())
    })
  },
  toggleExact() { this.setData({ exactOpen: !this.data.exactOpen }) },
  onExactMonthChange(event) {
    const exactMonthIndex = Number(event.detail.value)
    const exactMonth = this.data.exactMonths[exactMonthIndex]
    this.setData({ exactMonthIndex, exactMonth, exactData: buildExactData(this.data.state, exactMonth, this.data.cumulativeData) })
  },
  openPicker() { this.setData({ pickerOpen: true }) },
  closePicker() { this.setData({ pickerOpen: false, searchText: '', cityOptions: makeView(this.data.state, '', this.data.hiddenCityIds).cityOptions }) },
  stopPropagation() {},
  onSearch(event) {
    const searchText = event.detail.value
    this.setData({ searchText, cityOptions: makeView(this.data.state, searchText, this.data.hiddenCityIds).cityOptions })
  },
  toggleCity(event) {
    const id = event.currentTarget.dataset.id
    const cities = [...this.data.state.cities]
    const index = cities.indexOf(id)
    if (index >= 0) cities.splice(index, 1)
    else if (cities.length < 3) cities.push(id)
    else return wx.showToast({ title: '最多选择3座城市', icon: 'none' })
    const apply = () => {
      snapshot = dataRuntime.getSnapshot()
      const latestState = this.data.state
      if (index < 0) {
        if (latestState.cities.includes(id)) return
        if (latestState.cities.length >= 3) return wx.showToast({ title: '最多选择3座城市', icon: 'none' })
        this.applyState({ ...latestState, cities: [...latestState.cities, id] })
        return
      }
      this.applyState({ ...latestState, cities: latestState.cities.filter((cityId) => cityId !== id) })
    }
    if (index < 0 && !dataRuntime.hasCity(id)) {
      dataRuntime.ensureCities([id]).then(apply).catch((error) => {
        console.error('[data:update] selected city download failed', error)
        wx.showToast({ title: '城市数据下载失败，请稍后重试', icon: 'none' })
      })
      return
    }
    apply()
  },
  resetCities() {
    const cityId = snapshot.cityMap[this.data.locatedCityId] ? this.data.locatedCityId : DEFAULT_STATE.focusCity
    const apply = () => { snapshot = dataRuntime.getSnapshot(); this.applyState({ ...this.data.state, cities: [cityId] }) }
    if (dataRuntime.hasCity(cityId)) return apply()
    dataRuntime.ensureCities([cityId]).then(apply).catch(() => wx.showToast({ title: '城市数据下载失败，请稍后重试', icon: 'none' }))
  },
  retryChart(event) {
    const type = event.currentTarget.dataset.type
    if (!['trend', 'cumulative', 'breadth'].includes(type)) return
    const property = type === 'trend' ? 'chart' : `${type}Chart`
    const chart = this[property]
    if (chart && typeof chart.destroy === 'function') chart.destroy()
    this[property] = null
    this.setData({ [`${type}ChartError`]: false })
  },
  onPageScroll(event) {
    const shouldFixAnalysisNav = this._analysisNavTop !== undefined && event.scrollTop >= this._analysisNavTop
    if (shouldFixAnalysisNav !== this.data.analysisNavFixed) this.setData({ analysisNavFixed: shouldFixAnalysisNav })
    if (this._scrollTick) return
    this._scrollTick = setTimeout(() => {
      this._scrollTick = null
      wx.createSelectorQuery().selectAll('.section').boundingClientRect((rects) => {
        const current = rects.filter((rect) => rect.top <= 150).at(-1)
        if (current && current.id && current.id !== this.data.activeSection) this.setData({ activeSection: current.id })
      }).exec()
    }, 80)
  },
  onResize() {
    if (isDesktopChartEnvironment()) return
    clearTimeout(this._resizeTick)
    this._resizeTick = setTimeout(() => this.resizeCharts(), 120)
  },
  resizeCharts() {
    // Desktop wx-f2 obtains the correct initial canvas size. Its later resize
    // pass in DevTools corrupts the drawing transform, while phone rotation
    // still needs the normal resize path.
    if (isDesktopChartEnvironment()) return
    const query = wx.createSelectorQuery()
    query.select('.chart-shell').boundingClientRect()
    query.select('.cumulative-chart').boundingClientRect()
    query.select('.history-chart').boundingClientRect()
    query.exec((rects) => {
      const charts = [this.chart, this.cumulativeChart, this.breadthChart]
      rects.forEach((rect, index) => {
        if (rect && charts[index] && typeof charts[index].changeSize === 'function') charts[index].changeSize(rect.width, rect.height)
      })
    })
  },
  onUnload() {
    this._locationGeneration = (this._locationGeneration || 0) + 1
    this._focusSelectionGeneration = (this._focusSelectionGeneration || 0) + 1
    clearTimeout(this._scrollTick)
    clearTimeout(this._resizeTick)
    ;[this.chart, this.cumulativeChart, this.breadthChart].forEach((chart) => {
      if (chart && typeof chart.destroy === 'function') chart.destroy()
    })
  },
  openSource() { wx.navigateTo({ url: '/pages/source/source' }) },
})
