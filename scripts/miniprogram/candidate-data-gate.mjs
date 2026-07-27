const PROPERTY_TYPES = ['new', 'resale']
const SIZE_BANDS = ['all', 'le90', '90_144', 'gt144']

function assert(condition, message) {
  if (!condition) throw new Error(`Candidate data gate rejected: ${message}`)
}

function recordKey(record) {
  return `${record.stat_month}|${record.city_id}|${record.property_type}|${record.size_band}`
}

function addOneMonth(value) {
  const date = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function validateCandidateData({ previousPayload, candidatePayload, expectedMonth, sourceBatch }) {
  const previous = previousPayload?.records ?? []
  const candidate = candidatePayload?.records ?? []
  const previousMonths = [...new Set(previous.map((record) => record.stat_month))].sort()
  const previousMonth = previousMonths.at(-1)
  assert(/^20\d{2}-(0[1-9]|1[0-2])$/.test(previousMonth || ''), 'previous dataset month is invalid')
  assert(expectedMonth === addOneMonth(previousMonth), 'candidate month is not exactly next')
  assert(sourceBatch?.stat_month === expectedMonth, 'source batch month mismatch')
  assert(sourceBatch.verification_status === 'verified', 'source batch has not passed full verification')
  assert(sourceBatch.http_status >= 200 && sourceBatch.http_status < 300, 'source batch HTTP status is invalid')
  assert(/^https:\/\/www\.stats\.gov\.cn\/(sj\/zxfb|xxgk\/sjfb\/zxfb2020)\/.+\.html$/.test(sourceBatch.final_url || ''), 'source batch final URL is not allowlisted')
  const previousByKey = new Map(previous.map((record) => [recordKey(record), record]))
  const candidateByKey = new Map()
  for (const record of candidate) {
    const key = recordKey(record)
    assert(!candidateByKey.has(key), `duplicate record ${key}`)
    candidateByKey.set(key, record)
  }
  assert(candidate.length === previous.length + 560, `record count must increase by 560; got ${candidate.length - previous.length}`)
  for (const [key, record] of previousByKey) {
    const next = candidateByKey.get(key)
    assert(next, `historical record was deleted: ${key}`)
    assert(JSON.stringify(next) === JSON.stringify(record), `historical record changed: ${key}`)
  }
  const newRecords = candidate.filter((record) => record.stat_month === expectedMonth)
  assert(newRecords.length === 560, `new month must contain 560 records; got ${newRecords.length}`)
  const cityIds = [...new Set(previous.map((record) => record.city_id))].sort()
  assert(cityIds.length === 70, `previous dataset must define 70 cities; got ${cityIds.length}`)
  const expectedKeys = new Set(cityIds.flatMap((cityId) => PROPERTY_TYPES.flatMap((propertyType) => SIZE_BANDS.map((sizeBand) => `${expectedMonth}|${cityId}|${propertyType}|${sizeBand}`))))
  const actualKeys = new Set(newRecords.map(recordKey))
  assert(actualKeys.size === expectedKeys.size, 'new month contains duplicate or unexpected scopes')
  for (const key of expectedKeys) assert(actualKeys.has(key), `new month is missing ${key}`)
  assert(newRecords.every((record) => record.source_batch_id === sourceBatch.source_batch_id), 'new month mixes source batches')
  assert(candidate.every((record) => record.stat_month <= expectedMonth), 'candidate contains a future month')
  return {
    status: 'passed',
    previous_month: previousMonth,
    candidate_month: expectedMonth,
    previous_record_count: previous.length,
    candidate_record_count: candidate.length,
    added_record_count: newRecords.length,
    historical_revision_count: 0,
    missing_scope_count: 0,
    duplicate_scope_count: 0,
    source_batch_id: sourceBatch.source_batch_id,
    source_raw_sha256: sourceBatch.raw_content_sha256,
  }
}
