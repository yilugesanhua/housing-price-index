import assert from 'node:assert/strict'
import test from 'node:test'
import { auditReportSha256, auditedRecordsSha256, sourceIndexSha256, validateAuditSourceIndex } from './publication-identity.mjs'

function batch(id = 'official-html-2026-06-aaaaaaaaaaaa') {
  const record = { stat_month: '2026-06', city_id: 'fuzhou', property_type: 'new', size_band: 'all', value: 100 }
  return {
    source_batch: {
      source_batch_id: id,
      source_url: 'https://www.stats.gov.cn/sj/zxfb/202607/example.html',
      final_url: 'https://www.stats.gov.cn/sj/zxfb/202607/example.html',
      stat_month: '2026-06',
      release_date: '2026-07-15',
      raw_content_sha256: 'a'.repeat(64),
      parser_version: 'parser-v1',
      schema_version: '1.3.0',
      audited_records_sha256: auditedRecordsSha256([record]),
    },
    records: [record],
  }
}

function reportFor(source) {
  const report = {
    result: 'passed',
    batch_count: 1,
    source_index_sha256: sourceIndexSha256([source]),
    batches: [{
      source_batch_id: source.source_batch.source_batch_id,
      stat_month: source.source_batch.stat_month,
      raw_content_sha256: source.source_batch.raw_content_sha256,
      records_sha256: source.source_batch.audited_records_sha256,
      records_checked: source.records.length,
      result: 'passed',
    }],
  }
  return { ...report, report_sha256: auditReportSha256(report) }
}

test('source index identity is deterministic and checks every batch evidence field', () => {
  const first = batch()
  const second = batch('official-html-2026-07-bbbbbbbbbbbb')
  second.source_batch.stat_month = '2026-07'
  const report = reportFor(first)
  assert.equal(validateAuditSourceIndex({ auditReport: report, batches: [first] }), true)
  assert.equal(sourceIndexSha256([first, second]), sourceIndexSha256([second, first]))
})

test('source index gate rejects a forged hash or per-batch evidence', () => {
  const source = batch()
  const report = reportFor(source)
  const forgedHash = { ...report, source_index_sha256: 'f'.repeat(64) }
  assert.throws(() => validateAuditSourceIndex({ auditReport: forgedHash, batches: [source] }), /source index hash/)
  const forgedEvidence = structuredClone(report)
  forgedEvidence.batches[0].raw_content_sha256 = 'b'.repeat(64)
  assert.throws(() => validateAuditSourceIndex({ auditReport: forgedEvidence, batches: [source] }), /source evidence differs/)
  const forgedRecords = structuredClone(report)
  forgedRecords.batches[0].records_sha256 = 'c'.repeat(64)
  assert.throws(() => validateAuditSourceIndex({ auditReport: forgedRecords, batches: [source] }), /record evidence differs/)
})

