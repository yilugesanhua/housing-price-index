import assert from 'node:assert/strict'
import test from 'node:test'
import { validatePendingReleaseState } from './inspect-pending-release.mjs'
import { validateOfficialReleaseUrl } from './official-source-url.mjs'

const valid = 'https://www.stats.gov.cn/sj/zxfb/202607/t20260715_1964115.html'

test('official release URL accepts only the exact HTTPS release allowlist', () => {
  assert.equal(validateOfficialReleaseUrl(valid).hostname, 'www.stats.gov.cn')
  for (const value of [
    'http://www.stats.gov.cn/sj/zxfb/example.html',
    'https://stats.gov.cn/sj/zxfb/example.html',
    'https://www.stats.gov.cn/other/example.html',
    'https://www.stats.gov.cn/sj/zxfb/example.html;touch',
    'https://www.stats.gov.cn/sj/zxfb/example$(id).html',
    'https://www.stats.gov.cn/sj/zxfb/example.html\nMALICIOUS=true',
  ]) assert.throws(() => validateOfficialReleaseUrl(value))
})

test('pending release rejects unsafe output before a production job can consume it', () => {
  const pending = {
    format: 'housing-data-pending-auto-release-v1', status: 'ready', dataset_version: '2026-07-0123456789ab',
    source_dataset_version: '2026-07-abcdef012345', official_url: valid, source_raw_sha256: 'a'.repeat(64),
    discovery_run_id: '123', gate_report_sha256: 'b'.repeat(64),
  }
  assert.equal(validatePendingReleaseState(pending).ready, true)
  assert.throws(() => validatePendingReleaseState({ ...pending, official_url: `${valid};echo injected` }), /unsafe|allowlisted/)
  assert.throws(() => validatePendingReleaseState({ ...pending, discovery_run_id: '123\nready=true' }), /run ID/)
})
