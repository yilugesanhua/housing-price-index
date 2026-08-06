import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

import { validateMonitorReleaseAudit } from './monitor-release-audit.mjs'

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
