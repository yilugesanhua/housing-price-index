import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { buildPublicationIdentity, candidateRecordsSha256 } from './publication-identity.mjs'
import { sha256, validateCorrectionDescriptor, validateCorrectionRequest } from './remote-data-lib.mjs'

const execFileAsync = promisify(execFile)
const DATA_PATH = 'apps/web/public/data/data.json'
const REVISIONS_PATH = 'data/normalized/revisions.json'
const BUSINESS_FIELDS = Object.freeze([
  'release_date', 'city_name', 'mom_index', 'yoy_index', 'ytd_avg_index',
  'ytd_period_start', 'ytd_period_end', 'ytd_comparison_base', 'mom_change',
  'yoy_change', 'mom_missing_reason', 'yoy_missing_reason', 'ytd_missing_reason',
  'source_url', 'source_type', 'source_batch_id', 'source_record_locator',
  'methodology_version', 'parser_version',
])

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

function canonicalHash(value) {
  return sha256(JSON.stringify(canonicalize(value)))
}

export function recordKey(record) {
  return [record.stat_month, record.city_id, record.property_type, record.size_band].join('|')
}

function valueEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
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

function sortedUnique(values, label) {
  if (!Array.isArray(values) || values.some((item) => typeof item !== 'string' || item.length === 0)) throw new Error(`${label} must be a non-empty string array`)
  const sorted = [...values].sort()
  if (new Set(sorted).size !== sorted.length || !valueEqual(values, sorted)) throw new Error(`${label} must be sorted and unique`)
  return sorted
}

function expectedSourceBatches(records, predicate) {
  return [...new Set(records.filter(predicate).map((record) => record.source_batch_id))].sort()
}

function expectedOfficialUrls(records, changedKeys) {
  return [...new Set(records.filter((record) => changedKeys.has(recordKey(record))).map((record) => record.source_url))].sort()
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

function validateRevisionLedger({ previousLedger, currentLedger, previousRecords, currentRecords, actualChanges, request }) {
  if (!Array.isArray(previousLedger) || !Array.isArray(currentLedger)) throw new Error('revision ledger is missing')
  if (currentLedger.length <= previousLedger.length) throw new Error('revision ledger has no appended entries')
  if (!valueEqual(currentLedger.slice(0, previousLedger.length), previousLedger)) throw new Error('revision ledger rewrites or reorders the existing prefix')

  const append = currentLedger.slice(previousLedger.length)
  const actualKeys = [...new Set(actualChanges.map((item) => item.record_key))].sort()
  const appendKeys = append.map((item) => item?.record_key).sort()
  if (new Set(appendKeys).size !== appendKeys.length || !valueEqual(appendKeys, actualKeys)) throw new Error('revision ledger append set does not exactly match approved changed records')

  const previousByKey = indexRecords(previousRecords, 'baseline data')
  const currentByKey = indexRecords(currentRecords, 'candidate data')
  const revisionIds = new Set()
  const latestRevisionByRecord = new Map()
  for (const entry of previousLedger) {
    if (typeof entry?.revision_id === 'string' && entry.revision_id) {
      if (revisionIds.has(entry.revision_id)) throw new Error('revision ledger contains duplicate historical revision IDs')
      revisionIds.add(entry.revision_id)
      latestRevisionByRecord.set(entry.record_key, entry.revision_id)
    }
  }
  for (const entry of append) {
    if (!entry || typeof entry !== 'object' || typeof entry.revision_id !== 'string' || !entry.revision_id) throw new Error('revision ledger append has an invalid revision ID')
    if (revisionIds.has(entry.revision_id)) throw new Error('revision ledger append reuses a revision ID')
    revisionIds.add(entry.revision_id)
    if (entry.release_type !== 'historical_correction' || entry.reason_type !== request.reason_type) throw new Error('revision ledger append release or reason type differs from correction')
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 10) throw new Error('revision ledger append reason is invalid')
    const before = previousByKey.get(entry.record_key)
    const after = currentByKey.get(entry.record_key)
    if (!before || !after || !valueEqual(entry.previous_value, before) || !valueEqual(entry.revised_value, after)) throw new Error(`revision ledger append differs from approved records: ${entry.record_key}`)
    if (entry.source_batch_id !== after.source_batch_id) throw new Error(`revision ledger append source batch differs: ${entry.record_key}`)
    const expectedSupersedes = latestRevisionByRecord.get(entry.record_key) ?? null
    if (entry.supersedes_revision_id !== expectedSupersedes) throw new Error(`revision ledger supersedes chain is discontinuous: ${entry.record_key}`)
    latestRevisionByRecord.set(entry.record_key, entry.revision_id)
  }
  return {
    ledger_before_sha256: canonicalHash(previousLedger),
    ledger_after_sha256: canonicalHash(currentLedger),
    ledger_append_start: previousLedger.length,
    ledger_append_count: append.length,
    ledger_append_sha256: canonicalHash(append),
  }
}

function validateAuditBinding({ auditReport, currentRecords, request, candidateCommitSha }) {
  const identity = buildPublicationIdentity({ records: currentRecords, auditReport })
  if (auditReport.audit_version !== request.audit_version) throw new Error('correction audit version does not match current audit')
  if (auditReport.repository_commit_sha !== candidateCommitSha) throw new Error('full-record audit commit does not match correction candidate')
  return identity
}

export function validateHistoricalCorrection({ request, previousData, currentData, auditReport, previousLedger, currentLedger, candidateCommitSha, githubRunId = '0' }) {
  if (!/^[a-f0-9]{40}$/.test(request?.baseline_commit_sha || '')) throw new Error('correction baseline commit SHA is invalid')
  if (!/^[a-f0-9]{40}$/.test(candidateCommitSha || auditReport?.repository_commit_sha || '')) throw new Error('correction candidate commit SHA is invalid')
  const effectiveCommitSha = candidateCommitSha || auditReport.repository_commit_sha
  validateCorrectionRequest(request, {
    datasetAsOf: currentData?.records?.reduce((latest, item) => item.stat_month > latest ? item.stat_month : latest, ''),
    sourceDatasetVersion: currentData?.dataset_version,
  })
  if (previousData?.dataset_version !== request.supersedes_source_dataset_version) throw new Error('baseline dataset version does not match superseded source')
  if (currentData?.dataset_version !== request.source_dataset_version) throw new Error('candidate dataset version does not match correction source')
  const currentRecords = currentData?.records
  if (!Array.isArray(currentRecords) || auditReport?.record_count !== currentRecords.length) throw new Error('full-record audit does not cover every candidate record')
  const months = currentRecords.map((record) => record.stat_month).sort()
  if (auditReport?.coverage_start !== undefined && (auditReport.coverage_start !== months[0] || auditReport.coverage_end !== months.at(-1))) throw new Error('full-record audit coverage does not match candidate records')
  const auditIdentity = validateAuditBinding({ auditReport, currentRecords, request, candidateCommitSha: effectiveCommitSha })

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
  const changedKeys = new Set(actual.map((item) => item.record_key))
  for (const change of request.changes) {
    const record = currentRecords.find((item) => recordKey(item) === change.record_key)
    if (change.source_url !== record?.source_url || change.source_record_locator !== record?.source_record_locator) throw new Error(`correction source evidence differs from candidate record ${change.record_key}`)
  }
  const latestMonth = months.at(-1)
  const latestSourceBatchIds = expectedSourceBatches(currentRecords, (record) => record.stat_month === latestMonth)
  const revisionSourceBatchIds = expectedSourceBatches(currentRecords, (record) => changedKeys.has(recordKey(record)))
  if (!valueEqual(request.latest_source_batch_ids, latestSourceBatchIds)) throw new Error('correction latest source batches do not exactly match candidate latest month')
  if (!valueEqual(request.revision_source_batch_ids, revisionSourceBatchIds)) throw new Error('correction revision source batches do not exactly match approved changed records')
  if (!valueEqual(request.official_urls, expectedOfficialUrls(currentRecords, changedKeys))) throw new Error('correction official URLs do not exactly match approved changed records')
  const auditBatchIds = sortedUnique(auditReport.batches.map((item) => item.source_batch_id), 'audit source batch IDs')
  for (const batchId of [...latestSourceBatchIds, ...revisionSourceBatchIds]) {
    if (!auditBatchIds.includes(batchId)) throw new Error(`correction source batch is missing from the full-record audit: ${batchId}`)
  }
  const ledgerIdentity = validateRevisionLedger({
    previousLedger,
    currentLedger,
    previousRecords: previousData.records,
    currentRecords,
    actualChanges: actual,
    request,
  })
  const correction = {
    ...request,
    ...auditIdentity,
    ...ledgerIdentity,
    candidate_records_sha256: candidateRecordsSha256(currentRecords),
    commit_sha: effectiveCommitSha,
    github_run_id: String(githubRunId),
    changed_record_count: changedKeys.size,
    changed_field_count: actual.length,
  }
  validateCorrectionDescriptor(correction, {
    datasetAsOf: latestMonth,
    sourceDatasetVersion: currentData.dataset_version,
  })
  return correction
}

export async function loadAndValidateHistoricalCorrection({ root, requestPath, candidateCommitSha, githubRunId }) {
  if (!/^[a-f0-9]{40}$/.test(candidateCommitSha || '') || !/^\d+$/.test(String(githubRunId || ''))) throw new Error('historical correction requires the exact candidate commit and GitHub run ID')
  const request = JSON.parse(await readFile(requestPath, 'utf8'))
  let currentCommitSha
  try {
    const [{ stdout }] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }),
      execFileAsync('git', ['merge-base', '--is-ancestor', request.baseline_commit_sha, 'HEAD'], { cwd: root, encoding: 'utf8' }),
    ])
    currentCommitSha = stdout.trim()
  } catch (_) {
    throw new Error('baseline commit is not an ancestor of the candidate commit')
  }
  if (currentCommitSha !== candidateCommitSha) throw new Error('correction candidate commit does not match the checked-out commit')
  const [previousDataResult, previousLedgerResult, currentText, auditText, currentLedgerText] = await Promise.all([
    execFileAsync('git', ['show', `${request.baseline_commit_sha}:${DATA_PATH}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    execFileAsync('git', ['show', `${request.baseline_commit_sha}:${REVISIONS_PATH}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    readFile(`${root}/${DATA_PATH}`, 'utf8'),
    readFile(`${root}/data/audit-report.json`, 'utf8'),
    readFile(`${root}/${REVISIONS_PATH}`, 'utf8'),
  ])
  const result = validateHistoricalCorrection({
    request,
    previousData: JSON.parse(previousDataResult.stdout),
    currentData: JSON.parse(currentText),
    auditReport: JSON.parse(auditText),
    previousLedger: JSON.parse(previousLedgerResult.stdout),
    currentLedger: JSON.parse(currentLedgerText),
    candidateCommitSha,
    githubRunId,
  })
  return result
}

export { BUSINESS_FIELDS }
