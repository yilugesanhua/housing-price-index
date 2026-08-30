const CLOUD_ENV_ID = 'cloud1-d3gpdx70w5d05c68c'
const STORAGE_BUCKET = '636c-cloud1-d3gpdx70w5d05c68c-1456861154'
const DATA_ROOT = 'housing-data/preview'
const cloud = require('wx-server-sdk')
const { createHash } = require('node:crypto')
const { validateCurrent } = require('../getHousingDataManifest/validate-current.js')
const { buildValidationReceipt, describeValidator } = require('../getHousingDataManifest/validation-receipt.js')

cloud.init({ env: CLOUD_ENV_ID })
const DEFAULT_CURRENT_FILE_ID = `cloud://${CLOUD_ENV_ID}.${STORAGE_BUCKET}/${DATA_ROOT}/current.json`
const validationConfig = Object.freeze({ cloudEnvId: CLOUD_ENV_ID, storageBucket: STORAGE_BUCKET, remoteDataRoot: DATA_ROOT })

async function downloadJson(fileID, maximumBytes, expectedSha256 = '', expectedBytes = null) {
  const response = await cloud.downloadFile({ fileID })
  if (!response || !response.fileContent || response.fileContent.length > maximumBytes) throw new Error(`Preview housing data file is unavailable or too large: ${fileID}`)
  if (expectedBytes !== null && response.fileContent.length !== expectedBytes) throw new Error(`Preview housing data file byte length mismatch: ${fileID}`)
  if (expectedSha256) {
    const actual = createHash('sha256').update(response.fileContent).digest('hex')
    if (actual !== expectedSha256) throw new Error(`Preview housing data file hash mismatch: ${fileID}`)
  }
  return JSON.parse(response.fileContent.toString('utf8'))
}

exports.main = async (event = {}) => {
  if (event?.action === 'describe_validator') return { validator: describeValidator() }
  const current = validateCurrent(await downloadJson(DEFAULT_CURRENT_FILE_ID, 8 * 1024), { config: validationConfig, allowLegacy: false })
  const [manifest, registry] = await Promise.all([
    downloadJson(current.manifest_file_id, 16 * 1024, current.manifest_sha256),
    downloadJson(current.revocations_file_id, 512 * 1024, current.revocations_sha256),
  ])
  const revisionManifest = manifest.release_type === 'historical_correction'
    ? await downloadJson(manifest.revision_manifest_file_id, 512 * 1024, manifest.revision_manifest_sha256, manifest.revision_manifest_bytes)
    : undefined
  validateCurrent(current, { config: validationConfig, allowLegacy: false, requireContext: true, manifest, revisionManifest, registry })
  return { current, validation_receipt: buildValidationReceipt(current) }
}
