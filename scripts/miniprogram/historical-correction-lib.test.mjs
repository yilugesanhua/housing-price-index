import assert from 'node:assert/strict'
import test from 'node:test'
import { actualBusinessChanges, validateHistoricalCorrection } from './historical-correction-lib.mjs'

const beforeRecord = {
  stat_month: '2026-06', city_id: 'fuzhou', property_type: 'new', size_band: 'all',
  release_date: '2026-07-15', city_name: '福州', mom_index: 99.8, yoy_index: 95,
  ytd_avg_index: null, ytd_period_start: null, ytd_period_end: null, ytd_comparison_base: null,
  mom_change: -0.2, yoy_change: -5, mom_missing_reason: null, yoy_missing_reason: null,
  ytd_missing_reason: 'not-published-for-this-table', source_url: 'https://www.stats.gov.cn/source',
  source_type: 'official-html', source_batch_id: 'official-html-2026-06-old',
  source_record_locator: 'table[0] row[1]', methodology_version: 'nbs', parser_version: 'parser-v1',
  fetched_at: '2026-07-15T00:00:00Z',
}
const afterRecord = { ...beforeRecord, mom_index: 99.9, mom_change: -0.1, source_batch_id: 'official-html-2026-06-new', fetched_at: '2026-07-16T00:00:00Z' }

function fixture() {
  const changes = actualBusinessChanges({ records: [beforeRecord] }, { records: [afterRecord] }).map((item) => ({
    ...item,
    source_url: afterRecord.source_url,
    source_record_locator: afterRecord.source_record_locator,
  }))
  const request = {
    revision_id: 'revision-2026-06-fuzhou-fix', revision_type: 'historical_data_correction', approval_status: 'approved',
    baseline_commit_sha: 'a'.repeat(40), dataset_as_of: '2026-06',
    supersedes_source_dataset_version: '2026-06-111111111111', source_dataset_version: '2026-06-222222222222',
    source_version_chain: ['2026-06-111111111111', '2026-06-222222222222'],
    revoked_source_dataset_versions: ['2026-06-111111111111'], reason: '国家统计局原始表复核后修正历史字段',
    official_urls: [afterRecord.source_url], source_batch_ids: [afterRecord.source_batch_id],
    parser_version: 'parser-v1', audit_version: 'full-record-audit-v4', approved_at: '2026-07-20T00:00:00Z',
    approved_by: 'data-owner', changes,
  }
  return {
    request,
    previousData: { dataset_version: request.supersedes_source_dataset_version, records: [beforeRecord] },
    currentData: { dataset_version: request.source_dataset_version, records: [afterRecord] },
    auditReport: { result: 'passed', audit_version: request.audit_version, record_count: 1 },
  }
}

test('audited correction accepts only an exact field-level diff and ignores fetched_at churn', () => {
  const input = fixture()
  const result = validateHistoricalCorrection(input)
  assert.equal(result.changed_record_count, 1)
  assert.equal(result.changed_field_count, 3)
  assert.equal(result.changes.some((item) => item.field === 'fetched_at'), false)
})

test('audited correction rejects extra or missing approved changes', () => {
  const input = fixture()
  input.request.changes.pop()
  assert.throws(() => validateHistoricalCorrection(input), /do not exactly match/)
})

test('audited correction rejects wrong old/new values and incomplete audit coverage', () => {
  const wrong = fixture()
  wrong.request.changes[0].new_value = 123
  assert.throws(() => validateHistoricalCorrection(wrong), /do not exactly match/)
  const incomplete = fixture()
  incomplete.auditReport.record_count = 0
  assert.throws(() => validateHistoricalCorrection(incomplete), /does not cover every/)
})

test('audited correction rejects additions or deletions', () => {
  assert.throws(() => actualBusinessChanges({ records: [beforeRecord] }, { records: [] }), /cannot add or delete/)
})
