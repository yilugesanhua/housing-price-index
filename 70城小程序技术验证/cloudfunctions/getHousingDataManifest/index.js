const cloud = require('wx-server-sdk')
const { createHash } = require('node:crypto')
const { validateCurrent } = require('./validate-current.js')
const { buildValidationReceipt, describeValidator } = require('./validation-receipt.js')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const DEFAULT_CURRENT_FILE_ID = 'cloud://cloud1-d3gpdx70w5d05c68c.636c-cloud1-d3gpdx70w5d05c68c-1456861154/housing-data/current.json'
async function downloadJson(fileID, maximumBytes, expectedSha256 = '') {
  const response = await cloud.downloadFile({ fileID })
  if (!response || !response.fileContent || response.fileContent.length > maximumBytes) throw new Error(`Housing data control file is unavailable or too large: ${fileID}`)
  if (expectedSha256) {
    const actual = createHash('sha256').update(response.fileContent).digest('hex')
    if (actual !== expectedSha256) throw new Error(`Housing data control file hash mismatch: ${fileID}`)
  }
  return JSON.parse(response.fileContent.toString('utf8'))
}

exports.main = async (event = {}) => {
  if (event?.action === 'describe_validator') return { validator: describeValidator() }
  const fileID = String(process.env.HOUSING_DATA_CURRENT_FILE_ID || DEFAULT_CURRENT_FILE_ID)
  if (!fileID.startsWith('cloud://cloud1-d3gpdx70w5d05c68c.636c-cloud1-d3gpdx70w5d05c68c-1456861154/housing-data/')) throw new Error('Housing data pointer path is outside the allowed directory')
  const current = validateCurrent(await downloadJson(fileID, 8 * 1024), { allowLegacy: false })
  const [manifest, registry] = await Promise.all([
    downloadJson(current.manifest_file_id, 16 * 1024, current.manifest_sha256),
    downloadJson(current.revocations_file_id, 512 * 1024, current.revocations_sha256),
  ])
  validateCurrent(current, { allowLegacy: false, requireContext: true, manifest, registry })
  return { current, validation_receipt: buildValidationReceipt(current) }
}

exports.validateCurrent = validateCurrent
exports.buildValidationReceipt = buildValidationReceipt
exports.describeValidator = describeValidator
