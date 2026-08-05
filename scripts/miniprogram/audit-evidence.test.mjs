import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  auditCodeSha256,
  auditReportSha256,
  FULL_RECORD_AUDIT_METHOD,
  FULL_RECORD_AUDIT_VERSION,
  repositoryCommitSha,
  validateAuditEvidence,
} from './audit-evidence.mjs'

const root = resolve(import.meta.dirname, '../..')
const parserVersion = 'official-html-v9-product-housing-only-strict-release-date'

function monthRange() {
  const months = []
  const date = new Date('2011-07-01T00:00:00Z')
  while (months.length < 180) {
    months.push(date.toISOString().slice(0, 7))
    date.setUTCMonth(date.getUTCMonth() + 1)
  }
  return months
}

async function fixture() {
  const batches = monthRange().map((month, index) => ({
    source_batch_id: `official-html-${month}-${index.toString(16).padStart(12, '0')}`,
    stat_month: month,
    raw_content_sha256: 'a'.repeat(64),
    records_sha256: 'b'.repeat(64),
    records_checked: 560,
    result: 'passed',
  }))
  const report = {
    schema_version: 2,
    audit_version: FULL_RECORD_AUDIT_VERSION,
    verified_at: '2026-08-05T00:00:00.000Z',
    verification_method: FULL_RECORD_AUDIT_METHOD,
    repository_commit_sha: repositoryCommitSha(root),
    audit_code_sha256: await auditCodeSha256(root),
    parser_versions: [parserVersion],
    batch_count: 180,
    record_count: 100800,
    records_sha256: 'c'.repeat(64),
    source_index_sha256: 'd'.repeat(64),
    coverage_start: '2011-07',
    coverage_end: '2026-06',
    checks: [],
    result: 'passed',
    batches,
  }
  return { ...report, report_sha256: auditReportSha256(report) }
}

test('complete-package audit evidence binds code, commit, parser, report, and every month', async () => {
  const report = await fixture()
  const identity = await validateAuditEvidence(report, {
    root,
    expectedParserVersion: parserVersion,
    expectedCoverageEnd: '2026-06',
  })
  assert.equal(identity.reportSha256, report.report_sha256)
  assert.equal(identity.recordsSha256, report.records_sha256)
})

test('complete-package audit evidence rejects report, code, commit, and month tampering', async () => {
  const report = await fixture()
  await assert.rejects(validateAuditEvidence({ ...report, report_sha256: 'e'.repeat(64) }, { root, expectedCoverageEnd: '2026-06' }), /report SHA-256/)

  const wrongCode = { ...report, audit_code_sha256: 'f'.repeat(64) }
  wrongCode.report_sha256 = auditReportSha256(wrongCode)
  await assert.rejects(validateAuditEvidence(wrongCode, { root, expectedCoverageEnd: '2026-06' }), /audit code SHA-256/)

  await assert.rejects(validateAuditEvidence(report, { root, expectedCommitSha: '1'.repeat(40), expectedCoverageEnd: '2026-06' }), /repository commit/)

  const missingMonth = structuredClone(report)
  missingMonth.batches[1].stat_month = missingMonth.batches[0].stat_month
  missingMonth.batches[1].source_batch_id = `official-html-${missingMonth.batches[0].stat_month}-ffffffffffff`
  missingMonth.report_sha256 = auditReportSha256(missingMonth)
  await assert.rejects(validateAuditEvidence(missingMonth, { root, expectedCoverageEnd: '2026-06' }), /batch months/)
})
