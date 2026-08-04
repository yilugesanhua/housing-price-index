import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CITY_IDS, CITY_NAMES, CITY_PROFILES, CITY_SEARCH_ALIASES, CITY_TIER_LABELS, FEATURED_CITY_IDS, type CityId, type PriceRecord } from '../../packages/core/src/index.ts'

const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(await readFile(resolve(root, 'apps/web/public/data/manifest.json'), 'utf8'))
const payload = JSON.parse(await readFile(resolve(root, 'apps/web/public/data/data.json'), 'utf8')) as { records: PriceRecord[] }
const output = resolve(root, 'work/miniprogram-data-input/complete-snapshot.json')
const expectedStart = process.argv.find((argument) => argument.startsWith('--start='))?.slice('--start='.length) || '2011-07'
const expectedMonths = 180
const seriesCodes = ['n_a', 'n_s', 'n_m', 'n_l', 'r_a', 'r_s', 'r_m', 'r_l']
const bandCode: Record<PriceRecord['size_band'], string> = { all: 'a', le90: 's', '90_144': 'm', gt144: 'l' }

function monthRange(start: string, end: string): string[] {
  const result: string[] = []
  const date = new Date(`${start}-01T00:00:00Z`)
  while (date.toISOString().slice(0, 7) <= end) {
    result.push(date.toISOString().slice(0, 7))
    date.setUTCMonth(date.getUTCMonth() + 1)
  }
  return result
}

const months = monthRange(expectedStart, manifest.dataset_as_of)
if (months.length !== expectedMonths) throw new Error(`complete snapshot must contain ${expectedMonths} months; got ${months.length}`)
if (manifest.coverage_start !== expectedStart) throw new Error(`published data coverage must start at ${expectedStart}; got ${manifest.coverage_start}`)
const allowedMonths = new Set(months)
const records = payload.records.filter((record) => allowedMonths.has(record.stat_month))
if (records.length !== expectedMonths * CITY_IDS.length * 2 * 4) throw new Error(`complete snapshot record count is invalid: ${records.length}`)

const byKey = new Map(records.map((record) => [`${record.stat_month}|${record.city_id}|${record.property_type}|${record.size_band}`, record]))
if (byKey.size !== records.length) throw new Error('complete snapshot contains duplicate records')
const releaseDates = months.map((month) => {
  const releaseDate = byKey.get(`${month}|${CITY_IDS[0]}|new|all`)?.release_date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate || '')) throw new Error(`release date is missing for ${month}`)
  return releaseDate
})

const series = Object.fromEntries(CITY_IDS.map((cityId: string) => [cityId, Object.fromEntries(seriesCodes.map((code) => [code, []]))])) as Record<string, Record<string, Array<number | null>>>
for (const cityId of CITY_IDS) {
  for (const month of months) {
    for (const propertyType of ['new', 'resale'] as const) {
      for (const sizeBand of Object.keys(bandCode) as PriceRecord['size_band'][]) {
        const record = byKey.get(`${month}|${cityId}|${propertyType}|${sizeBand}`)
        if (!record) throw new Error(`missing complete snapshot record: ${month}/${cityId}/${propertyType}/${sizeBand}`)
        series[cityId][`${propertyType === 'new' ? 'n' : 'r'}_${bandCode[sizeBand]}`].push(record.mom_index, record.yoy_index, record.mom_change, record.yoy_change)
      }
    }
  }
}

const latestSeries = Object.fromEntries(CITY_IDS.map((cityId: string) => [cityId, Object.fromEntries(seriesCodes.map((code) => [code, series[cityId][code].slice(-4)]))]))
const breadthSeries: Record<string, number[]> = {}
for (const code of seriesCodes) {
  for (const [metric, offset] of [['mom', 2], ['yoy', 3]] as const) {
    breadthSeries[`${code}_${metric}`] = months.flatMap((_month, monthIndex) => CITY_IDS.reduce((counts: number[], cityId: string) => {
      const value = series[cityId][code][monthIndex * 4 + offset]
      counts[value === null ? 3 : value > 0 ? 0 : value < 0 ? 2 : 1] += 1
      return counts
    }, [0, 0, 0, 0]))
  }
}

const cityMap = Object.fromEntries(CITY_IDS.map((id: CityId) => [id, {
  name: CITY_NAMES[id],
  search: `${CITY_NAMES[id]} ${id} ${CITY_SEARCH_ALIASES[id]}`.toLowerCase(),
  province: CITY_PROFILES[id].province,
  tier: CITY_PROFILES[id].tier,
  tierLabel: CITY_TIER_LABELS[CITY_PROFILES[id].tier],
}]))
const snapshot = {
  schemaVersion: manifest.schema_version,
  datasetVersion: manifest.dataset_version,
  sourceDatasetVersion: manifest.source_dataset_version,
  datasetAsOf: manifest.dataset_as_of,
  releaseDate: manifest.release_date,
  coverageStart: months[0],
  sourceCoverageStart: manifest.coverage_start,
  latestOfficialUrl: manifest.latest_official_url,
  generatedAt: manifest.generated_at,
  dataStatus: manifest.data_status,
  statusReason: manifest.status_reason,
  nextCheckDueAt: manifest.next_check_due_at,
  months,
  releaseDates,
  cityIds: CITY_IDS,
  featuredCityIds: FEATURED_CITY_IDS,
  cityMap,
  series,
  latestSeries,
  breadthSeries,
}
await mkdir(resolve(output, '..'), { recursive: true })
await writeFile(output, `${JSON.stringify(snapshot)}\n`, 'utf8')
console.log(`Generated complete remote snapshot: ${CITY_IDS.length} cities x ${months.length} months at ${output}`)
