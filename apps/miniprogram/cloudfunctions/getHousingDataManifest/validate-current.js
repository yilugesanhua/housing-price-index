const DATASET_VERSION_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const RELEASE_ROOT = 'cloud://cloud1-d3gpdx70w5d05c68c.636c-cloud1-d3gpdx70w5d05c68c-1456861154/housing-data/releases/'

function validateCurrent(value) {
  if (!value || typeof value !== 'object') throw new Error('Housing data current pointer is invalid')
  if (!DATASET_VERSION_PATTERN.test(value.dataset_version || '')) throw new Error('Housing data dataset version is invalid')
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value.dataset_as_of || '')) throw new Error('Housing data month is invalid')
  if (!/^1\./.test(value.schema_version || '')) throw new Error('Housing data schema is unsupported')
  if (value.manifest_file_id !== `${RELEASE_ROOT}${value.dataset_version}/manifest.json`) throw new Error('Housing data manifest file ID is invalid')
  if (!SHA256_PATTERN.test(value.manifest_sha256 || '')) throw new Error('Housing data manifest hash is invalid')
  if (!Number.isFinite(Date.parse(value.next_check_at || ''))) throw new Error('Housing data next check time is invalid')
  return value
}

module.exports = { validateCurrent }
