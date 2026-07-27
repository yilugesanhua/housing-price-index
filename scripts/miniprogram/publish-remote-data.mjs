import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { isMissingCloudFile, runTcb, tcbPlanForRelease } from './cloudbase-cli.mjs'
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
if (ciMode) await authorizeCiRelease({ root, datasetVersion, cloudEnvId })
const plan = tcbPlanForRelease(datasetVersion, cloudEnvId, localRoot)
if (dryRun) {
  console.log(JSON.stringify({ dry_run: true, dataset_version: datasetVersion, cloud_env_id: cloudEnvId, commands: plan.map((args) => ['tcb', ...args]) }, null, 2))
  process.exit(0)
}

await runTcb(['env', 'list', '--json'])
const cloudRoot = `housing-data/releases/${datasetVersion}`
const existing = await runTcb(['storage', 'detail', `${cloudRoot}/manifest.json`, '--json', '-e', cloudEnvId], { allowFailure: true })
let releaseAlreadyUploaded = false
if (existing.ok) {
  const existingManifestPath = resolve(localRoot, 'existing-remote-manifest.json')
  await rm(existingManifestPath, { force: true })
  await runTcb(['storage', 'download', `${cloudRoot}/manifest.json`, existingManifestPath, '--json', '-e', cloudEnvId])
  if (sha256(await readFile(existingManifestPath, 'utf8')) !== report.manifest_sha256) {
    throw new Error(`Immutable remote release already exists with different content: ${datasetVersion}`)
  }
  releaseAlreadyUploaded = true
} else if (!isMissingCloudFile(existing)) {
  throw new Error(`Could not prove the remote release path is unused:\n${existing.stderr || existing.stdout}`)
}

let previous = null
const previousPath = resolve(localRoot, 'previous-current.json')
await rm(previousPath, { force: true })
const previousDownload = await runTcb(['storage', 'download', 'housing-data/current.json', previousPath, '--json', '-e', cloudEnvId], { allowFailure: true })
if (previousDownload.ok) previous = JSON.parse(await readFile(previousPath, 'utf8'))
else if (!isMissingCloudFile(previousDownload)) throw new Error(`Could not read the current remote pointer:\n${previousDownload.stderr || previousDownload.stdout}`)
const previousDatasetVersion = await rollbackVersionOrNull(root, previous?.dataset_version, cloudEnvId)
if (previous?.dataset_version && !previousDatasetVersion) {
  console.warn(`Current remote version ${previous.dataset_version} is not an eligible rollback target; previous_dataset_version will be null`)
}

let previousAudit = null
if (previousDatasetVersion && previousDatasetVersion !== datasetVersion) {
  previousAudit = await readRollbackEligibleAudit(root, previousDatasetVersion, cloudEnvId)
  const previousManifestPath = resolve(localRoot, 'previous-manifest.json')
  await rm(previousManifestPath, { force: true })
  await runTcb(['storage', 'download', `housing-data/releases/${previousDatasetVersion}/manifest.json`, previousManifestPath, '--json', '-e', cloudEnvId])
  if (sha256(await readFile(previousManifestPath, 'utf8')) !== previousAudit.manifest_sha256) throw new Error('Previous release is not a verified rollback target')
}

if (!releaseAlreadyUploaded) {
  await runTcb(['storage', 'upload', resolve(localRoot, 'bootstrap.json'), `${cloudRoot}/bootstrap.json`, '--times', '3', '--json', '-e', cloudEnvId])
  await runTcb(['storage', 'upload', resolve(localRoot, 'cities'), `${cloudRoot}/cities`, '--times', '3', '--json', '-e', cloudEnvId])
  await runTcb(['storage', 'upload', resolve(localRoot, 'manifest.json'), `${cloudRoot}/manifest.json`, '--times', '3', '--json', '-e', cloudEnvId])
}

async function verifyCompleteRemoteRelease(label) {
  const verifyRoot = resolve(localRoot, label)
  await rm(verifyRoot, { recursive: true, force: true })
  await mkdir(verifyRoot, { recursive: true })
  await runTcb(['storage', 'download', `${cloudRoot}/`, verifyRoot, '--dir', '--json', '-e', cloudEnvId])
  const candidates = [verifyRoot, resolve(verifyRoot, datasetVersion)]
  let downloadedRoot = null
  for (const candidate of candidates) {
    try { await readFile(resolve(candidate, 'manifest.json'), 'utf8'); downloadedRoot = candidate; break } catch (_) {}
  }
  if (!downloadedRoot) throw new Error('Remote release download did not contain manifest.json at an expected path')
  await mkdir(resolve(downloadedRoot, 'cities'), { recursive: true })
  for (const cityId of Object.keys(manifest.city_files)) {
    const cityPath = resolve(downloadedRoot, 'cities', `${cityId}.json`)
    try {
      await readFile(cityPath, 'utf8')
    } catch (_) {
      await runTcb(['storage', 'download', `${cloudRoot}/cities/${cityId}.json`, cityPath, '--json', '-e', cloudEnvId])
    }
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
  const invocation = await runTcb(['fn', 'invoke', 'getHousingDataManifest', '--json', '-e', cloudEnvId])
  validateManifestFunctionOutput(invocation.stdout, previous)
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
    await runTcb(['storage', 'upload', path, 'housing-data/current.json', '--times', '3', '--json', '-e', cloudEnvId])
  },
  readPointerText: async (label) => {
    const path = resolve(localRoot, `current.${label}.roundtrip.json`)
    await rm(path, { force: true })
    await runTcb(['storage', 'download', 'housing-data/current.json', path, '--json', '-e', cloudEnvId])
    return readFile(path, 'utf8')
  },
  guardCandidate: async () => {
    const invocation = await runTcb(['fn', 'invoke', 'getHousingDataManifest', '--json', '-e', cloudEnvId])
    validateManifestFunctionOutput(invocation.stdout, current)
    await verifyCompleteRemoteRelease('remote-verify-after-switch')
    if (previousDatasetVersion && !previousAudit) throw new Error('Previous release lost rollback eligibility after pointer switch')
  },
  guardRollback: async (rollbackPointer) => {
    const invocation = await runTcb(['fn', 'invoke', 'getHousingDataManifest', '--json', '-e', cloudEnvId])
    validateManifestFunctionOutput(invocation.stdout, rollbackPointer)
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
