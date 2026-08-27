import assert from 'node:assert/strict'
import test from 'node:test'
import { sha256 } from './remote-data-lib.mjs'
import { validateDiscoveryGate } from './auto-update-gate.mjs'

const calendar = {
  year: 2026,
  source_url: 'https://www.stats.gov.cn/sj/fbrc/index_fbrc.html',
  source_urls: ['https://www.stats.gov.cn/sj/fbrc/index_fbrc.html', 'https://www.stats.gov.cn/sj/fbrc/bnxxfb/'],
  raw_content_sha256: 'a'.repeat(64),
  entries: [{ expected_stat_month: '2026-07', scheduled_at: '2026-08-17T09:30:00+08:00' }],
}
const report = {
  status: 'update_available',
  slot_id: '2026-08-17T01:35:00.000Z',
  dataset_as_of: '2026-06',
  expected_stat_month: '2026-07',
  latest_official_month: '2026-07',
  latest_official_url: 'https://www.stats.gov.cn/sj/zxfb/202608/t20260817_1.html',
  scheduled_release_at: '2026-08-17T09:30:00+08:00',
  official_release_detected: true,
  checked_at: '2026-08-17T01:40:00.000Z',
}
const reportText = `${JSON.stringify(report, null, 2)}\n`
const calendarText = JSON.stringify({ year: calendar.year, source_urls: calendar.source_urls, raw_content_sha256: calendar.raw_content_sha256, entries: calendar.entries })
const trigger = { workflow_name: 'monthly-data-check', conclusion: 'success', event: 'schedule', head_branch: 'main', default_branch: 'main', head_sha: 'b'.repeat(40), run_id: '123' }
const handoff = {
  format: 'housing-data-discovery-handoff-v1',
  status: 'update_available',
  dataset_as_of: '2026-06',
  expected_stat_month: '2026-07',
  official_url: report.latest_official_url,
  scheduled_release_at: report.scheduled_release_at,
  calendar_raw_content_sha256: calendar.raw_content_sha256,
  calendar_sha256: sha256(calendarText),
  report_sha256: sha256(reportText),
  repository_commit_sha: trigger.head_sha,
  discovery_run_id: trigger.run_id,
  slot_id: report.slot_id,
  idempotency_key: sha256(`2026-07\n${report.latest_official_url}`),
  handoff_identity: `housing-data-discovery-v1:${sha256(`2026-07\n${report.latest_official_url}`)}`,
  release_identity_version: 'month-and-official-url-v1',
}
const cloudObservationPayload = {
  format: 'housing-data-discovery-observation-v1',
  observation_id: 'c'.repeat(64),
  slot_id: report.slot_id,
  task: 'discovery',
  planned_at: report.slot_id,
  actual_started_at: '2026-08-17T01:35:10.000Z',
  completed_at: '2026-08-17T01:35:20.000Z',
  timing_status: 'on_time',
  status: 'update_available',
  result: {
    status: 'update_available',
    dataset_as_of: '2026-06',
    expected_stat_month: '2026-07',
    latest_official_month: '2026-07',
    latest_official_url: report.latest_official_url,
  },
  pointer: { dataset_as_of: '2026-06', pointer_sha256: 'd'.repeat(64) },
  calendar: { year: 2026, source_urls: calendar.source_urls, raw_content_sha256: calendar.raw_content_sha256, calendar_sha256: sha256(calendarText), source_responses: [] },
  discovery_responses: [],
  idempotency_key: handoff.idempotency_key,
  handoff_identity: handoff.handoff_identity,
}
const cloudObservation = { ...cloudObservationPayload, payload_sha256: sha256(JSON.stringify(cloudObservationPayload)) }

test('accepts an untampered discovery handoff confirmed by CloudBase and a fresh official check', () => {
  const result = validateDiscoveryGate({ handoff, discoveryReportText: reportText, discoveryCalendar: calendar, freshReport: report, freshCalendar: calendar, trigger, cloudObservation })
  assert.equal(result.status, 'passed')
  assert.equal(result.expected_stat_month, '2026-07')
})

test('accepts a changed official release schedule when the official month and page remain confirmed', () => {
  const freshCalendar = structuredClone(calendar)
  freshCalendar.raw_content_sha256 = 'c'.repeat(64)
  freshCalendar.entries[0].scheduled_at = '2026-08-17T15:00:00+08:00'
  const freshReport = { ...report, scheduled_release_at: freshCalendar.entries[0].scheduled_at }
  const result = validateDiscoveryGate({ handoff, discoveryReportText: reportText, discoveryCalendar: calendar, freshReport, freshCalendar, trigger, cloudObservation })
  assert.equal(result.calendar_changed_after_discovery, true)
  assert.equal(result.fresh_scheduled_release_at, '2026-08-17T15:00:00+08:00')
  assert.equal(result.idempotency_key, handoff.idempotency_key)
})

for (const [label, mutate, pattern] of [
  ['artifact report', (input) => { input.discoveryReportText += ' ' }, /report hash/],
  ['branch', (input) => { input.trigger.head_branch = 'feature' }, /default branch/],
  ['commit', (input) => { input.trigger.head_sha = 'c'.repeat(40) }, /commit SHA mismatch/],
  ['month', (input) => { input.handoff.expected_stat_month = '2026-08' }, /exactly next/],
  ['official host', (input) => { input.handoff.official_url = 'https://evil.example/release.html' }, /official release URL/],
  ['discovery calendar', (input) => { input.discoveryCalendar.raw_content_sha256 = 'd'.repeat(64) }, /discovery release calendar hash/],
  ['fresh schedule', (input) => { input.freshCalendar.entries[0].scheduled_at = '2026-08-17T15:00:00+08:00' }, /freshly verified release schedule/],
  ['fresh check', (input) => { input.freshReport.status = 'current' }, /fresh official check/],
]) {
  test(`rejects a mismatched ${label}`, () => {
    const input = {
      handoff: structuredClone(handoff),
      discoveryReportText: reportText,
      discoveryCalendar: structuredClone(calendar),
      freshReport: structuredClone(report),
      freshCalendar: structuredClone(calendar),
      trigger: structuredClone(trigger),
      cloudObservation: structuredClone(cloudObservation),
    }
    mutate(input)
    assert.throws(() => validateDiscoveryGate(input), pattern)
  })
}

test('rejects an available update when the CloudBase observation is late or missing', () => {
  const latePayload = { ...cloudObservation, timing_status: 'late' }
  delete latePayload.payload_sha256
  const lateObservation = { ...latePayload, payload_sha256: sha256(JSON.stringify(latePayload)) }
  assert.throws(() => validateDiscoveryGate({
    handoff,
    discoveryReportText: reportText,
    discoveryCalendar: calendar,
    freshReport: report,
    freshCalendar: calendar,
    trigger,
    cloudObservation: lateObservation,
  }), /CloudBase observation was late/)
  assert.throws(() => validateDiscoveryGate({
    handoff,
    discoveryReportText: reportText,
    discoveryCalendar: calendar,
    freshReport: report,
    freshCalendar: calendar,
    trigger,
  }), /CloudBase observation is missing|observation format is invalid/)
})
