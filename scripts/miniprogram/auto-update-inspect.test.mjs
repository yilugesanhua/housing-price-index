import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCandidateId, buildReleaseKey } from './auto-update-state.mjs'
import { isSameReleaseHandled } from './auto-update-inspect.mjs'

const releaseKey = buildReleaseKey('2026-07', 'a'.repeat(64))
const candidateCommit = 'b'.repeat(40)
const candidateManifest = 'c'.repeat(64)
const candidateId = buildCandidateId({ releaseKey, commitSha: candidateCommit, candidateManifestSha256: candidateManifest })
const idempotencyKey = 'd'.repeat(64)
const handoff = { expected_stat_month: '2026-07', official_url: 'https://www.stats.gov.cn/sj/zxfb/202608/t20260817_1.html' }
const state = { status: 'ready', dataset_as_of: '2026-07', official_url: handoff.official_url, release_key: releaseKey, candidate_id: candidateId, producer_commit_sha: candidateCommit, candidate_commit_sha: candidateCommit, candidate_manifest_sha256: candidateManifest }
const pending = {
  format: 'housing-data-pending-auto-release-v1', status: 'ready', dataset_version: '2026-07-0123456789ab', source_dataset_version: '2026-06-0123456789ab', dataset_as_of: '2026-07', official_url: handoff.official_url, source_raw_sha256: 'a'.repeat(64), release_key: releaseKey, producer_commit_sha: candidateCommit, candidate_commit_sha: candidateCommit, candidate_manifest_sha256: candidateManifest, candidate_id: candidateId, state_version: 'housing-data-auto-update-state-v1', discovery_run_id: '123', candidate_run_id: '456', gate_report_sha256: 'd'.repeat(64), cloud_env_id: 'cloud1-d3gpdx70w5d05c68c', cloud_slot_id: '2026-08-26T01:15:00.000Z', cloud_observation_id: 'e'.repeat(64), cloud_observation_payload_sha256: 'f'.repeat(64), cloud_timing_status: 'on_time', idempotency_key: idempotencyKey, cloud_handoff_identity: `housing-data-discovery-v1:${idempotencyKey}`
}

test('ready release is handled only with matching pending evidence', () => {
  assert.equal(isSameReleaseHandled({ state, pending, handoff }), true)
  assert.equal(isSameReleaseHandled({ state, pending: null, handoff }), false)
  assert.equal(isSameReleaseHandled({ state, pending: { ...pending, candidate_id: 'e'.repeat(64) }, handoff }), false)
})

test('publishing release remains handled without pending file', () => {
  assert.equal(isSameReleaseHandled({ state: { ...state, status: 'publishing' }, pending, handoff }), true)
  assert.equal(isSameReleaseHandled({ state: { ...state, status: 'published' }, pending: null, handoff }), true)
})

test('different month or official URL is not treated as handled', () => {
  assert.equal(isSameReleaseHandled({ state, pending, handoff: { ...handoff, expected_stat_month: '2026-08' } }), false)
  assert.equal(isSameReleaseHandled({ state, pending, handoff: { ...handoff, official_url: 'https://www.stats.gov.cn/other.html' } }), false)
})

test('five repeated discoveries resolve to the same durable candidate', () => {
  const results = Array.from({ length: 5 }, () => isSameReleaseHandled({ state, pending, handoff }))
  assert.deepEqual(results, [true, true, true, true, true])
  assert.equal(new Set([state.release_key]).size, 1)
  assert.equal(new Set([state.candidate_id]).size, 1)
})
