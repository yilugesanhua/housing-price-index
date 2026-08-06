import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createTencentCloudClient, isMissingObjectError } from './tencent-cloud-sdk.mjs'
import { sha256, stableJson } from './remote-data-lib.mjs'
import { readRollbackEligibleAudit, rollbackVersionOrNull } from './release-audit-lib.mjs'
import { authorizeCiRelease } from './ci-release-authorization.mjs'
import { buildAutomaticRollbackPointer, validateManifestFunctionOutput } from './post-publish-guard.mjs'
import { activatePointerWithRollback } from './guarded-activation.mjs'
import { assertPointerBaseline, assertProductionPointerBaseline, validateHistoricalCorrectionPublishState } from './publish-remote-data-guards.mjs'
import {
  appendFailedReleaseRevocations,
  appendRevocations,
  assertRollbackClosure,
  assertTargetNotRevoked,
  buildControlValidUntil,
  buildRollbackRevisionId,
  buildRevocationRegistryArtifact,
  classifyControlPointer,
  createRevocationRegistry,
  validateControlPointer,
  validateRevocationRegistry,
  validateRevocationRegistryArtifact,
} from './control-plane.mjs'

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
if (!dryRun && !ciMode) throw new Error('Production publication is allowed only in an authorized GitHub Actions workflow; use --dry-run locally')
const ciGate = dryRun ? null : await authorizeCiRelease({ root, datasetVersion, cloudEnvId })
const cloudRoot = `housing-data/releases/${datasetVersion}`
const plan = [
  ['putObject', `${cloudRoot}/bootstrap.json`],
  ['putObject', `${cloudRoot}/cities/<70-city-files>.json`],
  ...(manifest.release_type === 'historical_correction' ? [['putObject', `${cloudRoot}/revision-manifest.json`]] : []),
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
let previousCurrentText = null
const previousPath = resolve(localRoot, 'previous-current.json')
await rm(previousPath, { force: true })
try {
  await cloud.downloadObject('housing-data/current.json', previousPath)
  previousCurrentText = await readFile(previousPath, 'utf8')
  previous = JSON.parse(previousCurrentText)
} catch (error) {
  if (!isMissingObjectError(error)) throw error
}
const previousPointerState = assertProductionPointerBaseline(previous)
async function readRemoteCurrentTextOrNull() {
  try {
    return (await cloud.getObject('housing-data/current.json')).toString('utf8')
  } catch (error) {
    if (isMissingObjectError(error)) return null
    throw error
  }
}
async function assertRemoteCurrentBaseline(expectedText, label) {
  return assertPointerBaseline(await readRemoteCurrentTextOrNull(), expectedText, label)
}
let previousManifest = null
if (previous?.dataset_version) {
  const previousManifestPath = resolve(localRoot, 'previous-manifest.json')
  await rm(previousManifestPath, { force: true })
  await cloud.downloadObject(`housing-data/releases/${previous.dataset_version}/manifest.json`, previousManifestPath)
  const previousManifestText = await readFile(previousManifestPath, 'utf8')
  if (sha256(previousManifestText) !== previous.manifest_sha256) throw new Error('Active manifest hash differs from current.json')
  previousManifest = JSON.parse(previousManifestText)
  if (previousManifest.dataset_version !== previous.dataset_version) throw new Error('Active manifest dataset version differs from current.json')
}
let stagedRevisionManifestText = null
let stagedRevisionManifest = null
function requireRevisionManifestText() {
  if (!stagedRevisionManifestText) throw new Error('Historical correction revision manifest is unavailable')
  return stagedRevisionManifestText
}
if (manifest.release_type === 'historical_correction') {
  stagedRevisionManifestText = await readFile(resolve(localRoot, 'revision-manifest.json'), 'utf8')
  stagedRevisionManifest = JSON.parse(stagedRevisionManifestText)
}
if (ciGate?.gate_type === 'manual_corrected_release') {
  if (previous?.dataset_version !== ciGate.expected_current_dataset_version) {
    throw new Error(`Corrected release precondition failed: active dataset is ${previous?.dataset_version || 'missing'}`)
  }
  if (previousManifest.source_dataset_version !== ciGate.expected_current_source_dataset_version) {
    throw new Error(`Corrected release precondition failed: active source dataset is ${previousManifest.source_dataset_version || 'missing'}`)
  }
}
if (ciGate?.gate_type === 'historical_data_correction') {
  const activeRegistry = previous?.dataset_version === datasetVersion
    ? await loadBaseRevocationRegistry(previous.control_generated_at)
    : null
  validateHistoricalCorrectionPublishState({
    previous,
    previousManifest,
    candidateManifest: manifest,
    candidateRevisionManifest: stagedRevisionManifest,
    registry: activeRegistry,
    gate: ciGate,
    datasetVersion,
    cloudEnvId,
    storageBucket: cloud.bucket,
  })
}
let previousDatasetVersion = await rollbackVersionOrNull(root, previous?.dataset_version, cloudEnvId)
if (ciGate?.gate_type === 'historical_data_correction') previousDatasetVersion = null
if (previous?.dataset_version && !previousDatasetVersion) {
  console.warn(`Current remote version ${previous.dataset_version} is not an eligible rollback target; previous_dataset_version will be null`)
}

let previousAudit = null
if (previousDatasetVersion && previousDatasetVersion !== datasetVersion) {
  previousAudit = await readRollbackEligibleAudit(root, previousDatasetVersion, cloudEnvId)
  if (previous?.dataset_version !== previousDatasetVersion || !previousManifest || previous.manifest_sha256 !== previousAudit.manifest_sha256) throw new Error('Previous release is not a verified rollback target')
}

async function loadBaseRevocationRegistry(generatedAt) {
  if (previousPointerState === 'controlled') {
    const expectedKey = `housing-data/control/revocations-${previous.revocations_sha256}.json`
    const expectedFileId = `cloud://${cloudEnvId}.${cloud.bucket}/${expectedKey}`
    if (previous.revocations_file_id !== expectedFileId) throw new Error('Active revocations file ID is invalid')
    const text = (await cloud.getObject(expectedKey)).toString('utf8')
    if (sha256(text) !== previous.revocations_sha256) throw new Error('Active revocations registry hash mismatch')
    const registry = validateRevocationRegistry(JSON.parse(text))
    if (registry.generation !== previous.revocations_generation) throw new Error('Active revocations registry generation mismatch')
    validateControlPointer(previous, {
      allowLegacy: false,
      requireContext: true,
      manifest: previousManifest,
      registry,
      cloudEnvId,
      storageBucket: cloud.bucket,
    })
    return registry
  }
  if (previousPointerState !== 'absent') throw new Error('Unexpected production pointer state')
  return createRevocationRegistry({ generatedAt })
}

if (previous?.transition_type === 'rollback' && previous.rollback_from_dataset_version === datasetVersion) {
  const activeRegistry = await loadBaseRevocationRegistry(previous.control_generated_at)
  assertRollbackClosure(activeRegistry, {
    failedDatasetVersion: datasetVersion,
    failedSourceDatasetVersion: manifest.source_dataset_version,
    targetDatasetVersion: previous.dataset_version,
    targetSourceDatasetVersion: previous.source_dataset_version,
    revisionId: buildRollbackRevisionId(datasetVersion),
  })
  validateControlPointer(previous, {
    allowLegacy: false,
    requireContext: true,
    manifest: previousManifest,
    registry: activeRegistry,
    cloudEnvId,
    storageBucket: cloud.bucket,
  })
  const invocation = await cloud.invokeFunction('getHousingDataManifest')
  validateManifestFunctionOutput(JSON.stringify(invocation), previous)
  await assertRemoteCurrentBaseline(previousCurrentText, 'active rollback protection')
  throw new Error(`Candidate ${datasetVersion} is already revoked by the active rollback and cannot be republished`)
}

function addCandidateRevocations(registry, generatedAt) {
  if (manifest.release_type !== 'historical_correction') return registry
  const revision = JSON.parse(requireRevisionManifestText())
  const existingDatasets = new Set(registry.revoked_dataset_versions.map((entry) => entry.dataset_version))
  const existing = new Set(registry.revoked_source_dataset_versions.map((entry) => entry.source_dataset_version))
  const datasetRevocations = previous?.dataset_version
    && previous.dataset_version !== datasetVersion
    && !existingDatasets.has(previous.dataset_version)
    ? [{
        dataset_version: previous.dataset_version,
        revoked_at: new Date(revision.approved_at).toISOString(),
        revision_id: revision.revision_id,
        replacement_dataset_version: datasetVersion,
        reason: revision.reason,
      }]
    : []
  const additions = (revision.revoked_source_dataset_versions || [])
    .filter((sourceDatasetVersion) => !existing.has(sourceDatasetVersion))
    .map((sourceDatasetVersion) => ({
      source_dataset_version: sourceDatasetVersion,
      revoked_at: new Date(revision.approved_at).toISOString(),
      revision_id: revision.revision_id,
      replacement_source_dataset_version: manifest.source_dataset_version,
      reason: revision.reason,
    }))
  return datasetRevocations.length || additions.length
    ? appendRevocations(registry, { generatedAt, datasetRevocations, sourceDatasetRevocations: additions })
    : registry
}

async function uploadRevocationRegistry(artifact) {
  validateRevocationRegistryArtifact(artifact)
  if (await cloud.objectExists(artifact.cosKey)) {
    const existingText = (await cloud.getObject(artifact.cosKey)).toString('utf8')
    if (existingText !== artifact.text) throw new Error('Immutable revocations registry already exists with different content')
  } else {
    await cloud.putObject(artifact.cosKey, Buffer.from(artifact.text, 'utf8'))
  }
  const roundTrip = (await cloud.getObject(artifact.cosKey)).toString('utf8')
  if (roundTrip !== artifact.text) throw new Error('Revocations registry round-trip verification failed')
}

if (!releaseAlreadyUploaded) {
  await cloud.uploadFile(resolve(localRoot, 'bootstrap.json'), `${cloudRoot}/bootstrap.json`)
  await cloud.uploadDirectory(resolve(localRoot, 'cities'), `${cloudRoot}/cities`)
  if (manifest.release_type === 'historical_correction') await cloud.uploadFile(resolve(localRoot, 'revision-manifest.json'), `${cloudRoot}/revision-manifest.json`)
  await cloud.uploadFile(resolve(localRoot, 'manifest.json'), `${cloudRoot}/manifest.json`)
}

async function verifyCompleteRemoteRelease(label) {
  const verifyRoot = resolve(localRoot, label)
  await rm(verifyRoot, { recursive: true, force: true })
  await mkdir(verifyRoot, { recursive: true })
  const downloadedRoot = verifyRoot
  await cloud.downloadObject(`${cloudRoot}/manifest.json`, resolve(downloadedRoot, 'manifest.json'))
  await cloud.downloadObject(`${cloudRoot}/bootstrap.json`, resolve(downloadedRoot, 'bootstrap.json'))
  if (manifest.release_type === 'historical_correction') await cloud.downloadObject(`${cloudRoot}/revision-manifest.json`, resolve(downloadedRoot, 'revision-manifest.json'))
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

async function verifyRollbackTargetRelease(pointer, registry, label) {
  if (!pointer || pointer.dataset_version !== previous?.dataset_version || !previousManifest || !previousAudit) {
    throw new Error('Rollback target is not the verified active release')
  }
  if (previousAudit.manifest_sha256 !== pointer.manifest_sha256
    || previousAudit.source_dataset_version !== pointer.source_dataset_version) {
    throw new Error('Rollback audit identity differs from the active pointer')
  }
  const targetRoot = resolve(localRoot, label)
  const targetReleaseRoot = `housing-data/releases/${pointer.dataset_version}`
  await rm(targetRoot, { recursive: true, force: true })
  await mkdir(resolve(targetRoot, 'cities'), { recursive: true })
  await cloud.downloadObject(`${targetReleaseRoot}/manifest.json`, resolve(targetRoot, 'manifest.json'))
  const targetManifestText = await readFile(resolve(targetRoot, 'manifest.json'), 'utf8')
  if (sha256(targetManifestText) !== pointer.manifest_sha256) throw new Error('Rollback target manifest hash differs from its pointer')
  const targetManifest = JSON.parse(targetManifestText)
  if (targetManifest.dataset_version !== pointer.dataset_version
    || targetManifest.source_dataset_version !== pointer.source_dataset_version) {
    throw new Error('Rollback target manifest identity differs from its pointer')
  }
  await cloud.downloadObject(`${targetReleaseRoot}/bootstrap.json`, resolve(targetRoot, 'bootstrap.json'))
  if (targetManifest.release_type === 'historical_correction') {
    await cloud.downloadObject(`${targetReleaseRoot}/revision-manifest.json`, resolve(targetRoot, 'revision-manifest.json'))
  }
  for (const cityId of Object.keys(targetManifest.city_files || {})) {
    await cloud.downloadObject(`${targetReleaseRoot}/cities/${cityId}.json`, resolve(targetRoot, 'cities', `${cityId}.json`))
  }
  if (Object.keys(targetManifest.city_files || {}).length !== 70) throw new Error('Rollback target does not contain 70 city shards')
  await writeFile(resolve(targetRoot, 'current.candidate.json'), stableJson(pointer), 'utf8')
  await execFileAsync(process.execPath, [resolve(root, 'scripts/miniprogram/verify-remote-data.mjs'), `--dir=${targetRoot}`, '--integrity-only'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  assertTargetNotRevoked(registry, {
    datasetVersion: pointer.dataset_version,
    sourceDatasetVersion: pointer.source_dataset_version,
  })
  validateControlPointer(pointer, {
    allowLegacy: false,
    requireContext: true,
    manifest: targetManifest,
    registry,
    cloudEnvId,
    storageBucket: cloud.bucket,
  })
  return targetManifest
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

async function writeOrVerifyCorrectionAudit(supersededDatasetVersion, recordedAt) {
  if (ciGate?.gate_type !== 'historical_data_correction' || !supersededDatasetVersion) return
  const correctionAudit = {
    status: 'superseded_by_audited_historical_correction', dataset_version: supersededDatasetVersion,
    source_dataset_version: ciGate.supersedes_source_dataset_version, superseded_by_dataset_version: datasetVersion,
    revision_id: ciGate.revision_id, rollback_allowed: false,
    reason: 'superseded by an approved and fully audited historical correction', recorded_at: recordedAt,
    cloud_env_id: cloudEnvId, commit_sha: process.env.CI_COMMIT_SHA, github_run_id: process.env.GITHUB_RUN_ID,
  }
  const path = resolve(auditDir, `${supersededDatasetVersion}.correction.json`)
  try {
    const existingAudit = JSON.parse(await readFile(path, 'utf8'))
    if (existingAudit.dataset_version !== supersededDatasetVersion || existingAudit.superseded_by_dataset_version !== datasetVersion || existingAudit.revision_id !== ciGate.revision_id || existingAudit.rollback_allowed !== false) throw new Error('Existing correction audit differs from the active correction')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await writeFile(path, `${JSON.stringify(correctionAudit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
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
  if (classifyControlPointer(previous) !== 'controlled') {
    throw new Error('Active dataset still uses a legacy current.json; idempotent publish cannot silently migrate control state')
  }
  if (previous.manifest_sha256 !== report.manifest_sha256 || previous.manifest_file_id !== manifest.bootstrap_file_id.replace(/\/bootstrap\.json$/, '/manifest.json')) throw new Error('Active dataset version matches but pointer contents differ')
  if (previous.source_dataset_version !== previousManifest.source_dataset_version) throw new Error('Active source dataset version differs from its manifest')
  const activeRegistry = await loadBaseRevocationRegistry(previous.control_generated_at)
  assertTargetNotRevoked(activeRegistry, {
    datasetVersion: previous.dataset_version,
    sourceDatasetVersion: previousManifest.source_dataset_version,
  })
  const invocation = await cloud.invokeFunction('getHousingDataManifest')
  validateManifestFunctionOutput(JSON.stringify(invocation), previous)
  await verifyCompleteRemoteRelease('remote-verify-idempotent')
  await assertRemoteCurrentBaseline(previousCurrentText, 'idempotent recovery completion')
  const idempotentAudit = { ...report, status: 'published', published_at: previous.published_at, previous_dataset_version: previous.previous_dataset_version, current_sha256: sha256(stableJson(previous)), github_run_id: ciMode ? process.env.GITHUB_RUN_ID : null, github_run_attempt: ciMode ? process.env.GITHUB_RUN_ATTEMPT : null, commit_sha: ciMode ? process.env.CI_COMMIT_SHA : null, release_authorization: ciGate?.release_authorization ?? null, idempotent_recovery: true }
  await writeOrVerifyPublishAudit(idempotentAudit)
  await writeOrVerifyCorrectionAudit(previous.superseded_dataset_version, previous.published_at)
  console.log(`Dataset ${datasetVersion} is already active and passed the full idempotent guard`)
  process.exit(0)
}
const current = JSON.parse(await readFile(resolve(localRoot, 'current.candidate.json'), 'utf8'))
current.published_at = new Date().toISOString()
current.previous_dataset_version = previousDatasetVersion
const baseRevocationRegistry = await loadBaseRevocationRegistry(current.published_at)
let revocationRegistry = baseRevocationRegistry
revocationRegistry = addCandidateRevocations(revocationRegistry, current.published_at)
const revocationArtifact = buildRevocationRegistryArtifact(revocationRegistry, { cloudEnvId, storageBucket: cloud.bucket })
assertTargetNotRevoked(revocationRegistry, { datasetVersion, sourceDatasetVersion: manifest.source_dataset_version })
if (previousDatasetVersion && previousManifest) {
  try {
    assertTargetNotRevoked(revocationRegistry, {
      datasetVersion: previousDatasetVersion,
      sourceDatasetVersion: previousManifest.source_dataset_version,
    })
  } catch (error) {
    console.warn(`Previous remote version ${previousDatasetVersion} is revoked; automatic rollback is disabled: ${error.message}`)
    previousDatasetVersion = null
    previousAudit = null
    current.previous_dataset_version = null
  }
}
await uploadRevocationRegistry(revocationArtifact)
Object.assign(current, {
  source_dataset_version: manifest.source_dataset_version,
  control_schema_version: '1.0.0',
  control_generation: Number(previous?.control_generation || 0) + 1,
  ...revocationArtifact.currentFields,
  transition_type: manifest.release_type === 'historical_correction' ? 'historical_correction' : 'publish',
  data_status: 'current',
  status_reason: manifest.release_type === 'historical_correction' ? 'audited_historical_correction' : 'monthly_publish',
  control_generated_at: current.published_at,
  control_valid_until: buildControlValidUntil(current.published_at),
})
if (ciGate?.gate_type === 'historical_data_correction') {
  current.superseded_dataset_version = previous.dataset_version
  current.superseded_source_dataset_version = ciGate.supersedes_source_dataset_version
}
validateControlPointer(current, {
  allowLegacy: false,
  requireContext: true,
  manifest,
  registry: revocationRegistry,
  previousPointer: previous && classifyControlPointer(previous) === 'controlled' ? previous : undefined,
  previousRegistry: previous && classifyControlPointer(previous) === 'controlled' ? baseRevocationRegistry : undefined,
  cloudEnvId,
  storageBucket: cloud.bucket,
})
const confirmedCurrentPath = resolve(localRoot, 'current.confirmed.json')
const confirmedCurrentText = stableJson(current)
await writeFile(confirmedCurrentPath, confirmedCurrentText, 'utf8')
let rollbackRegistry = null
await activatePointerWithRollback({
  candidate: current,
  candidateText: confirmedCurrentText,
  previous,
  rollbackEligible: Boolean(previousDatasetVersion && previousAudit && previous),
  writePointer: async (text, label) => {
    if (label === 'candidate') {
      await assertRemoteCurrentBaseline(previousCurrentText, 'candidate activation')
    } else if (label === 'automatic-rollback') {
      await assertRemoteCurrentBaseline(confirmedCurrentText, 'automatic rollback')
    } else {
      throw new Error(`Unexpected pointer write label: ${label}`)
    }
    // COS has no object-level conditional put here; this narrows, but cannot eliminate, the final write race.
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
  verifyRollbackTarget: async (pointer) => {
    if (previousPointerState !== 'controlled' || previousDatasetVersion !== pointer?.dataset_version || !previousAudit) {
      throw new Error('Verified rollback target is unavailable')
    }
    const rollbackBaseRegistry = await loadBaseRevocationRegistry(pointer.control_generated_at)
    await verifyRollbackTargetRelease(pointer, rollbackBaseRegistry, 'remote-verify-rollback-target')
    validateManifestFunctionOutput(JSON.stringify(await cloud.invokeFunction('getHousingDataManifest')), pointer)
  },
  guardRollback: async (rollbackPointer) => {
    if (!rollbackRegistry) throw new Error('Automatic rollback registry was not prepared')
    await verifyRollbackTargetRelease(rollbackPointer, rollbackRegistry, 'remote-verify-automatic-rollback')
    const invocation = await cloud.invokeFunction('getHousingDataManifest')
    validateManifestFunctionOutput(JSON.stringify(invocation), rollbackPointer)
  },
  prepareRollback: async ({ failedAt, guardError }) => {
    const rollbackRevisionId = buildRollbackRevisionId(datasetVersion)
    rollbackRegistry = appendFailedReleaseRevocations(revocationRegistry, {
      datasetVersion,
      sourceDatasetVersion: manifest.source_dataset_version,
      revokedAt: failedAt,
      replacementDatasetVersion: previous.dataset_version,
      replacementSourceDatasetVersion: previousManifest.source_dataset_version,
      revisionId: rollbackRevisionId,
      reason: `post-publish guard failed: ${String(guardError?.message || guardError).slice(0, 400)}`,
    })
    const rollbackRegistryArtifact = buildRevocationRegistryArtifact(rollbackRegistry, { cloudEnvId, storageBucket: cloud.bucket })
    await uploadRevocationRegistry(rollbackRegistryArtifact)
    return buildAutomaticRollbackPointer(previous, datasetVersion, {
      rolledBackAt: failedAt,
      controlGeneration: current.control_generation + 1,
      registryArtifact: rollbackRegistryArtifact,
      failedSourceDatasetVersion: manifest.source_dataset_version,
      rollbackRevisionId,
      targetSourceDatasetVersion: previousManifest.source_dataset_version,
      targetManifest: previousManifest,
    })
  },
  recordRollback: async ({ failedAt, guardError, rollbackPointer, rollbackText }) => {
    const rollbackAudit = { status: 'automatically_rolled_back', rolled_back_at: failedAt, from_dataset_version: datasetVersion, to_dataset_version: rollbackPointer.dataset_version, cloud_env_id: cloudEnvId, storage_bucket: cloud.bucket, trigger_error: String(guardError?.message || guardError), current_sha256: sha256(rollbackText), github_run_id: ciMode ? process.env.GITHUB_RUN_ID : null, github_run_attempt: ciMode ? process.env.GITHUB_RUN_ATTEMPT : null, commit_sha: ciMode ? process.env.CI_COMMIT_SHA : null }
    await writeFile(resolve(auditDir, `rollback-${failedAt.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(rollbackAudit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  },
  recordFailure: async ({ failedAt, guardError, rollbackStatus, rollbackError }) => {
    const failureAudit = { status: 'post_publish_guard_failed', failed_at: failedAt, dataset_version: datasetVersion, previous_dataset_version: previousDatasetVersion, cloud_env_id: cloudEnvId, storage_bucket: cloud.bucket, guard_error: String(guardError?.message || guardError), rollback_status: rollbackStatus, rollback_error: rollbackError ? String(rollbackError?.message || rollbackError) : null, github_run_id: ciMode ? process.env.GITHUB_RUN_ID : null, github_run_attempt: ciMode ? process.env.GITHUB_RUN_ATTEMPT : null, commit_sha: ciMode ? process.env.CI_COMMIT_SHA : null }
    await writeFile(resolve(auditDir, `failed-publish-${failedAt.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(failureAudit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  },
})
const audit = { ...report, status: 'published', published_at: current.published_at, previous_dataset_version: current.previous_dataset_version, current_sha256: sha256(confirmedCurrentText), github_run_id: ciMode ? process.env.GITHUB_RUN_ID : null, github_run_attempt: ciMode ? process.env.GITHUB_RUN_ATTEMPT : null, commit_sha: ciMode ? process.env.CI_COMMIT_SHA : null, release_authorization: ciGate?.release_authorization ?? null }
await writeOrVerifyPublishAudit(audit)
await writeOrVerifyCorrectionAudit(previous?.dataset_version, current.published_at)
console.log(`Published ${datasetVersion}; current.json round-trip verification passed`)
