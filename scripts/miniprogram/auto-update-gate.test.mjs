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
  idempotency_key: sha256(`2026-07\n${report.latest_official_url}\n${calendarText}`),
}

test('accepts an untampered discovery handoff confirmed by a fresh official check', () => {
  const result = validateDiscoveryGate({ handoff, discoveryReportText: reportText, freshReport: report, freshCalendar: calendar, trigger })
  assert.equal(result.status, 'passed')
  assert.equal(result.expected_stat_month, '2026-07')
})

for (const [label, mutate, pattern] of [
  ['artifact report', (input) => { input.discoveryReportText += ' ' }, /report hash/],
  ['branch', (input) => { input.trigger.head_branch = 'feature' }, /default branch/],
  ['commit', (input) => { input.trigger.head_sha = 'c'.repeat(40) }, /commit SHA mismatch/],
  ['month', (input) => { input.handoff.expected_stat_month = '2026-08' }, /exactly next/],
  ['official host', (input) => { input.handoff.official_url = 'https://evil.example/release.html' }, /official release URL/],
  ['calendar', (input) => { input.freshCalendar.raw_content_sha256 = 'd'.repeat(64) }, /calendar changed/],
  ['fresh check', (input) => { input.freshReport.status = 'current' }, /fresh official check/],
]) {
  test(`rejects a mismatched ${label}`, () => {
    const input = structuredClone({ handoff, discoveryReportText: reportText, freshReport: report, freshCalendar: calendar, trigger })
    mutate(input)
    assert.throws(() => validateDiscoveryGate(input), pattern)
  })
}
