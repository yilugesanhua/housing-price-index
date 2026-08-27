import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { validatePendingReleaseState } from './inspect-pending-release.mjs'
import { validateOfficialReleaseUrl } from './official-source-url.mjs'

const valid = 'https://www.stats.gov.cn/sj/zxfb/202607/t20260715_1964115.html'
const idempotencyKey = 'e'.repeat(64)

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
  const releaseKey = `2026-07-${'a'.repeat(64)}`
  const candidateCommitSha = 'c'.repeat(40)
  const candidateManifestSha256 = 'd'.repeat(64)
  const candidateId = createHash('sha256').update(`${releaseKey}\n${candidateCommitSha}\n${candidateManifestSha256}`).digest('hex')
  const pending = {
    format: 'housing-data-pending-auto-release-v1', status: 'ready', dataset_version: '2026-07-0123456789ab',
    source_dataset_version: '2026-07-abcdef012345', official_url: valid, source_raw_sha256: 'a'.repeat(64),
    dataset_as_of: '2026-07', release_key: releaseKey, producer_commit_sha: candidateCommitSha, candidate_commit_sha: candidateCommitSha,
    candidate_manifest_sha256: candidateManifestSha256, candidate_id: candidateId, state_version: 'housing-data-auto-update-state-v1',
    discovery_run_id: '123', candidate_run_id: '456', gate_report_sha256: 'b'.repeat(64), cloud_env_id: 'cloud1-d3gpdx70w5d05c68c', cloud_slot_id: '2026-08-26T01:15:00.000Z', cloud_observation_id: 'f'.repeat(64), cloud_observation_payload_sha256: '0'.repeat(64), cloud_timing_status: 'on_time', idempotency_key: idempotencyKey, cloud_handoff_identity: `housing-data-discovery-v1:${idempotencyKey}`,
  }
  assert.equal(validatePendingReleaseState(pending).ready, true)
  assert.throws(() => validatePendingReleaseState({ ...pending, official_url: `${valid};echo injected` }), /unsafe|allowlisted/)
  assert.throws(() => validatePendingReleaseState({ ...pending, discovery_run_id: '123\nready=true' }), /run ID/)
  assert.throws(() => validatePendingReleaseState({ ...pending, candidate_run_id: '456\nrun=true' }), /run ID/)
})
