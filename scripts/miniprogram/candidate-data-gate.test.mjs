import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCandidateData } from './candidate-data-gate.mjs'

const cities = Array.from({ length: 70 }, (_, index) => `city${index}`)
const scopes = (month, batch) => cities.flatMap((city_id) => ['new', 'resale'].flatMap((property_type) => ['all', 'le90', '90_144', 'gt144'].map((size_band) => ({ stat_month: month, city_id, property_type, size_band, value: 100, source_batch_id: batch }))))
const previous = { records: scopes('2026-06', 'old') }
const candidate = { records: [...structuredClone(previous.records), ...scopes('2026-07', 'new')] }
const sourceBatch = { source_batch_id: 'new', stat_month: '2026-07', verification_status: 'verified', http_status: 200, final_url: 'https://www.stats.gov.cn/sj/zxfb/202608/t1.html', raw_content_sha256: 'a'.repeat(64) }

test('accepts exactly one complete new month with zero historical changes', () => {
  const result = validateCandidateData({ previousPayload: previous, candidatePayload: candidate, expectedMonth: '2026-07', sourceBatch })
  assert.equal(result.added_record_count, 560)
  assert.equal(result.historical_revision_count, 0)
})

test('rejects a skipped month', () => {
  assert.throws(() => validateCandidateData({ previousPayload: previous, candidatePayload: candidate, expectedMonth: '2026-08', sourceBatch: { ...sourceBatch, stat_month: '2026-08' } }), /exactly next/)
})

test('rejects any historical mutation', () => {
  const changed = structuredClone(candidate)
  changed.records[0].value = 99
  assert.throws(() => validateCandidateData({ previousPayload: previous, candidatePayload: changed, expectedMonth: '2026-07', sourceBatch }), /historical record changed/)
})

test('rejects missing, duplicate, or mixed-source records', () => {
  const missing = { records: candidate.records.slice(0, -1) }
  assert.throws(() => validateCandidateData({ previousPayload: previous, candidatePayload: missing, expectedMonth: '2026-07', sourceBatch }), /increase by 560/)
  const duplicate = structuredClone(candidate)
  duplicate.records.push(structuredClone(duplicate.records.at(-1)))
  assert.throws(() => validateCandidateData({ previousPayload: previous, candidatePayload: duplicate, expectedMonth: '2026-07', sourceBatch }), /duplicate record/)
  const mixed = structuredClone(candidate)
  mixed.records.at(-1).source_batch_id = 'other'
  assert.throws(() => validateCandidateData({ previousPayload: previous, candidatePayload: mixed, expectedMonth: '2026-07', sourceBatch }), /mixes source batches/)
})
