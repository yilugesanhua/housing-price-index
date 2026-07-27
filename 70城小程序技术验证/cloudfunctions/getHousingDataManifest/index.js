const cloud = require('wx-server-sdk')
const { validateCurrent } = require('./validate-current.js')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const DEFAULT_CURRENT_FILE_ID = 'cloud://cloud1-d3gpdx70w5d05c68c.636c-cloud1-d3gpdx70w5d05c68c-1456861154/housing-data/current.json'
exports.main = async () => {
  const fileID = String(process.env.HOUSING_DATA_CURRENT_FILE_ID || DEFAULT_CURRENT_FILE_ID)
  if (!fileID.startsWith('cloud://cloud1-d3gpdx70w5d05c68c.636c-cloud1-d3gpdx70w5d05c68c-1456861154/housing-data/')) throw new Error('Housing data pointer path is outside the allowed directory')
  const response = await cloud.downloadFile({ fileID })
  if (!response || !response.fileContent || response.fileContent.length > 8 * 1024) throw new Error('Housing data current pointer is unavailable or too large')
  const current = validateCurrent(JSON.parse(response.fileContent.toString('utf8')))
  return { current }
}

exports.validateCurrent = validateCurrent
