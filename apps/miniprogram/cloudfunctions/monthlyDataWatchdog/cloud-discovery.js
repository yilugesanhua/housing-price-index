const { createHash } = require('node:crypto')
const contract = require('./discovery-contract.js')

const DEFAULT_CURRENT_FILE_ID = 'cloud://cloud1-d3gpdx70w5d05c68c.636c-cloud1-d3gpdx70w5d05c68c-1456861154/housing-data/current.json'
const MAX_CURRENT_POINTER_BYTES = 8 * 1024
const CLOUD_DISCOVERY_PAGE_LIMIT = 3

function pointerFingerprint(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertPointerFileId(fileId) {
  if (fileId !== DEFAULT_CURRENT_FILE_ID) throw new Error('只读发现器拒绝访问白名单外的生产指针')
  return fileId
}

function parseProductionPointer(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
  if (bytes.length === 0 || bytes.length > MAX_CURRENT_POINTER_BYTES) throw new Error('生产 current.json 不可用或超过大小上限')
  let pointer
  try {
    pointer = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('生产 current.json 不是有效JSON')
  }
  if (!pointer || !contract.isStatMonth(pointer.dataset_as_of) || !/^[a-f0-9]{64}$/.test(pointer.manifest_sha256 || '') || !Number.isFinite(Date.parse(pointer.next_check_at || ''))) {
    throw new Error('生产 current.json 身份无效')
  }
  return {
    dataset_as_of: pointer.dataset_as_of,
    dataset_version: typeof pointer.dataset_version === 'string' ? pointer.dataset_version : null,
    next_check_at: pointer.next_check_at,
    manifest_sha256: pointer.manifest_sha256,
    pointer_sha256: pointerFingerprint(bytes),
  }
}

async function readProductionPointer({ cloudSdk, fileId = DEFAULT_CURRENT_FILE_ID }) {
  if (!cloudSdk || typeof cloudSdk.downloadFile !== 'function') throw new Error('腾讯云只读下载能力不可用')
  const response = await cloudSdk.downloadFile({ fileID: assertPointerFileId(fileId) })
  if (!response || !response.fileContent) throw new Error('腾讯云未返回生产 current.json')
  return parseProductionPointer(response.fileContent)
}

async function runReadOnlyDiscovery({
  cloudSdk,
  now = Date.now(),
  fetchImpl = globalThis.fetch,
  pointerFileId = DEFAULT_CURRENT_FILE_ID,
  retryDelayMs = undefined,
} = {}) {
  if (!Number.isFinite(now)) throw new Error('发现时间无效')
  const pointer = await readProductionPointer({ cloudSdk, fileId: pointerFileId })
  const calendar = await contract.fetchReleaseCalendar({ fetchImpl, retryDelayMs })
  const manifest = { dataset_as_of: pointer.dataset_as_of, next_check_due_at: pointer.next_check_at }
  const decision = contract.evaluateReleaseSchedule(calendar, manifest, new Date(now))
  if (!decision.should_check_official) {
    return {
      pointer,
      calendar,
      result: contract.waitingResult(decision, manifest, new Date(now).toISOString()),
    }
  }
  const discovery = await contract.discoverOfficialPages(CLOUD_DISCOVERY_PAGE_LIMIT, { fetchImpl, retryDelayMs })
  const result = contract.evaluateLatestCheck(discovery, manifest, new Date(now), decision)
  return {
    pointer,
    calendar,
    result: { ...result, discovery_responses: discovery.responses ?? [] },
  }
}

module.exports = {
  DEFAULT_CURRENT_FILE_ID,
  MAX_CURRENT_POINTER_BYTES,
  CLOUD_DISCOVERY_PAGE_LIMIT,
  assertPointerFileId,
  parseProductionPointer,
  readProductionPointer,
  runReadOnlyDiscovery,
}
