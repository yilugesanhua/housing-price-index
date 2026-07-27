import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function readJson(path, { optional = false } = {}) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null
    throw error
  }
}

export async function readRollbackEligibleAudit(root, datasetVersion, cloudEnvId) {
  const releaseDir = resolve(root, 'data/releases')
  const audit = await readJson(resolve(releaseDir, `${datasetVersion}.json`))
  if (audit.status !== 'published' || audit.dataset_version !== datasetVersion) {
    throw new Error('Target version has no valid local publish audit record')
  }
  if (audit.cloud_env_id !== cloudEnvId) {
    throw new Error('Target version was not published to the requested cloud environment')
  }
  const correction = await readJson(resolve(releaseDir, `${datasetVersion}.correction.json`), { optional: true })
  if (correction && (correction.dataset_version !== datasetVersion || correction.rollback_allowed !== false)) {
    throw new Error('Target version has a malformed correction record')
  }
  if (correction?.rollback_allowed === false) {
    throw new Error(`Target version is not eligible for rollback: ${correction.reason || 'disabled by correction record'}`)
  }
  return audit
}

export async function rollbackVersionOrNull(root, datasetVersion, cloudEnvId) {
  if (!datasetVersion) return null
  try {
    await readRollbackEligibleAudit(root, datasetVersion, cloudEnvId)
    return datasetVersion
  } catch (_) {
    return null
  }
}
