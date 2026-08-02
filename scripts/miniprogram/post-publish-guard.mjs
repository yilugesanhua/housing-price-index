import {
  assertRollbackClosure,
  assertTargetNotRevoked,
  buildControlValidUntil,
  validateControlPointer,
  validateRevocationRegistryArtifact,
} from './control-plane.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(`Post-publish guard rejected: ${message}`)
}

function pointerAuthority(pointer) {
  const match = /^cloud:\/\/([^.]+)\.([^/]+)\//.exec(pointer?.manifest_file_id || '')
  assert(match, 'pointer cloud authority is invalid')
  return { cloudEnvId: match[1], storageBucket: match[2] }
}

export function validateManifestFunctionOutput(stdout, expected) {
  let parsed
  try { parsed = JSON.parse(stdout) } catch (_) { throw new Error('Post-publish guard rejected: cloud function output is not JSON') }
  const result = parsed?.Result
  assert(result && typeof result === 'object' && !Array.isArray(result), 'cloud function SDK result is missing')
  assert(result.InvokeResult === 0, `cloud function invocation failed${result.ErrMsg ? `: ${result.ErrMsg}` : ''}`)
  assert(typeof result.RetMsg === 'string', 'cloud function authoritative RetMsg is missing')
  let payload
  try { payload = JSON.parse(result.RetMsg) } catch (_) { throw new Error('Post-publish guard rejected: cloud function RetMsg is not JSON') }
  const current = payload?.current
  assert(current && typeof current === 'object' && !Array.isArray(current), 'cloud function RetMsg did not return current')
  const actualFields = Object.keys(current).sort()
  const expectedFields = Object.keys(expected).sort()
  assert(actualFields.length === expectedFields.length && actualFields.every((field, index) => field === expectedFields[index]), 'cloud function current fields mismatch')
  validateControlPointer(expected, { allowLegacy: false, ...pointerAuthority(expected) })
  validateControlPointer(current, { allowLegacy: false, ...pointerAuthority(current) })
  for (const field of expectedFields) {
    assert(current[field] === expected[field], `cloud function ${field} mismatch`)
  }
  return current
}

export function buildAutomaticRollbackPointer(previousCurrent, failedDatasetVersion, {
  rolledBackAt = new Date().toISOString(),
  controlGeneration,
  registryArtifact,
  failedSourceDatasetVersion,
  rollbackRevisionId,
  targetSourceDatasetVersion,
  targetManifest,
  statusReason = 'post_publish_guard_failed',
} = {}) {
  assert(previousCurrent && /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(previousCurrent.dataset_version || ''), 'previous pointer is invalid')
  assert(previousCurrent.dataset_version !== failedDatasetVersion, 'rollback target equals failed dataset')
  assert(/^cloud:\/\/.+\/housing-data\/releases\/.+\/manifest\.json$/.test(previousCurrent.manifest_file_id || ''), 'previous manifest file ID is invalid')
  assert(/^[a-f0-9]{64}$/.test(previousCurrent.manifest_sha256 || ''), 'previous manifest hash is invalid')
  assert(Number.isFinite(Date.parse(previousCurrent.next_check_at || '')), 'previous next check time is invalid')
  assert(Number.isInteger(controlGeneration) && controlGeneration > Number(previousCurrent.control_generation || 0), 'rollback control generation is invalid')
  assert(registryArtifact?.registry && registryArtifact?.currentFields, 'rollback revocations artifact is missing')
  validateRevocationRegistryArtifact(registryArtifact)
  try {
    assertRollbackClosure(registryArtifact.registry, {
      failedDatasetVersion,
      failedSourceDatasetVersion,
      targetDatasetVersion: previousCurrent.dataset_version,
      targetSourceDatasetVersion,
      revisionId: rollbackRevisionId,
    })
  } catch (error) {
    throw new Error(`Post-publish guard rejected: ${String(error?.message || error).replace(/^Control plane rejected:\s*/, '')}`)
  }
  assertTargetNotRevoked(registryArtifact.registry, {
    datasetVersion: previousCurrent.dataset_version,
    sourceDatasetVersion: targetSourceDatasetVersion,
  })
  const pointer = {
    dataset_version: previousCurrent.dataset_version,
    source_dataset_version: targetSourceDatasetVersion,
    dataset_as_of: previousCurrent.dataset_as_of,
    schema_version: previousCurrent.schema_version,
    manifest_file_id: previousCurrent.manifest_file_id,
    manifest_sha256: previousCurrent.manifest_sha256,
    control_schema_version: '1.0.0',
    control_generation: controlGeneration,
    ...registryArtifact.currentFields,
    transition_type: 'rollback',
    rollback_from_dataset_version: failedDatasetVersion,
    data_status: 'current',
    status_reason: statusReason,
    control_generated_at: rolledBackAt,
    control_valid_until: buildControlValidUntil(rolledBackAt),
    published_at: rolledBackAt,
    previous_dataset_version: null,
    next_check_at: previousCurrent.next_check_at,
  }
  validateControlPointer(pointer, {
    allowLegacy: false,
    requireContext: Boolean(targetManifest),
    manifest: targetManifest,
    registry: registryArtifact.registry,
    ...pointerAuthority(pointer),
  })
  return pointer
}
