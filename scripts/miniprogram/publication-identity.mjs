import { createHash } from 'node:crypto'

// This identity deliberately excludes run-time collection metadata. It binds
// the semantics delivered to clients, while the independent audit still binds
// the full raw record evidence separately.
export const CANDIDATE_RECORD_FIELDS = Object.freeze([
  'stat_month', 'city_id', 'property_type', 'size_band',
  'release_date', 'city_name', 'mom_index', 'yoy_index', 'ytd_avg_index',
  'ytd_period_start', 'ytd_period_end', 'ytd_comparison_base', 'mom_change',
  'yoy_change', 'mom_missing_reason', 'yoy_missing_reason', 'ytd_missing_reason',
  'source_url', 'source_type', 'source_batch_id', 'source_record_locator',
  'methodology_version', 'parser_version',
])

function assert(condition, message) {
  if (!condition) throw new Error(`Publication identity is invalid: ${message}`)
}

function recordKey(record) {
  return [record?.stat_month, record?.city_id, record?.property_type, record?.size_band].join('|')
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function canonicalRecord(record) {
  const result = {}
  for (const field of CANDIDATE_RECORD_FIELDS) result[field] = record?.[field] ?? null
  return result
}

function sortedUnique(values, label) {
  assert(Array.isArray(values) && values.every((item) => typeof item === 'string' && item.length > 0), `${label} must be a string array`)
  const sorted = [...values].sort()
  assert(new Set(sorted).size === sorted.length, `${label} must not contain duplicates`)
  return sorted
}

export function candidateRecordsSha256(records) {
  assert(Array.isArray(records) && records.length > 0, 'candidate records are missing')
  const canonical = records.map(canonicalRecord).sort((left, right) => recordKey(left).localeCompare(recordKey(right)))
  assert(new Set(canonical.map(recordKey)).size === canonical.length, 'candidate records contain duplicate business keys')
  return digest({ format: 'housing-candidate-records-v1', fields: CANDIDATE_RECORD_FIELDS, records: canonical })
}

export function auditedRecordsSha256(records) {
  assert(Array.isArray(records) && records.length > 0, 'audited records are missing')
  const ordered = [...records].sort((left, right) => recordKey(left).localeCompare(recordKey(right)))
  assert(new Set(ordered.map(recordKey)).size === ordered.length, 'audited records contain duplicate business keys')
  return digest(ordered)
}

export function auditReportSha256(auditReport) {
  assert(auditReport && typeof auditReport === 'object' && !Array.isArray(auditReport), 'audit report is missing')
  const { report_sha256: _ignored, ...content } = auditReport
  return digest(content)
}

export function sourceIndexSha256(batches) {
  assert(Array.isArray(batches) && batches.length > 0, 'source batches are missing')
  const sources = batches.map((batch) => {
    const source = batch?.source_batch ?? batch
    assert(source && typeof source === 'object', 'source batch is invalid')
    return {
      source_batch_id: source.source_batch_id,
      source_url: source.source_url,
      final_url: source.final_url,
      stat_month: source.stat_month,
      release_date: source.release_date,
      raw_content_sha256: source.raw_content_sha256,
      parser_version: source.parser_version,
      schema_version: source.schema_version,
    }
  }).sort((left, right) => String(left.source_batch_id).localeCompare(String(right.source_batch_id)))
  return digest(sources)
}

export function validateAuditSourceIndex({ auditReport, batches }) {
  assert(auditReport && typeof auditReport === 'object', 'audit report is missing')
  assert(Array.isArray(batches) && batches.length > 0, 'source batches are missing')
  assert(auditReport.batch_count === batches.length, 'audit batch count does not match source batches')
  assert(auditReport.source_index_sha256 === sourceIndexSha256(batches), 'audit source index hash does not match source batches')
  assert(Array.isArray(auditReport.batches) && auditReport.batches.length === batches.length, 'audit batch evidence is incomplete')
  const evidence = new Map()
  for (const item of auditReport.batches) {
    assert(!evidence.has(item?.source_batch_id), `audit contains duplicate source batch ${item?.source_batch_id}`)
    evidence.set(item?.source_batch_id, item)
  }
  for (const batch of batches) {
    const source = batch?.source_batch
    const item = evidence.get(source?.source_batch_id)
    assert(item, `audit is missing source batch ${source?.source_batch_id}`)
    assert(item.result === 'passed' && item.stat_month === source.stat_month && item.raw_content_sha256 === source.raw_content_sha256, `audit source evidence differs for ${source.source_batch_id}`)
    assert(item.records_checked === batch.records.length && item.records_sha256 === source.audited_records_sha256, `audit record evidence differs for ${source.source_batch_id}`)
  }
  return true
}

function auditBatchIds(auditReport) {
  assert(Array.isArray(auditReport?.batches), 'audit batches are missing')
  return sortedUnique(auditReport.batches.map((item) => item?.source_batch_id), 'audit source batch IDs')
}

export function buildPublicationIdentity({ records, auditReport }) {
  const recordCount = Array.isArray(records) ? records.length : 0
  assert(auditReport?.result === 'passed', 'full-record audit has not passed')
  assert(Number.isInteger(auditReport?.record_count) && auditReport.record_count === recordCount, 'audit record count does not match candidate')
  assert(/^[a-f0-9]{64}$/.test(auditReport?.records_sha256 || '') && auditReport.records_sha256 === auditedRecordsSha256(records), 'audit records hash does not match candidate')
  assert(/^[a-f0-9]{64}$/.test(auditReport?.source_index_sha256 || ''), 'audit source index hash is invalid')
  assert(/^[a-f0-9]{64}$/.test(auditReport?.report_sha256 || '') && auditReport.report_sha256 === auditReportSha256(auditReport), 'audit report hash does not match content')
  assert(/^[a-f0-9]{64}$/.test(auditReport?.audit_code_sha256 || ''), 'audit code hash is invalid')
  assert(/^[a-f0-9]{40}$/.test(auditReport?.repository_commit_sha || ''), 'audit commit SHA is invalid')
  assert(typeof auditReport?.audit_version === 'string' && auditReport.audit_version.length > 0, 'audit version is missing')
  const parserVersions = sortedUnique(auditReport?.parser_versions, 'audit parser versions')
  const candidateParserVersions = sortedUnique([...new Set(records.map((record) => record?.parser_version))], 'candidate parser versions')
  assert(JSON.stringify(parserVersions) === JSON.stringify(candidateParserVersions), 'audit parser versions do not match candidate')
  const recordBatchIds = sortedUnique([...new Set(records.map((record) => record?.source_batch_id))], 'candidate source batch IDs')
  assert(JSON.stringify(auditBatchIds(auditReport)) === JSON.stringify(recordBatchIds), 'audit batches do not exactly match candidate source batches')
  return {
    candidate_records_sha256: candidateRecordsSha256(records),
    audit_records_sha256: auditReport.records_sha256,
    source_index_sha256: auditReport.source_index_sha256,
    audit_report_sha256: auditReport.report_sha256,
    audit_commit_sha: auditReport.repository_commit_sha,
    audit_code_sha256: auditReport.audit_code_sha256,
    audit_version: auditReport.audit_version,
    parser_versions: parserVersions,
  }
}

export function validatePublicationIdentity(identity) {
  assert(identity && typeof identity === 'object' && !Array.isArray(identity), 'identity is missing')
  for (const field of [
    'candidate_records_sha256', 'audit_records_sha256', 'source_index_sha256',
    'audit_report_sha256', 'audit_code_sha256',
  ]) assert(/^[a-f0-9]{64}$/.test(identity[field] || ''), `${field} is invalid`)
  assert(/^[a-f0-9]{40}$/.test(identity.audit_commit_sha || ''), 'audit_commit_sha is invalid')
  assert(typeof identity.audit_version === 'string' && identity.audit_version.length > 0, 'audit_version is invalid')
  const parserVersions = sortedUnique(identity.parser_versions, 'identity parser versions')
  assert(JSON.stringify(parserVersions) === JSON.stringify(identity.parser_versions), 'identity parser versions are not canonical')
  return identity
}
