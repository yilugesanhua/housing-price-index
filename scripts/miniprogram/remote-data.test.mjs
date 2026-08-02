import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { buildRemoteRelease, classifyRemoteFreshness, clientNextCheckAt, REMOTE_FORMAT, RELEASE_TYPES, sha256, SIZE_LIMITS, stableJson, verifyReleaseAgainstSnapshot, verifyReleaseIntegrity } from './remote-data-lib.mjs'

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
  assert.equal(candidate.manifest.release_type, RELEASE_TYPES.monthly)
  assert.match(candidate.manifest.dataset_version, /^2026-06-[a-f0-9]{12}$/)
  assert.equal(Object.keys(candidate.cities).length, 70)
  assert.equal(Object.keys(candidate.bootstrap.series).length, 70)
  assert.ok(candidate.manifest.bootstrap_bytes <= SIZE_LIMITS.bootstrap)
  assert.ok(candidate.totalBytes <= SIZE_LIMITS.release)
  assert.deepEqual(verifyReleaseAgainstSnapshot(snapshot, candidate), [])
})

test('remote release rejects false or discontinuous client-window coverage metadata', () => {
  assert.throws(() => buildRemoteRelease({ ...snapshot, coverageStart: snapshot.sourceCoverageStart }, {
    cloudEnvId: 'cloud1-d3gpdx70w5d05c68c', storageBucket: '636c-cloud1-d3gpdx70w5d05c68c-1456861154',
    minimumAppVersion: versionConfig.version, nextCheckAt: '2026-08-17T01:40:00.000Z', sourceBatchIds: ['official-html-test'],
  }), /coverageStart must match/)
  const discontinuous = structuredClone(snapshot)
  discontinuous.months[1] = discontinuous.months[0]
  assert.throws(() => buildRemoteRelease(discontinuous, {
    cloudEnvId: 'cloud1-d3gpdx70w5d05c68c', storageBucket: '636c-cloud1-d3gpdx70w5d05c68c-1456861154',
    minimumAppVersion: versionConfig.version, nextCheckAt: '2026-08-17T01:40:00.000Z', sourceBatchIds: ['official-html-test'],
  }), /months must be continuous/)
})

test('legacy monthly package without release_type remains compatible', () => {
  const candidate = release()
  delete candidate.manifest.release_type
  candidate.manifestText = stableJson(candidate.manifest)
  candidate.current.manifest_sha256 = sha256(candidate.manifestText)
  candidate.currentText = stableJson(candidate.current)
  assert.deepEqual(verifyReleaseIntegrity(candidate), [])
})

test('integrity verifier interprets coverageStart as source coverage only for the approved legacy migration', () => {
  const candidate = release()
  candidate.bootstrap.coverageStart = snapshot.sourceCoverageStart
  delete candidate.bootstrap.sourceCoverageStart
  candidate.bootstrapText = stableJson(candidate.bootstrap)
  candidate.manifest.bootstrap_sha256 = sha256(candidate.bootstrapText)
  candidate.manifest.bootstrap_bytes = Buffer.byteLength(candidate.bootstrapText)
  candidate.manifestText = stableJson(candidate.manifest)
  candidate.current.manifest_sha256 = sha256(candidate.manifestText)
  candidate.current.transition_type = 'migration'
  candidate.current.migration_id = 'legacy-control-2026-06-e9788d0bddf3'
  candidate.current.migrated_from_manifest_sha256 = candidate.current.manifest_sha256
  candidate.currentText = stableJson(candidate.current)

  assert.deepEqual(verifyReleaseIntegrity(candidate), [])

  delete candidate.current.transition_type
  delete candidate.current.migration_id
  delete candidate.current.migrated_from_manifest_sha256
  candidate.currentText = stableJson(candidate.current)
  assert.match(verifyReleaseIntegrity(candidate).join('\n'), /coverageStart must match/)
})

test('historical correction binds an audited revision manifest into the release', () => {
  const corrected = { ...snapshot, datasetVersion: '2026-06-222222222222' }
  const candidate = buildRemoteRelease(corrected, {
    cloudEnvId: 'cloud1-d3gpdx70w5d05c68c', storageBucket: '636c-cloud1-d3gpdx70w5d05c68c-1456861154',
    minimumAppVersion: 'v2.4.0', nextCheckAt: '2026-08-17T01:40:00.000Z', sourceBatchIds: ['official-html-corrected'],
    correction: {
      revision_id: 'revision-2026-06-audited-fix', revision_type: 'historical_data_correction', approval_status: 'approved', dataset_as_of: '2026-06',
      supersedes_source_dataset_version: snapshot.datasetVersion, source_dataset_version: corrected.datasetVersion,
      source_version_chain: [snapshot.datasetVersion, corrected.datasetVersion], revoked_source_dataset_versions: [snapshot.datasetVersion],
      reason: '国家统计局官方原始表经全量复核后的历史数据修订', official_urls: ['https://www.stats.gov.cn/source'], source_batch_ids: ['official-html-corrected'],
      parser_version: 'official-html-v7-product-housing-only', audit_version: 'full-record-audit-v4', approved_at: '2026-07-20T00:00:00Z', approved_by: 'data-owner',
      audit_report_sha256: 'a'.repeat(64), commit_sha: 'b'.repeat(40), github_run_id: '12345',
      changes: [{ record_key: '2026-06|fuzhou|new|all', field: 'mom_index', old_value: 99.8, new_value: 99.9, source_url: 'https://www.stats.gov.cn/source', source_record_locator: 'table[0] row[1]' }],
    },
  })
  assert.equal(candidate.manifest.release_type, RELEASE_TYPES.correction)
  assert.equal(candidate.manifest.revision_manifest_sha256, sha256(candidate.revisionManifestText))
  assert.deepEqual(verifyReleaseAgainstSnapshot(corrected, candidate), [])
  candidate.revisionManifestText += ' '
  assert.match(verifyReleaseIntegrity(candidate).join('\n'), /revision manifest SHA-256 mismatch/)
})

test('legacy sharded releases reconstruct all cities while v2.3 requires a complete bootstrap', () => {
  const legacy = release()
  legacy.manifest.minimum_app_version = 'v2.2.0'
  legacy.bootstrap.series = Object.fromEntries(snapshot.featuredCityIds.map((cityId) => [cityId, legacy.bootstrap.series[cityId]]))
  legacy.bootstrapText = stableJson(legacy.bootstrap)
  legacy.manifest.bootstrap_sha256 = sha256(legacy.bootstrapText)
  legacy.manifest.bootstrap_bytes = Buffer.byteLength(legacy.bootstrapText)
  legacy.manifestText = stableJson(legacy.manifest)
  legacy.current.manifest_sha256 = sha256(legacy.manifestText)
  legacy.currentText = stableJson(legacy.current)
  legacy.totalBytes = Buffer.byteLength(legacy.bootstrapText) + Buffer.byteLength(legacy.manifestText)
    + Object.values(legacy.cities).reduce((sum, item) => sum + item.bytes, 0)
  assert.deepEqual(verifyReleaseAgainstSnapshot(snapshot, legacy), [])

  legacy.manifest.minimum_app_version = 'v2.3.0'
  assert.match(verifyReleaseAgainstSnapshot(snapshot, legacy).join('\n'), /full bootstrap series differ/)
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

test('integrity monitoring accepts an internally exact older source but marks it stale', () => {
  const candidate = release()
  candidate.manifest.source_dataset_version = '2026-06-679ea146d4e2'
  candidate.manifestText = stableJson(candidate.manifest)
  candidate.current.manifest_sha256 = sha256(candidate.manifestText)
  candidate.currentText = stableJson(candidate.current)
  assert.deepEqual(verifyReleaseIntegrity(candidate), [])
  assert.deepEqual(classifyRemoteFreshness(candidate.manifest, snapshot), {
    freshness_status: 'known_stale_source',
    client_action: 'reject_remote_and_keep_bundled_snapshot',
  })
  assert.match(verifyReleaseAgainstSnapshot(snapshot, candidate).join('\n'), /manifest source dataset version mismatch/)
})

test('integrity monitoring still rejects a self-inconsistent city shard', () => {
  const candidate = release()
  candidate.cities.fuzhou.data.series.n_a[0] = 999
  candidate.cities.fuzhou.text = stableJson(candidate.cities.fuzhou.data)
  candidate.cities.fuzhou.sha256 = sha256(candidate.cities.fuzhou.text)
  candidate.cities.fuzhou.bytes = Buffer.byteLength(candidate.cities.fuzhou.text)
  candidate.manifest.city_files.fuzhou = {
    sha256: candidate.cities.fuzhou.sha256,
    bytes: candidate.cities.fuzhou.bytes,
  }
  candidate.manifestText = stableJson(candidate.manifest)
  candidate.current.manifest_sha256 = sha256(candidate.manifestText)
  candidate.currentText = stableJson(candidate.current)
  assert.match(verifyReleaseIntegrity(candidate).join('\n'), /fuzhou: bootstrap and shard series differ/)
})
