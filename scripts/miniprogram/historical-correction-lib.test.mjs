import assert from 'node:assert/strict'
import test from 'node:test'
import { auditReportSha256, auditedRecordsSha256 } from './publication-identity.mjs'
import { actualBusinessChanges, validateHistoricalCorrection } from './historical-correction-lib.mjs'

const beforeRecord = {
  stat_month: '2026-06', city_id: 'fuzhou', property_type: 'new', size_band: 'all',
  release_date: '2026-07-15', city_name: '福州', mom_index: 99.8, yoy_index: 95,
  ytd_avg_index: null, ytd_period_start: null, ytd_period_end: null, ytd_comparison_base: null,
  mom_change: -0.2, yoy_change: -5, mom_missing_reason: null, yoy_missing_reason: null,
  ytd_missing_reason: 'not-published-for-this-table', source_url: 'https://www.stats.gov.cn/source',
  source_type: 'official-html', source_batch_id: 'official-html-2026-06-aaaaaaaaaaaa',
  source_record_locator: 'table[0] row[1]', methodology_version: 'nbs', parser_version: 'parser-v1',
  fetched_at: '2026-07-15T00:00:00Z',
}
const afterRecord = {
  ...beforeRecord,
  mom_index: 99.9,
  mom_change: -0.1,
  source_batch_id: 'official-html-2026-06-bbbbbbbbbbbb',
  fetched_at: '2026-07-16T00:00:00Z',
}

function fixture() {
  const changes = actualBusinessChanges({ records: [beforeRecord] }, { records: [afterRecord] }).map((item) => ({
    ...item,
    source_url: afterRecord.source_url,
    source_record_locator: afterRecord.source_record_locator,
  }))
  const request = {
    revision_id: 'revision-2026-06-fuzhou-fix', release_type: 'historical_correction', reason_type: 'official_revision', approval_status: 'approved',
    baseline_commit_sha: 'a'.repeat(40), dataset_as_of: '2026-06',
    supersedes_source_dataset_version: '2026-06-111111111111', source_dataset_version: '2026-06-222222222222',
    source_version_chain: ['2026-06-111111111111', '2026-06-222222222222'],
    revoked_source_dataset_versions: ['2026-06-111111111111'], reason: '国家统计局原始表复核后修正历史字段',
    official_urls: [afterRecord.source_url],
    latest_source_batch_ids: [afterRecord.source_batch_id],
    revision_source_batch_ids: [afterRecord.source_batch_id],
    parser_version: 'parser-v1', audit_version: 'full-record-audit-v7', approved_at: '2026-07-20T00:00:00Z',
    approved_by: 'data-owner', changes,
  }
  const currentData = { dataset_version: request.source_dataset_version, records: [afterRecord] }
  const auditReport = {
    result: 'passed', audit_version: request.audit_version, record_count: 1,
    records_sha256: auditedRecordsSha256(currentData.records), source_index_sha256: 'c'.repeat(64),
    audit_code_sha256: 'e'.repeat(64),
    repository_commit_sha: 'b'.repeat(40), parser_versions: ['parser-v1'],
    coverage_start: '2026-06', coverage_end: '2026-06',
    batches: [{ source_batch_id: afterRecord.source_batch_id }],
  }
  auditReport.report_sha256 = auditReportSha256(auditReport)
  const ledgerEntry = {
    revision_id: 'ledger-2026-06-fuzhou-fix', release_type: request.release_type, reason_type: request.reason_type,
    record_key: '2026-06|fuzhou|new|all', previous_value: beforeRecord, revised_value: afterRecord,
    detected_at: '2026-07-20T00:00:00Z', source_batch_id: afterRecord.source_batch_id,
    reason: request.reason, supersedes_revision_id: null,
  }
  return {
    request,
    previousData: { dataset_version: request.supersedes_source_dataset_version, records: [beforeRecord] },
    currentData,
    auditReport,
    previousLedger: [],
    currentLedger: [ledgerEntry],
    candidateCommitSha: 'b'.repeat(40),
    githubRunId: '12345',
  }
}

test('audited correction binds complete records, source evidence, and an append-only revision ledger', () => {
  const result = validateHistoricalCorrection(fixture())
  assert.equal(result.changed_record_count, 1)
  assert.equal(result.changed_field_count, 3)
  assert.equal(result.changes.some((item) => item.field === 'fetched_at'), false)
  assert.match(result.candidate_records_sha256, /^[a-f0-9]{64}$/)
  assert.equal(result.ledger_append_count, 1)
  assert.equal(result.github_run_id, '12345')
})

test('audited correction rejects extra or missing approved changes', () => {
  const input = fixture()
  input.request.changes.pop()
  assert.throws(() => validateHistoricalCorrection(input), /do not exactly match/)
})

test('audited correction rejects mismatched audit identity and source-batch sets', () => {
  const wrongAudit = fixture()
  wrongAudit.auditReport.records_sha256 = 'f'.repeat(64)
  assert.throws(() => validateHistoricalCorrection(wrongAudit), /audit records hash/)
  const tamperedReport = fixture()
  tamperedReport.auditReport.source_index_sha256 = 'f'.repeat(64)
  assert.throws(() => validateHistoricalCorrection(tamperedReport), /audit report hash does not match content/)
  const wrongSources = fixture()
  wrongSources.request.revision_source_batch_ids = ['official-html-2026-06-cccccccccccc']
  assert.throws(() => validateHistoricalCorrection(wrongSources), /revision source batches do not exactly match/)
})

test('audited correction rejects old-ledger rewrites and discontinuous supersession', () => {
  const rewritten = fixture()
  rewritten.previousLedger = [{ revision_id: 'old', record_key: '2026-06|fuzhou|new|all' }]
  rewritten.currentLedger = [{ revision_id: 'rewritten', record_key: '2026-06|fuzhou|new|all' }, ...rewritten.currentLedger]
  assert.throws(() => validateHistoricalCorrection(rewritten), /rewrites or reorders/)
  const discontinuous = fixture()
  discontinuous.previousLedger = [{ revision_id: 'old', record_key: '2026-06|fuzhou|new|all' }]
  discontinuous.currentLedger = [...discontinuous.previousLedger, { ...discontinuous.currentLedger[0], supersedes_revision_id: null }]
  assert.throws(() => validateHistoricalCorrection(discontinuous), /supersedes chain/)
})

test('audited correction rejects extra ledger entries and the legacy revision_type field', () => {
  const extra = fixture()
  extra.currentLedger.push({ ...extra.currentLedger[0], revision_id: 'ledger-extra', record_key: '2026-06|beijing|new|all' })
  assert.throws(() => validateHistoricalCorrection(extra), /append set does not exactly match/)
  const legacyField = fixture()
  legacyField.request.revision_type = 'official_revision'
  assert.throws(() => validateHistoricalCorrection(legacyField), /legacy revision_type is forbidden/)
})

test('audited correction includes business-field changes but ignores fetch metadata', () => {
  const changed = { ...beforeRecord, methodology_version: 'nbs-v2', fetched_at: '2026-08-01T00:00:00Z' }
  const changes = actualBusinessChanges({ records: [beforeRecord] }, { records: [changed] })
  assert.deepEqual(changes.map((item) => item.field), ['methodology_version'])
})

test('audited correction requires exact latest and revision source-batch sets', () => {
  const latestMismatch = fixture()
  latestMismatch.request.latest_source_batch_ids = ['official-html-2026-06-cccccccccccc']
  assert.throws(() => validateHistoricalCorrection(latestMismatch), /latest source batches do not exactly match/)
  const revisionMismatch = fixture()
  revisionMismatch.request.revision_source_batch_ids = ['official-html-2026-06-cccccccccccc']
  assert.throws(() => validateHistoricalCorrection(revisionMismatch), /revision source batches do not exactly match/)
})

test('audited correction rejects additions or deletions', () => {
  assert.throws(() => actualBusinessChanges({ records: [beforeRecord] }, { records: [] }), /cannot add or delete/)
})
