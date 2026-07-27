function assert(condition, message) {
  if (!condition) throw new Error(`Post-publish guard rejected: ${message}`)
}

function collect(value, output) {
  if (typeof value === 'string') {
    try { collect(JSON.parse(value), output) } catch (_) {}
    return
  }
  if (!value || typeof value !== 'object') return
  if (value.current && typeof value.current === 'object') output.push(value.current)
  for (const child of Object.values(value)) collect(child, output)
}

export function validateManifestFunctionOutput(stdout, expected) {
  let parsed
  try { parsed = JSON.parse(stdout) } catch (_) { throw new Error('Post-publish guard rejected: cloud function output is not JSON') }
  const candidates = []
  collect(parsed, candidates)
  const current = candidates.find((item) => item.dataset_version === expected.dataset_version)
  assert(current, 'cloud function did not return the published dataset')
  for (const field of ['dataset_version', 'dataset_as_of', 'manifest_file_id', 'manifest_sha256', 'next_check_at']) {
    assert(current[field] === expected[field], `cloud function ${field} mismatch`)
  }
  return current
}

export function buildAutomaticRollbackPointer(previousCurrent, failedDatasetVersion, rolledBackAt = new Date().toISOString()) {
  assert(previousCurrent && /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(previousCurrent.dataset_version || ''), 'previous pointer is invalid')
  assert(previousCurrent.dataset_version !== failedDatasetVersion, 'rollback target equals failed dataset')
  assert(/^cloud:\/\/.+\/housing-data\/releases\/.+\/manifest\.json$/.test(previousCurrent.manifest_file_id || ''), 'previous manifest file ID is invalid')
  assert(/^[a-f0-9]{64}$/.test(previousCurrent.manifest_sha256 || ''), 'previous manifest hash is invalid')
  assert(Number.isFinite(Date.parse(previousCurrent.next_check_at || '')), 'previous next check time is invalid')
  return {
    dataset_version: previousCurrent.dataset_version,
    dataset_as_of: previousCurrent.dataset_as_of,
    schema_version: previousCurrent.schema_version,
    manifest_file_id: previousCurrent.manifest_file_id,
    manifest_sha256: previousCurrent.manifest_sha256,
    published_at: rolledBackAt,
    previous_dataset_version: failedDatasetVersion,
    next_check_at: previousCurrent.next_check_at,
  }
}
