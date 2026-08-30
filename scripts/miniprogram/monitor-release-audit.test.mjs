import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

import { validateMonitoredManifestMetadata, validateMonitorReleaseAudit } from './monitor-release-audit.mjs'

const root = resolve(import.meta.dirname, '../..')
const cloudEnvId = 'cloud1-d3gpdx70w5d05c68c'
const storageBucket = '636c-cloud1-d3gpdx70w5d05c68c-1456861154'
const datasetVersion = '2026-06-f80465ae29a5'
const legacyPath = resolve(root, 'data/releases', `${datasetVersion}.json`)

function serializeAudit(audit) {
  return `${JSON.stringify(audit, null, 2)}\n`
}

function validateModernAudit(audit, expected = {}) {
  return validateMonitorReleaseAudit({
    audit,
    auditText: serializeAudit(audit),
    datasetVersion: audit.dataset_version,
    expectedCloudEnvId: expected.cloudEnvId || cloudEnvId,
    expectedStorageBucket: expected.storageBucket || storageBucket,
    fileName: `${audit.dataset_version}.json`,
  })
}

test('monitor accepts only the exact bound legacy complete-history audit', async () => {
  const auditText = await readFile(legacyPath, 'utf8')
  const audit = JSON.parse(auditText)
  const result = validateMonitorReleaseAudit({
    audit,
    auditText,
    datasetVersion,
    expectedCloudEnvId: cloudEnvId,
    expectedStorageBucket: storageBucket,
    fileName: `${datasetVersion}.json`,
  })
  assert.equal(result.cloudEnvId, cloudEnvId)
  assert.equal(result.storageBucket, storageBucket)
  assert.equal(result.usedLegacyBinding, true)
  assert.equal(result.auditSha256, '8aad9b1e36e2c8e0644c2aa8d02399bdf819c9e3e788de7ff5f293741954964c')

  assert.throws(() => validateMonitorReleaseAudit({
    audit,
    auditText,
    datasetVersion,
    expectedCloudEnvId: 'cloud1-other',
    expectedStorageBucket: storageBucket,
    fileName: `${datasetVersion}.json`,
  }), /different cloud environment/)
  assert.throws(() => validateMonitorReleaseAudit({
    audit,
    auditText: `${auditText} `,
    datasetVersion,
    expectedCloudEnvId: cloudEnvId,
    expectedStorageBucket: storageBucket,
    fileName: `${datasetVersion}.json`,
  }), /exact trusted legacy complete-history audit/)

  const withAddedCloudEnvironment = { ...audit, cloud_env_id: cloudEnvId }
  assert.throws(() => validateMonitorReleaseAudit({
    audit: withAddedCloudEnvironment,
    auditText: serializeAudit(withAddedCloudEnvironment),
    datasetVersion,
    expectedCloudEnvId: cloudEnvId,
    expectedStorageBucket: storageBucket,
    fileName: `${datasetVersion}.json`,
  }), /exact trusted legacy complete-history audit/)
})

test('monitor requires exact modern cloud, storage, and execution bindings', () => {
  const audit = {
    status: 'published',
    cloud_env_id: cloudEnvId,
    storage_bucket: storageBucket,
    dataset_version: '2026-07-0123456789ab',
    manifest_sha256: 'b'.repeat(64),
    github_run_id: '32010010550',
    github_run_attempt: '2',
    commit_sha: 'c'.repeat(40),
  }
  assert.equal(validateModernAudit(audit).usedLegacyBinding, false)
  assert.equal(validateModernAudit(audit).storageBucket, storageBucket)
  assert.throws(() => validateModernAudit(audit, { cloudEnvId: 'cloud1-other' }), /different cloud environment/)
  assert.throws(() => validateModernAudit({ ...audit, storage_bucket: 'other-bucket' }), /different storage bucket/)

  const withoutStorageBucket = { ...audit }
  delete withoutStorageBucket.storage_bucket
  assert.throws(() => validateModernAudit(withoutStorageBucket), /storage bucket is missing/)
  assert.throws(() => validateModernAudit({ ...audit, github_run_id: '0' }), /GitHub run identity is invalid/)
  assert.throws(() => validateModernAudit({ ...audit, github_run_attempt: '' }), /GitHub run attempt is invalid/)
  assert.throws(() => validateModernAudit({ ...audit, commit_sha: 'c'.repeat(39) }), /commit identity is invalid/)
})

test('the exact legacy audit accepts a unique source batch list with its recorded count', async () => {
  const audit = JSON.parse(await readFile(legacyPath, 'utf8'))
  const sourceBatchIds = Array.from({ length: audit.source_batch_count }, (_, index) => `batch-${index}`)
  const manifest = {
    dataset_version: audit.dataset_version,
    source_dataset_version: audit.source_dataset_version,
    dataset_as_of: audit.dataset_as_of,
    source_batch_ids: sourceBatchIds,
  }

  assert.doesNotThrow(() => validateMonitoredManifestMetadata({
    manifest,
    audit,
    usedLegacyBinding: true,
  }))
  assert.throws(() => validateMonitoredManifestMetadata({
    manifest: { ...manifest, source_batch_ids: sourceBatchIds.slice(1) },
    audit,
    usedLegacyBinding: true,
  }), /source batch count differs/)
  assert.throws(() => validateMonitoredManifestMetadata({
    manifest: { ...manifest, source_batch_ids: [...sourceBatchIds.slice(0, -1), sourceBatchIds[0]] },
    audit,
    usedLegacyBinding: true,
  }), /source batch IDs contain duplicates/)
})

test('modern audits still require the immutable source batch ID list', () => {
  const audit = {
    dataset_version: '2026-07-0123456789ab',
    source_dataset_version: '2026-07-abcdefabcdef',
    dataset_as_of: '2026-07',
    source_batch_ids: ['official-html-2026-07-aaaaaaaaaaaa', 'official-html-2026-07-bbbbbbbbbbbb'],
  }
  const manifest = {
    dataset_version: audit.dataset_version,
    source_dataset_version: audit.source_dataset_version,
    dataset_as_of: audit.dataset_as_of,
    source_batch_ids: ['official-html-2026-07-bbbbbbbbbbbb', 'official-html-2026-07-aaaaaaaaaaaa'],
  }

  assert.doesNotThrow(() => validateMonitoredManifestMetadata({ manifest, audit, usedLegacyBinding: false }))
  const missingIds = { ...audit }
  delete missingIds.source_batch_ids
  assert.throws(() => validateMonitoredManifestMetadata({ manifest, audit: missingIds, usedLegacyBinding: false }),
    /source batch IDs are missing/)
  assert.throws(() => validateMonitoredManifestMetadata({
    manifest: { ...manifest, source_batch_ids: ['official-html-2026-07-aaaaaaaaaaaa', 'official-html-2026-07-cccccccccccc'] },
    audit,
    usedLegacyBinding: false,
  }), /source batch IDs differ/)
  assert.throws(() => validateMonitoredManifestMetadata({
    manifest: { ...manifest, source_batch_ids: ['batch-a', 'batch-b'] },
    audit,
    usedLegacyBinding: false,
  }), /unsupported format/)
})

test('historical correction monitoring binds the separate revision source set and ledger identity', () => {
  const identity = {
    candidate_records_sha256: 'a'.repeat(64),
    audit_records_sha256: 'b'.repeat(64),
    source_index_sha256: 'c'.repeat(64),
    audit_report_sha256: 'd'.repeat(64),
    audit_commit_sha: 'e'.repeat(40),
    audit_code_sha256: 'f'.repeat(64),
    ledger_before_sha256: '1'.repeat(64),
    ledger_after_sha256: '2'.repeat(64),
    ledger_append_sha256: '3'.repeat(64),
  }
  const audit = {
    dataset_version: '2026-07-0123456789ab',
    source_dataset_version: '2026-07-abcdefabcdef',
    dataset_as_of: '2026-07',
    release_type: 'historical_correction',
    revision_id: 'revision-2026-07-audited-fix',
    revision_source_batch_ids: ['official-html-2026-06-aaaaaaaaaaaa', 'official-html-2026-07-bbbbbbbbbbbb'],
    ...identity,
  }
  const manifest = { ...audit }
  assert.doesNotThrow(() => validateMonitoredManifestMetadata({ manifest, audit, usedLegacyBinding: false }))
  assert.throws(() => validateMonitoredManifestMetadata({
    manifest: { ...manifest, revision_source_batch_ids: ['official-html-2026-06-aaaaaaaaaaaa'] },
    audit,
    usedLegacyBinding: false,
  }), /source batch IDs differ/)
  assert.throws(() => validateMonitoredManifestMetadata({
    manifest: { ...manifest, ledger_after_sha256: '0'.repeat(64) },
    audit,
    usedLegacyBinding: false,
  }), /ledger_after_sha256 differs/)
})
