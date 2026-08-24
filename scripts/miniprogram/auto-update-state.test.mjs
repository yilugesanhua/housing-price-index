import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCandidateId, buildReleaseKey, transitionState } from './auto-update-state.mjs'

test('release identity excludes schedules and retry metadata', () => {
  const key = buildReleaseKey('2026-07', 'a'.repeat(64))
  assert.equal(key, `2026-07-${'a'.repeat(64)}`)
  const first = buildCandidateId({ releaseKey: key, commitSha: 'b'.repeat(40), candidateManifestSha256: 'c'.repeat(64) })
  const second = buildCandidateId({ releaseKey: key, commitSha: 'b'.repeat(40), candidateManifestSha256: 'c'.repeat(64) })
  assert.equal(first, second)
})

test('state machine rejects skipping the publishing phase', () => {
  const releaseKey = buildReleaseKey('2026-07', 'a'.repeat(64))
  const state = { status: 'preparing', format: 'housing-data-auto-update-state-v1', dataset_as_of: '2026-07', source_raw_sha256: 'a'.repeat(64), release_key: releaseKey, updated_at: '2026-08-20T00:00:00.000Z' }
  const ready = transitionState(state, 'ready', {
    producer_commit_sha: 'b'.repeat(40),
    candidate_commit_sha: 'b'.repeat(40),
    candidate_manifest_sha256: 'c'.repeat(64),
    candidate_id: buildCandidateId({ releaseKey, commitSha: 'b'.repeat(40), candidateManifestSha256: 'c'.repeat(64) }),
  })
  assert.equal(ready.status, 'ready')
  assert.throws(() => transitionState(state, 'published'), /invalid auto-update transition/)
})

test('candidate identity is bound to the release key, producer commit, and manifest', () => {
  const releaseKey = buildReleaseKey('2026-07', 'a'.repeat(64))
  const candidate = buildCandidateId({ releaseKey, commitSha: 'b'.repeat(40), candidateManifestSha256: 'c'.repeat(64) })
  assert.notEqual(candidate, buildCandidateId({ releaseKey, commitSha: 'd'.repeat(40), candidateManifestSha256: 'c'.repeat(64) }))
})
