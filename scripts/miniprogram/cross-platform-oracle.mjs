import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync(resolve(root, 'apps/web/public/data/manifest.json'), 'utf8'))
const marketPath = resolve(root, 'apps/web/public', manifest.market_data_url.slice(1))
const snapshotPath = resolve(root, 'apps/miniprogram/data/snapshot.js')
const snapshot = require(snapshotPath)
const matrix = {
  property_types: ['new', 'resale'],
  size_bands: ['all', 'le90', '90_144', 'gt144'],
  metrics: ['mom', 'yoy'],
  ranges: [36, 60, 120],
  focus_cities: ['beijing', 'fuzhou', 'xiamen'],
}

function sha256(value) {
  return createHash('sha256').update(Buffer.isBuffer(value) || value instanceof Uint8Array ? value : typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function fileIdentity(path) {
  const bytes = readFileSync(path)
  return { path: path.replace(`${root}\\`, '').replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes) }
}

function buildCases() {
  const cases = []
  for (const property_type of matrix.property_types) {
    for (const size_band of matrix.size_bands) {
      for (const metric of matrix.metrics) {
        for (const range of matrix.ranges) {
          for (const focus_city of matrix.focus_cities) cases.push({ property_type, size_band, metric, range, focus_city })
        }
      }
    }
  }
  return cases
}

export function buildOracleInput() {
  const cityPaths = Object.fromEntries(matrix.focus_cities.map((city) => [city, resolve(root, 'apps/web/public', manifest.city_data_url_template.replace('{city_id}', city).slice(1))]))
  const base = {
    oracle_version: 'housing-cross-platform-oracle-v1',
    dataset: {
      dataset_version: manifest.dataset_version,
      snapshot_version: snapshot.datasetVersion,
      client_month_start: snapshot.months[0],
      client_month_end: snapshot.months.at(-1),
      market_file: fileIdentity(marketPath),
      city_files: Object.fromEntries(Object.entries(cityPaths).map(([city, path]) => [city, fileIdentity(path)])),
    },
    matrix,
    cases: buildCases(),
  }
  return { ...base, input_sha256: sha256(canonical(base)) }
}

function rank(values) {
  const sorted = [...values].sort((left, right) => right.value - left.value || left.city_id.localeCompare(right.city_id, 'en'))
  const frequency = new Map()
  for (const item of sorted) frequency.set(item.value, (frequency.get(item.value) || 0) + 1)
  let previousValue = null
  let previousRank = 0
  return sorted.map((item, index) => {
    const itemRank = item.value === previousValue ? previousRank : index + 1
    previousValue = item.value
    previousRank = itemRank
    return { city_id: item.city_id, value: item.value, rank: itemRank, tied: (frequency.get(item.value) || 0) > 1 }
  })
}

function directionCounts(values) {
  return values.reduce((result, value) => {
    if (value === null || value === undefined || !Number.isFinite(value)) result.missing += 1
    else if (value > 0) result.up += 1
    else if (value < 0) result.down += 1
    else result.flat += 1
    return result
  }, { up: 0, flat: 0, down: 0, missing: 0 })
}

export function evaluateBoundaryFixture() {
  const values = [
    { city_id: 'beijing', value: 0.2 },
    { city_id: 'shanghai', value: 0.2 },
    { city_id: 'xiamen', value: null },
    { city_id: 'fuzhou', value: -0.1 },
  ]
  return {
    counts: directionCounts(values.map((item) => item.value)),
    ranked: rank(values.filter((item) => Number.isFinite(item.value))).map(({ city_id, rank: itemRank, tied }) => ({ city_id, rank: itemRank, tied })),
  }
}

function expectedMarket(records, testCase) {
  const relevant = records.filter((record) => record.property_type === testCase.property_type && record.size_band === testCase.size_band)
  const statMonth = [...new Set(relevant.map((record) => record.stat_month))].sort().at(-1) || null
  const latest = relevant.filter((record) => record.stat_month === statMonth)
  const values = snapshot.cityIds.map((city_id) => {
    const record = latest.find((item) => item.city_id === city_id)
    return { city_id, value: record ? record[testCase.metric === 'mom' ? 'mom_change' : 'yoy_change'] : null }
  })
  const numeric = values.filter((item) => Number.isFinite(item.value)).map((item) => ({ city_id: item.city_id, value: item.value }))
  const national = rank(numeric)
  const profile = snapshot.cityMap[testCase.focus_city]
  const tier = rank(national.filter((item) => snapshot.cityMap[item.city_id].tier === profile.tier).map(({ city_id, value }) => ({ city_id, value })))
  const province = rank(national.filter((item) => snapshot.cityMap[item.city_id].province === profile.province).map(({ city_id, value }) => ({ city_id, value })))
  return JSON.parse(JSON.stringify({
    stat_month: statMonth,
    counts: directionCounts(values.map((item) => item.value)),
    national: national.map(({ city_id, rank: itemRank }) => ({ city_id, rank: itemRank })),
    focus_rank: national.find((item) => item.city_id === testCase.focus_city)?.rank ?? null,
    tier: {
      ranked: tier.map(({ city_id, rank: itemRank }) => ({ city_id, rank: itemRank })),
      focus_rank: tier.find((item) => item.city_id === testCase.focus_city)?.rank ?? null,
    },
    province: {
      ranked: province.map(({ city_id, rank: itemRank }) => ({ city_id, rank: itemRank })),
      focus_rank: province.find((item) => item.city_id === testCase.focus_city)?.rank ?? null,
    },
  }))
}

function expectedCumulative(records, testCase) {
  const months = snapshot.months.slice(-testCase.range)
  const byMonth = new Map(records.filter((record) => record.city_id === testCase.focus_city && record.property_type === testCase.property_type && record.size_band === testCase.size_band).map((record) => [record.stat_month, record]))
  let value = 100
  let broken = false
  return months.map((month, index) => {
    const record = byMonth.get(month)
    if (index > 0) {
      if (broken || !record || record.mom_index === null || record.mom_index === undefined) broken = true
      else value *= record.mom_index / 100
    }
    return { month, value: broken ? null : Number(value.toFixed(4)) }
  })
}

function loadMiniPage() {
  let pageConfig
  const runtime = {
    getSnapshot: () => snapshot,
    getSource: () => 'bundled',
    hasCity: (cityId) => Boolean(snapshot.series[cityId]),
    refresh: async () => ({ updated: false, source: 'bundled', reason: 'not-due' }),
    ensureCities: async () => true,
  }
  const pageDirectory = resolve(root, 'apps/miniprogram/pages/index')
  const context = {
    Page(config) { pageConfig = config },
    console: { info() {}, error() {} },
    Date,
    setTimeout,
    clearTimeout,
    require(specifier) {
      if (specifier === '../../utils/data-runtime.js') return runtime
      return require(resolve(pageDirectory, specifier))
    },
  }
  runInNewContext(readFileSync(resolve(pageDirectory, 'index.js'), 'utf8'), context, { filename: resolve(pageDirectory, 'index.js') })
  return pageConfig
}

function miniResult(pageConfig, testCase) {
  const harness = {
    ...pageConfig,
    data: {
      ...pageConfig.data,
      state: { ...pageConfig.data.state, cities: [...pageConfig.data.state.cities] },
      hiddenCityIds: [],
      selectedCities: [],
      cityOptions: [],
    },
    setData(update, callback) { Object.assign(this.data, update); callback?.() },
    drawSparklines() {},
  }
  harness.applyState({ metric: testCase.metric, propertyType: testCase.property_type, sizeBand: testCase.size_band, range: testCase.range, focusCity: testCase.focus_city, cities: [testCase.focus_city] }, false)
  return JSON.parse(JSON.stringify({
    market: {
      stat_month: snapshot.datasetAsOf,
      counts: harness.data.counts,
      national: harness.data.market.nationalRows.map((row) => ({ city_id: row.id, rank: row.rank })),
      focus_rank: harness.data.market.nationalRank === '—' ? null : harness.data.market.nationalRank,
      tier: {
        ranked: harness.data.market.tierRows.map((row) => ({ city_id: row.id, rank: row.rank })),
        focus_rank: harness.data.market.tierRank === '—' ? null : harness.data.market.tierRank,
      },
      province: {
        ranked: harness.data.market.provinceRows.map((row) => ({ city_id: row.id, rank: row.rank })),
        focus_rank: harness.data.market.provinceRank === '—' ? null : harness.data.market.provinceRank,
      },
    },
    cumulative: harness.data.cumulativeData.map((item) => ({ month: item.month, value: item.value })),
  }))
}

function runWebCore(cases) {
  const payload = JSON.stringify(cases)
  const script = `import { readFileSync } from 'node:fs'; import { getCumulativeIndexSeries, getMarketPosition, getWindowRecords } from '@housing/core'; const cases=JSON.parse(process.env.ORACLE_CASES); const market=JSON.parse(readFileSync(process.env.ORACLE_MARKET,'utf8')).records; const cityPaths=JSON.parse(process.env.ORACLE_CITY_PATHS); const minMonth=process.env.ORACLE_MIN_MONTH; const output=cases.map((c)=>{ const m=getMarketPosition(market,c.property_type,c.metric,c.focus_city,c.size_band); const rows=(mkt)=>mkt.map((x)=>({city_id:x.city_id,rank:x.rank})); const city=JSON.parse(readFileSync(cityPaths[c.focus_city],'utf8')).records.filter((r)=>r.stat_month>=minMonth&&r.property_type===c.property_type&&r.size_band===c.size_band); const cumulative=getCumulativeIndexSeries(getWindowRecords(city,c.range)).map((x)=>({month:x.stat_month,value:x.value===null?null:Number(x.value.toFixed(4))})); return {market:{stat_month:m.stat_month,counts:m.counts,national:rows(m.ranked),focus_rank:m.focus?.rank??null,tier:{ranked:rows(m.tier.ranked),focus_rank:m.tier.focus?.rank??null},province:{ranked:rows(m.province.ranked),focus_rank:m.province.focus?.rank??null}},cumulative}; }); console.log(JSON.stringify(output));`
  const cityPaths = Object.fromEntries(matrix.focus_cities.map((city) => [city, resolve(root, 'apps/web/public', manifest.city_data_url_template.replace('{city_id}', city).slice(1))]))
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], {
    cwd: root,
    env: { ...process.env, ORACLE_CASES: payload, ORACLE_MARKET: marketPath, ORACLE_CITY_PATHS: JSON.stringify(cityPaths), ORACLE_MIN_MONTH: snapshot.months[0] },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`Web oracle subprocess failed: ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout)
}

export function runCrossPlatformOracle() {
  const input = buildOracleInput()
  const marketRecords = readJson(marketPath).records
  const cityPaths = Object.fromEntries(matrix.focus_cities.map((city) => [city, resolve(root, 'apps/web/public', manifest.city_data_url_template.replace('{city_id}', city).slice(1))]))
  const expected = input.cases.map((testCase) => ({ market: expectedMarket(marketRecords, testCase), cumulative: expectedCumulative(readJson(cityPaths[testCase.focus_city]).records, testCase) }))
  const web = runWebCore(input.cases)
  const pageConfig = loadMiniPage()
  const mini = input.cases.map((testCase) => miniResult(pageConfig, testCase))
  return {
    input,
    expected,
    expected_sha256: sha256(canonical(expected)),
    web,
    mini,
    case_count: input.cases.length,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const report = runCrossPlatformOracle()
  const mismatches = []
  report.expected.forEach((expected, index) => {
    if (canonical(expected) !== canonical(report.web[index])) mismatches.push({ platform: 'web', index })
    if (canonical(expected) !== canonical(report.mini[index])) mismatches.push({ platform: 'miniprogram', index })
  })
  if (mismatches.length) throw new Error(`跨平台oracle不一致：${JSON.stringify(mismatches.slice(0, 10))}`)
  console.log(JSON.stringify({ oracle_version: report.input.oracle_version, input_sha256: report.input.input_sha256, expected_sha256: report.expected_sha256, case_count: report.case_count, status: 'passed' }, null, 2))
}
