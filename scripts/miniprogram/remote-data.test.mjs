import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { buildRemoteRelease, clientNextCheckAt, REMOTE_FORMAT, SIZE_LIMITS, verifyReleaseAgainstSnapshot } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const snapshot = require(resolve(root, 'apps/miniprogram/data/snapshot.js'))
const versionConfig = require(resolve(root, 'apps/miniprogram/config/version.js'))

function release() {
  return buildRemoteRelease(snapshot, {
    cloudEnvId: 'cloud1-d3gpdx70w5d05c68c',
    storageBucket: '636c-cloud1-d3gpdx70w5d05c68c-1456861154',
    minimumAppVersion: versionConfig.version,
    nextCheckAt: '2026-08-17T01:40:00.000Z',
    sourceBatchIds: ['official-html-2026-06-4bb4edcce261'],
  })
}

test('remote mini program release is compact and exactly reconstructs bundled data', () => {
  const candidate = release()
  assert.equal(candidate.manifest.format, REMOTE_FORMAT)
  assert.equal(candidate.manifest.source_dataset_version, snapshot.datasetVersion)
  assert.match(candidate.manifest.dataset_version, /^2026-06-[a-f0-9]{12}$/)
  assert.equal(Object.keys(candidate.cities).length, 70)
  assert.equal(Object.keys(candidate.bootstrap.series).length, 70)
  assert.ok(candidate.manifest.bootstrap_bytes <= SIZE_LIMITS.bootstrap)
  assert.ok(candidate.totalBytes <= SIZE_LIMITS.release)
  assert.deepEqual(verifyReleaseAgainstSnapshot(snapshot, candidate), [])
})

test('client check time follows the next official release by ten minutes', () => {
  const calendar = { entries: [
    { expected_stat_month: '2026-06', scheduled_at: '2026-07-15T09:30:00+08:00' },
    { expected_stat_month: '2026-07', scheduled_at: '2026-08-17T09:30:00+08:00' },
  ] }
  assert.equal(clientNextCheckAt(calendar, '2026-06'), '2026-08-17T01:40:00.000Z')
  assert.throws(() => clientNextCheckAt(calendar, '2026-07'), /no next entry/)
})

test('remote mini program release rejects a damaged city shard', () => {
  const candidate = release()
  candidate.cities.fuzhou.data.series.n_a[0] = 999
  assert.match(verifyReleaseAgainstSnapshot(snapshot, candidate).join('\n'), /fuzhou: reconstructed series differ/)
})

test('remote mini program release rejects manifest and bootstrap hash mismatches', () => {
  const candidate = release()
  candidate.manifest.bootstrap_sha256 = '0'.repeat(64)
  candidate.current.manifest_sha256 = 'f'.repeat(64)
  const errors = verifyReleaseAgainstSnapshot(snapshot, candidate).join('\n')
  assert.match(errors, /bootstrap SHA-256 mismatch/)
  assert.match(errors, /manifest SHA-256 mismatch/)
})
