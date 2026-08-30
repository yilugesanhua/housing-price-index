import { createHash } from 'node:crypto'

const LEGACY_COMPLETE_HISTORY_MONITOR_BINDING = Object.freeze({
  auditSha256: '8aad9b1e36e2c8e0644c2aa8d02399bdf819c9e3e788de7ff5f293741954964c',
  cloudEnvId: 'cloud1-d3gpdx70w5d05c68c',
  commitSha: '2ad09b3dea05eeeb618512f1ae3f5184aef0c535',
  datasetVersion: '2026-06-f80465ae29a5',
  manifestSha256: 'ff6a6ca691f8569d6afb47fd7636e37bd2ccb578472df45a5e0d4f4cef2f39de',
  runId: '31010010550',
  sourceDatasetVersion: '2026-06-69fa180bd8db',
  storageBucket: '636c-cloud1-d3gpdx70w5d05c68c-1456861154',
})

const GITHUB_RUN_PATTERN = /^[1-9]\d*$/
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/
const SOURCE_BATCH_ID_PATTERN = /^official-html-20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/

function assert(condition, message) {
  if (!condition) throw new Error(`Monitor release audit rejected: ${message}`)
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function isBoundLegacyCompleteHistoryAudit(audit, auditText, datasetVersion) {
  const binding = LEGACY_COMPLETE_HISTORY_MONITOR_BINDING
  return datasetVersion === binding.datasetVersion
    && sha256(auditText) === binding.auditSha256
    && !Object.hasOwn(audit, 'cloud_env_id')
    && !Object.hasOwn(audit, 'storage_bucket')
    && audit.status === 'published'
    && audit.dataset_version === binding.datasetVersion
    && audit.source_dataset_version === binding.sourceDatasetVersion
    && audit.release_type === 'complete_history'
    && audit.remote_schema_version === '2.1.0'
    && audit.month_count === 180
    && audit.manifest_sha256 === binding.manifestSha256
    && audit.github_run_id === binding.runId
    && audit.github_run_attempt === '1'
    && audit.commit_sha === binding.commitSha
    && audit.audit_repository_commit_sha === binding.commitSha
    && audit.release_authorization?.repository_automatic_release_enabled === true
    && audit.release_authorization?.production_environment_authorized === true
}

function sortedUniqueSourceBatchIds(value, label, { requireOfficialFormat = false } = {}) {
  assert(Array.isArray(value), `${label} source batch IDs are missing`)
  assert(value.every((id) => typeof id === 'string' && id.length > 0), `${label} source batch IDs are invalid`)
  if (requireOfficialFormat) assert(value.every((id) => SOURCE_BATCH_ID_PATTERN.test(id)), `${label} source batch IDs use an unsupported format`)
  assert(new Set(value).size === value.length, `${label} source batch IDs contain duplicates`)
  return [...value].sort()
}

export function validateMonitoredManifestMetadata({ manifest, audit, usedLegacyBinding }) {
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'monitored manifest is not a JSON object')
  assert(audit && typeof audit === 'object' && !Array.isArray(audit), 'monitor release audit is not a JSON object')
  assert(typeof usedLegacyBinding === 'boolean', 'monitor release audit binding mode is invalid')
  assert(manifest.dataset_version === audit.dataset_version, 'monitored manifest dataset identity differs')
  assert(manifest.source_dataset_version === audit.source_dataset_version, 'monitored manifest source dataset identity differs')
  assert(manifest.dataset_as_of === audit.dataset_as_of, 'monitored manifest month differs')

  const correction = manifest.release_type === 'historical_correction' || audit.release_type === 'historical_correction'
  assert((manifest.release_type === 'historical_correction') === (audit.release_type === 'historical_correction'), 'monitored release type differs from immutable publish audit')
  const sourceField = correction ? 'revision_source_batch_ids' : 'latest_source_batch_ids'
  const legacySourceField = correction ? null : 'source_batch_ids'
  const manifestSourceBatchIds = sortedUniqueSourceBatchIds(
    manifest[sourceField] ?? (legacySourceField ? manifest[legacySourceField] : undefined),
    'monitored manifest',
    { requireOfficialFormat: !usedLegacyBinding },
  )
  if (usedLegacyBinding) {
    assert(Number.isInteger(audit.source_batch_count) && audit.source_batch_count >= 0,
      'trusted legacy audit source batch count is invalid')
    assert(manifestSourceBatchIds.length === audit.source_batch_count,
      'monitored manifest source batch count differs from the trusted legacy audit')
    return
  }

  const auditSourceBatchIds = sortedUniqueSourceBatchIds(
    audit[sourceField] ?? (legacySourceField ? audit[legacySourceField] : undefined),
    'monitor release audit',
    { requireOfficialFormat: true },
  )
  assert(JSON.stringify(manifestSourceBatchIds) === JSON.stringify(auditSourceBatchIds),
    'monitored manifest source batch IDs differ from the immutable publish audit')
  if (correction) {
    assert(/^revision-[a-z0-9][a-z0-9-]{5,80}$/.test(manifest.revision_id || '') && manifest.revision_id === audit.revision_id, 'monitored revision identity differs from immutable publish audit')
    for (const field of [
      'candidate_records_sha256', 'audit_records_sha256', 'source_index_sha256',
      'audit_report_sha256', 'audit_commit_sha', 'audit_code_sha256',
      'ledger_before_sha256', 'ledger_after_sha256', 'ledger_append_sha256',
    ]) {
      assert(typeof manifest[field] === 'string' && manifest[field] === audit[field], `monitored correction ${field} differs from immutable publish audit`)
    }
  }
}

export function validateMonitorReleaseAudit({
  audit,
  auditText,
  datasetVersion,
  expectedCloudEnvId,
  expectedStorageBucket,
  fileName,
}) {
  assert(audit && typeof audit === 'object' && !Array.isArray(audit), `${fileName} is not a JSON object`)
  assert(typeof auditText === 'string', `${fileName} original bytes are missing`)
  assert(audit.status === 'published', `${fileName} is not a successful publish audit`)
  assert(audit.dataset_version === datasetVersion, `${fileName} dataset identity does not match its filename`)
  assert(/^[a-f0-9]{64}$/.test(audit.manifest_sha256 || ''), `${fileName} manifest hash is invalid`)
  assert(typeof expectedCloudEnvId === 'string' && expectedCloudEnvId.length > 0,
    `${fileName} expected cloud environment is invalid`)
  assert(typeof expectedStorageBucket === 'string' && expectedStorageBucket.length > 0,
    `${fileName} expected storage bucket is invalid`)

  const binding = LEGACY_COMPLETE_HISTORY_MONITOR_BINDING
  if (datasetVersion === binding.datasetVersion) {
    // The one pre-binding audit stays monitor-only and must remain byte-for-byte immutable.
    assert(isBoundLegacyCompleteHistoryAudit(audit, auditText, datasetVersion),
      `${fileName} is not the exact trusted legacy complete-history audit`)
    assert(binding.cloudEnvId === expectedCloudEnvId, `${fileName} targets a different cloud environment`)
    assert(binding.storageBucket === expectedStorageBucket, `${fileName} targets a different storage bucket`)
    return {
      auditSha256: sha256(auditText),
      cloudEnvId: binding.cloudEnvId,
      storageBucket: binding.storageBucket,
      usedLegacyBinding: true,
    }
  }

  assert(audit.cloud_env_id === expectedCloudEnvId, `${fileName} targets a different cloud environment`)
  assert(Object.hasOwn(audit, 'storage_bucket'), `${fileName} storage bucket is missing`)
  assert(audit.storage_bucket === expectedStorageBucket, `${fileName} targets a different storage bucket`)
  assert(GITHUB_RUN_PATTERN.test(String(audit.github_run_id || '')), `${fileName} GitHub run identity is invalid`)
  assert(GITHUB_RUN_PATTERN.test(String(audit.github_run_attempt || '')), `${fileName} GitHub run attempt is invalid`)
  assert(COMMIT_SHA_PATTERN.test(audit.commit_sha || ''), `${fileName} commit identity is invalid`)

  return {
    auditSha256: sha256(auditText),
    cloudEnvId: audit.cloud_env_id,
    storageBucket: audit.storage_bucket,
    usedLegacyBinding: false,
  }
}
