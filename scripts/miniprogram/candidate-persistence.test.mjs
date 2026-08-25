import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDurableReadyState, validateCandidatePaths, validateCandidateRunId } from './candidate-persistence.mjs'
import { buildCandidateId, buildReleaseKey, validateStateIdentity } from './auto-update-state.mjs'

const valid = [
  'data/raw/2026-07/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.batch.json',
  'data/raw/2026-07/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html.gz',
  'data/releases/pending-auto-release.json',
  'data/releases/auto-update-state.json',
]

test('allows only raw source evidence and a pending state', () => {
  assert.deepEqual(validateCandidatePaths(valid, '2026-07'), [...valid].sort())
})

for (const path of ['scripts/data/publish.ts', '.github/workflows/ci.yml', 'apps/miniprogram/pages/home/index.js', 'package-lock.json', 'data/raw/2026-07/source.html', 'docs/screenshots/desktop-1440x900.png', 'data/audit-report.json', 'data/normalized/records.json', 'apps/web/public/data/manifest.json', 'apps/miniprogram/data/snapshot.js']) {
  test(`rejects non-generated candidate path ${path}`, () => {
    assert.throws(() => validateCandidatePaths([...valid, path], '2026-07'), /not allowlisted/)
  })
}

test('requires both compressed raw evidence files and durable state for the target month', () => {
  assert.throws(() => validateCandidatePaths(valid.filter((path) => !path.endsWith('.html.gz')), '2026-07'), /required generated artifacts/)
})

test('requires an immutable artifact run identifier for later recovery', () => {
  assert.equal(validateCandidateRunId(456), '456')
  for (const value of ['', ' 456', '456\n789', 'run-456', null]) {
    assert.throws(() => validateCandidateRunId(value), /candidate workflow run ID is invalid/)
  }
})

test('writes the durable state format separately from the pending release format', () => {
  const sourceRawSha256 = 'a'.repeat(64)
  const releaseKey = buildReleaseKey('2026-07', sourceRawSha256)
  const candidateCommitSha = 'b'.repeat(40)
  const candidateManifestSha256 = 'c'.repeat(64)
  const pending = {
    format: 'housing-data-pending-auto-release-v1',
    status: 'ready',
    dataset_as_of: '2026-07',
    source_raw_sha256: sourceRawSha256,
    release_key: releaseKey,
    producer_commit_sha: candidateCommitSha,
    candidate_commit_sha: candidateCommitSha,
    candidate_manifest_sha256: candidateManifestSha256,
    candidate_id: buildCandidateId({ releaseKey, commitSha: candidateCommitSha, candidateManifestSha256 }),
    time_seed: '2026-08-25T02:49:00.000Z',
    next_check_at: '2026-08-25T03:00:00.000Z',
    prepared_at: '2026-08-25T02:49:00.000Z',
  }
  const state = buildDurableReadyState(pending)
  assert.equal(state.format, 'housing-data-auto-update-state-v1')
  assert.equal(state.status, 'ready')
  assert.equal(state.time_seed, pending.time_seed)
  assert.equal(state.next_check_at, pending.next_check_at)
  assert.notEqual(state.format, pending.format)
  assert.doesNotThrow(() => validateStateIdentity(state))
})
