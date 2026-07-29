import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { validateCorrectionDescriptor } from './remote-data-lib.mjs'

const execFileAsync = promisify(execFile)
const DATA_PATH = 'apps/web/public/data/data.json'
const BUSINESS_FIELDS = Object.freeze([
  'release_date', 'city_name', 'mom_index', 'yoy_index', 'ytd_avg_index',
  'ytd_period_start', 'ytd_period_end', 'ytd_comparison_base', 'mom_change',
  'yoy_change', 'mom_missing_reason', 'yoy_missing_reason', 'ytd_missing_reason',
  'source_url', 'source_type', 'source_batch_id', 'source_record_locator',
  'methodology_version', 'parser_version',
])

export function recordKey(record) {
  return [record.stat_month, record.city_id, record.property_type, record.size_band].join('|')
}

function valueEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function indexRecords(records, label) {
  const result = new Map()
  for (const record of records || []) {
    const key = recordKey(record)
    if (result.has(key)) throw new Error(`${label} contains duplicate record ${key}`)
    result.set(key, record)
  }
  return result
}

export function actualBusinessChanges(previousData, currentData) {
  const previous = indexRecords(previousData?.records, 'baseline data')
  const current = indexRecords(currentData?.records, 'candidate data')
  if (previous.size !== current.size) throw new Error('historical correction cannot add or delete records')
  const changes = []
  for (const [key, before] of previous) {
    const after = current.get(key)
    if (!after) throw new Error(`historical correction deleted record ${key}`)
    for (const field of BUSINESS_FIELDS) {
      if (!valueEqual(before[field], after[field])) changes.push({ record_key: key, field, old_value: before[field] ?? null, new_value: after[field] ?? null })
    }
  }
  return changes.sort((a, b) => `${a.record_key}|${a.field}`.localeCompare(`${b.record_key}|${b.field}`))
}

export function validateHistoricalCorrection({ request, previousData, currentData, auditReport }) {
  if (!/^[a-f0-9]{40}$/.test(request?.baseline_commit_sha || '')) throw new Error('correction baseline commit SHA is invalid')
  validateCorrectionDescriptor(request, {
    datasetAsOf: currentData?.records?.reduce((latest, item) => item.stat_month > latest ? item.stat_month : latest, ''),
    datasetVersion: currentData?.dataset_version,
  })
  if (previousData?.dataset_version !== request.supersedes_source_dataset_version) throw new Error('baseline dataset version does not match superseded source')
  if (currentData?.dataset_version !== request.source_dataset_version) throw new Error('candidate dataset version does not match correction source')
  if (auditReport?.result !== 'passed' || !/^full-record-audit-v\d+$/.test(auditReport?.audit_version || '')) throw new Error('current full-record audit has not passed')
  if (auditReport.audit_version !== request.audit_version) throw new Error('correction audit version does not match current audit')
  if (auditReport.record_count !== currentData.records.length) throw new Error('full-record audit does not cover every candidate record')
  const months = currentData.records.map((record) => record.stat_month).sort()
  if (auditReport.coverage_start !== undefined && (auditReport.coverage_start !== months[0] || auditReport.coverage_end !== months.at(-1))) throw new Error('full-record audit coverage does not match candidate records')
  if (Array.isArray(auditReport.batches)) {
    if (auditReport.batch_count !== auditReport.batches.length || auditReport.batches.some((item) => item.result !== 'passed')) throw new Error('full-record audit batches are incomplete')
    const auditedBatchIds = new Set(auditReport.batches.map((item) => item.source_batch_id))
    const candidateBatchIds = new Set(currentData.records.map((record) => record.source_batch_id))
    if ([...candidateBatchIds].some((id) => !auditedBatchIds.has(id))) throw new Error('full-record audit is missing a candidate source batch')
    if (request.source_batch_ids.some((id) => !auditedBatchIds.has(id))) throw new Error('correction source batch is missing from the full-record audit')
  }
  const candidateParserVersions = [...new Set(currentData.records.map((record) => record.parser_version))]
  if (candidateParserVersions.length !== 1 || candidateParserVersions[0] !== request.parser_version) throw new Error('correction parser version does not match every candidate record')

  const actual = actualBusinessChanges(previousData, currentData)
  const approved = request.changes.map((item) => ({
    record_key: item.record_key,
    field: item.field,
    old_value: item.old_value ?? null,
    new_value: item.new_value ?? null,
  })).sort((a, b) => `${a.record_key}|${a.field}`.localeCompare(`${b.record_key}|${b.field}`))
  if (!valueEqual(actual, approved)) {
    const actualKeys = actual.map((item) => `${item.record_key}|${item.field}`)
    const approvedKeys = approved.map((item) => `${item.record_key}|${item.field}`)
    throw new Error(`approved changes do not exactly match actual business-data changes; actual=${actualKeys.join(',')}; approved=${approvedKeys.join(',')}`)
  }
  for (const change of request.changes) {
    const record = currentData.records.find((item) => recordKey(item) === change.record_key)
    if (change.source_url !== record.source_url || change.source_record_locator !== record.source_record_locator) throw new Error(`correction source evidence differs from candidate record ${change.record_key}`)
  }
  return { ...request, changed_record_count: new Set(actual.map((item) => item.record_key)).size, changed_field_count: actual.length }
}

export async function loadAndValidateHistoricalCorrection({ root, requestPath }) {
  const request = JSON.parse(await readFile(requestPath, 'utf8'))
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', request.baseline_commit_sha, 'HEAD'], { cwd: root, encoding: 'utf8' })
  } catch (_) {
    throw new Error('baseline commit is not an ancestor of the candidate commit')
  }
  const { stdout: previousText } = await execFileAsync('git', ['show', `${request.baseline_commit_sha}:${DATA_PATH}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const [currentText, auditText] = await Promise.all([
    readFile(`${root}/${DATA_PATH}`, 'utf8'),
    readFile(`${root}/data/audit-report.json`, 'utf8'),
  ])
  return validateHistoricalCorrection({ request, previousData: JSON.parse(previousText), currentData: JSON.parse(currentText), auditReport: JSON.parse(auditText) })
}

export { BUSINESS_FIELDS }
