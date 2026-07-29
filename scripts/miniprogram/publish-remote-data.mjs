import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createTencentCloudClient, isMissingObjectError } from './tencent-cloud-sdk.mjs'
import { sha256, stableJson } from './remote-data-lib.mjs'
import { readRollbackEligibleAudit, rollbackVersionOrNull } from './release-audit-lib.mjs'
import { authorizeCiRelease } from './ci-release-authorization.mjs'
import { validateManifestFunctionOutput } from './post-publish-guard.mjs'
import { activatePointerWithRollback } from './guarded-activation.mjs'

const root = resolve(import.meta.dirname, '../..')
const execFileAsync = promisify(execFile)
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const datasetVersion = argument('dataset')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const dryRun = process.argv.includes('--dry-run')
if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || '')) throw new Error('Use --dataset=<YYYY-MM-hash>')
if (!/^cloud[\w-]+$/.test(cloudEnvId)) throw new Error('Invalid --env value')
const localRoot = resolve(root, 'work/miniprogram-data', datasetVersion)
const report = JSON.parse(await readFile(resolve(localRoot, 'release-report.json'), 'utf8'))
const manifestText = await readFile(resolve(localRoot, 'manifest.json'), 'utf8')
const manifest = JSON.parse(manifestText)
if (report.status !== 'staged' || report.dataset_version !== datasetVersion || report.cloud_env_id !== cloudEnvId) throw new Error('Staged release report does not match requested publish target')
if (report.manifest_sha256 !== sha256(manifestText) || manifest.validation_status !== 'passed') throw new Error('Staged manifest failed the publish gate')
const ciMode = process.env.GITHUB_ACTIONS === 'true'
const ciGate = ciMode ? await authorizeCiRelease({ root, datasetVersion, cloudEnvId }) : null
const cloudRoot = `housing-data/releases/${datasetVersion}`
const plan = [
  ['putObject', `${cloudRoot}/bootstrap.json`],
  ['putObject', `${cloudRoot}/cities/<70-city-files>.json`],
  ['putObject', `${cloudRoot}/manifest.json`],
  ['putObject', 'housing-data/current.json', 'after full verification'],
]
if (dryRun) {
  console.log(JSON.stringify({ dry_run: true, dataset_version: datasetVersion, cloud_env_id: cloudEnvId, sdk_operations: plan }, null, 2))
  process.exit(0)
}

const cloud = createTencentCloudClient({ cloudEnvId })
const existing = await cloud.objectExists(`${cloudRoot}/manifest.json`)
let releaseAlreadyUploaded = false
if (existing) {
  const existingManifestPath = resolve(localRoot, 'existing-remote-manifest.json')
  await rm(existingManifestPath, { force: true })
  await cloud.downloadObject(`${cloudRoot}/manifest.json`, existingManifestPath)
  if (sha256(await readFile(existingManifestPath, 'utf8')) !== report.manifest_sha256) {
    throw new Error(`Immutable remote release already exists with different content: ${datasetVersion}`)
  }
  releaseAlreadyUploaded = true
}

let previous = null
const previousPath = resolve(localRoot, 'previous-current.json')
await rm(previousPath, { force: true })
try {
  await cloud.downloadObject('housing-data/current.json', previousPath)
  previous = JSON.parse(await readFile(previousPath, 'utf8'))
} catch (error) {
  if (!isMissingObjectError(error)) throw error
}
if (ciGate?.gate_type === 'manual_corrected_release') {
  if (previous?.dataset_version !== ciGate.expected_current_dataset_version) {
    throw new Error(`Corrected release precondition failed: active dataset is ${previous?.dataset_version || 'missing'}`)
  }
  const activeManifestPath = resolve(localRoot, 'active-manifest-before-correction.json')
  await rm(activeManifestPath, { force: true })
  await cloud.downloadObject(`housing-data/releases/${previous.dataset_version}/manifest.json`, activeManifestPath)
  const activeManifestText = await readFile(activeManifestPath, 'utf8')
  if (sha256(activeManifestText) !== previous.manifest_sha256) {
    throw new Error('Corrected release precondition failed: active manifest hash differs from current.json')
  }
  const activeManifest = JSON.parse(activeManifestText)
  if (activeManifest.dataset_version !== previous.dataset_version) {
    throw new Error('Corrected release precondition failed: active manifest dataset version differs from current.json')
  }
  if (activeManifest.source_dataset_version !== ciGate.expected_current_source_dataset_version) {
    throw new Error(`Corrected release precondition failed: active source dataset is ${activeManifest.source_dataset_version || 'missing'}`)
  }
}
const previousDatasetVersion = await rollbackVersionOrNull(root, previous?.dataset_version, cloudEnvId)
if (previous?.dataset_version && !previousDatasetVersion) {
  console.warn(`Current remote version ${previous.dataset_version} is not an eligible rollback target; previous_dataset_version will be null`)
}

let previousAudit = null
if (previousDatasetVersion && previousDatasetVersion !== datasetVersion) {
  previousAudit = await readRollbackEligibleAudit(root, previousDatasetVersion, cloudEnvId)
  const previousManifestPath = resolve(localRoot, 'previous-manifest.json')
  await rm(previousManifestPath, { force: true })
  await cloud.downloadObject(`housing-data/releases/${previousDatasetVersion}/manifest.json`, previousManifestPath)
  if (sha256(await readFile(previousManifestPath, 'utf8')) !== previousAudit.manifest_sha256) throw new Error('Previous release is not a verified rollback target')
}

if (!releaseAlreadyUploaded) {
  await cloud.uploadFile(resolve(localRoot, 'bootstrap.json'), `${cloudRoot}/bootstrap.json`)
  await cloud.uploadDirectory(resolve(localRoot, 'cities'), `${cloudRoot}/cities`)
  await cloud.uploadFile(resolve(localRoot, 'manifest.json'), `${cloudRoot}/manifest.json`)
}

async function verifyCompleteRemoteRelease(label) {
  const verifyRoot = resolve(localRoot, label)
  await rm(verifyRoot, { recursive: true, force: true })
  await mkdir(verifyRoot, { recursive: true })
  const downloadedRoot = verifyRoot
  await cloud.downloadObject(`${cloudRoot}/manifest.json`, resolve(downloadedRoot, 'manifest.json'))
  await cloud.downloadObject(`${cloudRoot}/bootstrap.json`, resolve(downloadedRoot, 'bootstrap.json'))
  await mkdir(resolve(downloadedRoot, 'cities'), { recursive: true })
  for (const cityId of Object.keys(manifest.city_files)) {
    const cityPath = resolve(downloadedRoot, 'cities', `${cityId}.json`)
    await cloud.downloadObject(`${cloudRoot}/cities/${cityId}.json`, cityPath)
  }
  await copyFile(resolve(localRoot, 'current.candidate.json'), resolve(downloadedRoot, 'current.candidate.json'))
  const remoteManifestText = await readFile(resolve(downloadedRoot, 'manifest.json'), 'utf8')
  if (sha256(remoteManifestText) !== report.manifest_sha256) throw new Error('Remote manifest hash differs from staged manifest')
  await execFileAsync(process.execPath, [resolve(root, 'scripts/miniprogram/verify-remote-data.mjs'), `--dir=${downloadedRoot}`], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
}

await verifyCompleteRemoteRelease('remote-verify-before-switch')

const auditDir = resolve(root, 'data/releases')
await mkdir(auditDir, { recursive: true })
async function writeOrVerifyPublishAudit(audit) {
  const path = resolve(auditDir, `${datasetVersion}.json`)
  try {
    const existingAudit = JSON.parse(await readFile(path, 'utf8'))
    if (existingAudit.status !== 'published' || existingAudit.dataset_version !== datasetVersion || existingAudit.manifest_sha256 !== report.manifest_sha256 || existingAudit.cloud_env_id !== cloudEnvId) throw new Error('Existing local publish audit differs from the active release')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await writeFile(path, `${JSON.stringify(audit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  }
}

console.log(JSON.stringify({
  target_env: cloudEnvId,
  dataset_version: datasetVersion,
  dataset_as_of: report.dataset_as_of,
  official_url: report.official_url,
  source_batch_ids: report.source_batch_ids,
  bootstrap_bytes: report.bootstrap_bytes,
  total_release_bytes: report.total_release_bytes,
  previous_dataset_version: previousDatasetVersion,
  manifest_sha256: report.manifest_sha256,
}, null, 2))
if (previous?.dataset_version === datasetVersion) {
  if (previous.manifest_sha256 !== report.manifest_sha256 || previous.manifest_file_id !== manifest.bootstrap_file_id.replace(/\/bootstrap\.json$/, '/manifest.json')) throw new Error('Active dataset version matches but pointer contents differ')
  const invocation = await cloud.invokeFunction('getHousingDataManifest')
  validateManifestFunctionOutput(JSON.stringify(invocation), previous)
  await verifyCompleteRemoteRelease('remote-verify-idempotent')
  const idempotentAudit = { ...report, status: 'published', published_at: previous.published_at, previous_dataset_version: previous.previous_dataset_version, current_sha256: sha256(stableJson(previous)), github_run_id: ciMode ? process.env.GITHUB_RUN_ID : null, commit_sha: ciMode ? process.env.CI_COMMIT_SHA : null, idempotent_recovery: true }
  await writeOrVerifyPublishAudit(idempotentAudit)
  console.log(`Dataset ${datasetVersion} is already active and passed the full idempotent guard`)
  process.exit(0)
}
if (!ciMode) {
  if (!stdin.isTTY) throw new Error('Interactive terminal required for final current.json switch')
  const prompt = createInterface({ input: stdin, output: stdout })
  const confirmation = await prompt.question(`输入完整数据版本 ${datasetVersion} 以切换线上 current.json：`)
  prompt.close()
  if (confirmation.trim() !== datasetVersion) throw new Error('Publish cancelled: dataset version confirmation did not match')
}

const current = JSON.parse(await readFile(resolve(localRoot, 'current.candidate.json'), 'utf8'))
current.published_at = new Date().toISOString()
current.previous_dataset_version = previousDatasetVersion
const confirmedCurrentPath = resolve(localRoot, 'current.confirmed.json')
const confirmedCurrentText = stableJson(current)
await writeFile(confirmedCurrentPath, confirmedCurrentText, 'utf8')
await activatePointerWithRollback({
  candidate: current,
  candidateText: confirmedCurrentText,
  previous,
  rollbackEligible: Boolean(previousDatasetVersion && previousAudit && previous),
  writePointer: async (text, label) => {
    const path = resolve(localRoot, `current.${label}.json`)
    await writeFile(path, text, 'utf8')
    await cloud.uploadFile(path, 'housing-data/current.json')
  },
  readPointerText: async (label) => {
    const path = resolve(localRoot, `current.${label}.roundtrip.json`)
    await rm(path, { force: true })
    await cloud.downloadObject('housing-data/current.json', path)
    return readFile(path, 'utf8')
  },
  guardCandidate: async () => {
    const invocation = await cloud.invokeFunction('getHousingDataManifest')
    validateManifestFunctionOutput(JSON.stringify(invocation), current)
    await verifyCompleteRemoteRelease('remote-verify-after-switch')
    if (previousDatasetVersion && !previousAudit) throw new Error('Previous release lost rollback eligibility after pointer switch')
  },
  guardRollback: async (rollbackPointer) => {
    const invocation = await cloud.invokeFunction('getHousingDataManifest')
    validateManifestFunctionOutput(JSON.stringify(invocation), rollbackPointer)
  },
  recordRollback: async ({ failedAt, guardError, rollbackPointer, rollbackText }) => {
    const rollbackAudit = { status: 'automatically_rolled_back', rolled_back_at: failedAt, from_dataset_version: datasetVersion, to_dataset_version: rollbackPointer.dataset_version, cloud_env_id: cloudEnvId, trigger_error: String(guardError?.message || guardError), current_sha256: sha256(rollbackText), github_run_id: ciMode ? process.env.GITHUB_RUN_ID : null, commit_sha: ciMode ? process.env.CI_COMMIT_SHA : null }
    await writeFile(resolve(auditDir, `rollback-${failedAt.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(rollbackAudit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  },
  recordFailure: async ({ failedAt, guardError, rollbackStatus, rollbackError }) => {
    const failureAudit = { status: 'post_publish_guard_failed', failed_at: failedAt, dataset_version: datasetVersion, previous_dataset_version: previousDatasetVersion, cloud_env_id: cloudEnvId, guard_error: String(guardError?.message || guardError), rollback_status: rollbackStatus, rollback_error: rollbackError ? String(rollbackError?.message || rollbackError) : null, github_run_id: ciMode ? process.env.GITHUB_RUN_ID : null, commit_sha: ciMode ? process.env.CI_COMMIT_SHA : null }
    await writeFile(resolve(auditDir, `failed-publish-${failedAt.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(failureAudit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  },
})
const audit = { ...report, status: 'published', published_at: current.published_at, previous_dataset_version: current.previous_dataset_version, current_sha256: sha256(confirmedCurrentText), github_run_id: ciMode ? process.env.GITHUB_RUN_ID : null, commit_sha: ciMode ? process.env.CI_COMMIT_SHA : null }
await writeOrVerifyPublishAudit(audit)
console.log(`Published ${datasetVersion}; current.json round-trip verification passed`)
