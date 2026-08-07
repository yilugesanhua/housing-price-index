import assert from 'node:assert/strict'
import test from 'node:test'
import { runHistoricalCorrectionReplay } from './replay-historical-corrections.mjs'

function record(month, city, value) {
  return {
    stat_month: month,
    release_date: '2026-07-15',
    city_id: city,
    city_name: city,
    property_type: 'new',
    size_band: 'all',
    mom_index: value,
    yoy_index: value,
    ytd_avg_index: null,
    ytd_period_start: null,
    ytd_period_end: null,
    ytd_comparison_base: null,
    mom_change: 0,
    yoy_change: 0,
    mom_missing_reason: null,
    yoy_missing_reason: null,
    ytd_missing_reason: 'not-published-for-this-table',
    source_url: 'https://www.stats.gov.cn/test.html',
    source_type: 'official-html',
    source_batch_id: `official-html-${month}-abcdefabcdef`,
    source_record_locator: `table[0] row[${city}]`,
    fetched_at: '2026-08-06T00:00:00.000Z',
    methodology_version: 'test',
    parser_version: 'parser-v1',
  }
}

test('historical correction replay completes 12 sequential accepted and fail-closed cases', async () => {
  const records = []
  for (let index = 0; index < 360; index += 1) {
    const city = `city${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + index % 26)}`
    records.push(record(`2026-${String(index % 12 + 1).padStart(2, '0')}`, city, 100))
  }
  const observedRounds = []
  const report = await runHistoricalCorrectionReplay({
    records,
    auditVersion: 'full-record-audit-v7',
    commitSha: 'a'.repeat(40),
    rounds: 12,
    onRound: async (round) => {
      observedRounds.push(round)
      return { isolated_cloud_round_trip_verified: true }
    },
  })
  assert.equal(report.status, 'passed')
  assert.equal(report.replay_count, 12)
  assert.equal(report.production_pointer_untouched, true)
  assert(report.replays.every((item) => item.failure_case_count === 10
    && item.pointer.pre_switch_interruption_rollback_verified
    && item.pointer.post_switch_failure_rollback_verified
    && item.pointer.unsafe_rollback_rejected))
  assert(report.replays.some((item) => item.changed_record_count >= 150))
  assert.equal(observedRounds.length, 12)
  assert(observedRounds.every((item) => item.request.approval_status === 'approved'
    && item.candidate_dataset_version !== item.previous_dataset_version))
  assert.equal(new Set(observedRounds.map((item) => item.registry.generation)).size, 12)
  assert(report.replays.every((item) => item.cloud_evidence?.isolated_cloud_round_trip_verified === true))
})
