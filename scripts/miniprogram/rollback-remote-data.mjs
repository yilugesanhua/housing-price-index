import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createTencentCloudClient } from './tencent-cloud-sdk.mjs'
import { sha256, stableJson } from './remote-data-lib.mjs'
import { readRollbackEligibleAudit } from './release-audit-lib.mjs'
import {
  appendFailedReleaseRevocations,
  assertRollbackClosure,
  assertTargetNotRevoked,
  buildRevocationRegistryArtifact,
  buildRollbackRevisionId,
  validateControlPointer,
  validateRevocationRegistry,
} from './control-plane.mjs'
import { buildAutomaticRollbackPointer, validateManifestFunctionOutput } from './post-publish-guard.mjs'
import { assertProductionPointerBaseline } from './publish-remote-data-guards.mjs'
import { authorizeCiRollback } from './ci-rollback-authorization.mjs'
import {
  assertManualRollbackWriteOrigin,
  buildManualRollbackAudit,
  buildManualRollbackIntent,
  classifyManualRollbackIntentState,
  manualRollbackAuditFileName,
  manualRollbackIntentFileName,
  manualRollbackIntentText,
  parseManualRollbackIntentText,
  validateManualRollbackAudit,
} from './manual-rollback-intent.mjs'

const root = resolve(import.meta.dirname, '../..')
const execFileAsync = promisify(execFile)
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const datasetVersion = argument('dataset')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const verifyIntentPath = argument('verify-intent')
const applyIntentPath = argument('apply-intent')
const originRunId = argument('origin-run-id')
const originRunAttempt = argument('origin-run-attempt')
const originCommitSha = argument('origin-commit-sha')
const prepareIntent = process.argv.includes('--prepare-intent')
const apply = process.argv.includes('--apply')

if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || '')) throw new Error('Use --dataset=<existing-version>')
if ([Boolean(verifyIntentPath), prepareIntent, Boolean(applyIntentPath)].filter(Boolean).length !== 1) {
  throw new Error('Choose exactly one of --verify-intent, --prepare-intent, or --apply-intent')
}
if (apply !== Boolean(applyIntentPath)) throw new Error('--apply is allowed only together with --apply-intent=<path>')
if (!/^[a-f0-9]{40}$/.test(originCommitSha || '')
  || !/^\d+$/.test(originRunId || '')
  || !/^[1-9]\d*$/.test(originRunAttempt || '')) {
  throw new Error('Use exact --origin-commit-sha=<40-hex>, --origin-run-id=<digits>, and --origin-run-attempt=<positive-integer>')
}

function resolveRepositoryFile(input, label) {
  if (!input || isAbsolute(input)) throw new Error(`${label} must be a repository-relative path`)
  const absolutePath = resolve(root, input)
  const repositoryRelativePath = relative(root, absolutePath)
  if (!repositoryRelativePath || repositoryRelativePath.startsWith('..') || isAbsolute(repositoryRelativePath)) {
    throw new Error(`${label} must remain inside the repository`)
  }
  return absolutePath
}

if (verifyIntentPath) {
  const intentPath = resolveRepositoryFile(verifyIntentPath, '--verify-intent')
  const intentText = await readFile(intentPath, 'utf8')
  const intent = parseManualRollbackIntentText(intentText, {
    expectedCommitSha: originCommitSha,
    expectedGithubRunId: originRunId,
    expectedGithubRunAttempt: originRunAttempt,
    expectedDatasetVersion: datasetVersion,
    expectedCloudEnvId: cloudEnvId,
  })
  if (basename(intentPath) !== manualRollbackIntentFileName(intentText)) throw new Error('Rollback intent filename does not match its immutable content hash')
  console.log(JSON.stringify({
    verified: true,
    dataset_version: intent.to_dataset_version,
    intent_file: relative(root, intentPath).replaceAll('\\', '/'),
    intent_sha256: sha256(intentText),
    origin_commit_sha: intent.commit_sha,
    origin_github_run_id: intent.github_run_id,
    production_writes: 0,
  }))
  process.exit(0)
}

const authorization = await authorizeCiRollback({ root, datasetVersion, cloudEnvId })
if (prepareIntent && (process.env.GITHUB_RUN_ID !== originRunId
  || process.env.GITHUB_RUN_ATTEMPT !== originRunAttempt
  || process.env.CI_COMMIT_SHA !== originCommitSha)) {
  throw new Error('A new run may reuse an immutable rollback intent but may not prepare one for another origin')
}

const audit = await readRollbackEligibleAudit(root, datasetVersion, cloudEnvId)
const workRoot = resolve(root, 'work/miniprogram-data/rollback', datasetVersion)
const cloud = createTencentCloudClient({ cloudEnvId })

async function resetWorkRoot() {
  await rm(workRoot, { recursive: true, force: true })
  await mkdir(workRoot, { recursive: true })
}

async function downloadAndVerifyTarget(label) {
  const targetRoot = resolve(workRoot, label)
  await mkdir(resolve(targetRoot, 'cities'), { recursive: true })
  const manifestPath = resolve(targetRoot, 'manifest.json')
  await cloud.downloadObject(`housing-data/releases/${datasetVersion}/manifest.json`, manifestPath)
  const manifestText = await readFile(manifestPath, 'utf8')
  if (sha256(manifestText) !== audit.manifest_sha256) throw new Error('Rollback target manifest hash does not match its publish audit record')
  const manifest = JSON.parse(manifestText)
  if (manifest.dataset_version !== datasetVersion) throw new Error('Rollback target manifest version is inconsistent')
  const manifestFileId = String(manifest.bootstrap_file_id || '').replace(/\/bootstrap\.json$/, '/manifest.json')
  const expectedBucket = audit.storage_bucket || cloud.bucket
  if (!manifestFileId.includes(`.${expectedBucket}/housing-data/releases/${datasetVersion}/manifest.json`)) {
    throw new Error('Rollback target does not use a complete SDK-compatible cloud file ID')
  }
  await cloud.downloadObject(`housing-data/releases/${datasetVersion}/bootstrap.json`, resolve(targetRoot, 'bootstrap.json'))
  const cityIds = Object.keys(manifest.city_files || {})
  if (cityIds.length !== 70 || new Set(cityIds).size !== 70) throw new Error('Rollback target must contain exactly 70 unique cities')
  for (const cityId of cityIds) {
    await cloud.downloadObject(`housing-data/releases/${datasetVersion}/cities/${cityId}.json`, resolve(targetRoot, 'cities', `${cityId}.json`))
  }
  if (manifest.release_type === 'historical_correction') {
    await cloud.downloadObject(`housing-data/releases/${datasetVersion}/revision-manifest.json`, resolve(targetRoot, 'revision-manifest.json'))
  }
  const targetPointer = {
    dataset_version: manifest.dataset_version,
    source_dataset_version: manifest.source_dataset_version,
    dataset_as_of: manifest.dataset_as_of,
    schema_version: manifest.schema_version,
    manifest_file_id: manifestFileId,
    manifest_sha256: audit.manifest_sha256,
    published_at: null,
    previous_dataset_version: null,
    next_check_at: manifest.next_check_at,
  }
  await writeFile(resolve(targetRoot, 'current.candidate.json'), stableJson(targetPointer), 'utf8')
  const { stdout } = await execFileAsync(process.execPath, [
    resolve(root, 'scripts/miniprogram/verify-remote-data.mjs'),
    `--dir=${targetRoot}`,
    '--integrity-only',
  ], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  return {
    cityIds,
    manifest,
    manifestText,
    targetPointer,
    verificationOutput: stdout.trim(),
  }
}

async function readAndValidateActiveBaseline(expectedText) {
  const currentText = (await cloud.getObject('housing-data/current.json')).toString('utf8')
  if (expectedText !== undefined && currentText !== expectedText) throw new Error('Production current.json differs from the immutable rollback intent baseline')
  const current = JSON.parse(currentText)
  assertProductionPointerBaseline(current)
  const registryKey = `housing-data/control/revocations-${current.revocations_sha256}.json`
  const registryText = (await cloud.getObject(registryKey)).toString('utf8')
  if (sha256(registryText) !== current.revocations_sha256) throw new Error('Active revocations registry hash mismatch')
  const registry = validateRevocationRegistry(JSON.parse(registryText))
  if (registry.generation !== current.revocations_generation) throw new Error('Active revocations registry generation mismatch')
  const activeManifestText = (await cloud.getObject(`housing-data/releases/${current.dataset_version}/manifest.json`)).toString('utf8')
  if (sha256(activeManifestText) !== current.manifest_sha256) throw new Error('Active manifest hash mismatch')
  validateControlPointer(current, {
    allowLegacy: false,
    requireContext: true,
    manifest: JSON.parse(activeManifestText),
    registry,
    cloudEnvId,
    storageBucket: cloud.bucket,
  })
  return { current, currentText, registry }
}

function buildRollbackArtifacts({ baseline, target, rolledBackAt }) {
  const rollbackRevisionId = buildRollbackRevisionId(baseline.current.dataset_version)
  const registry = appendFailedReleaseRevocations(baseline.registry, {
    datasetVersion: baseline.current.dataset_version,
    sourceDatasetVersion: baseline.current.source_dataset_version,
    revokedAt: rolledBackAt,
    replacementDatasetVersion: datasetVersion,
    replacementSourceDatasetVersion: target.manifest.source_dataset_version,
    revisionId: rollbackRevisionId,
    reason: 'manual rollback after the active dataset was declared unsafe',
  })
  assertTargetNotRevoked(registry, {
    datasetVersion,
    sourceDatasetVersion: target.manifest.source_dataset_version,
  })
  const registryArtifact = buildRevocationRegistryArtifact(registry, { cloudEnvId, storageBucket: cloud.bucket })
  const current = buildAutomaticRollbackPointer(target.targetPointer, baseline.current.dataset_version, {
    rolledBackAt,
    controlGeneration: baseline.current.control_generation + 1,
    registryArtifact,
    failedSourceDatasetVersion: baseline.current.source_dataset_version,
    rollbackRevisionId,
    targetSourceDatasetVersion: target.manifest.source_dataset_version,
    targetManifest: target.manifest,
    statusReason: 'manual_rollback',
  })
  const currentText = stableJson(current)
  return { current, currentText, registry, registryArtifact, rollbackRevisionId }
}

async function prepareRollbackIntent() {
  await resetWorkRoot()
  const target = await downloadAndVerifyTarget('prepare-target')
  const baseline = await readAndValidateActiveBaseline()
  if (baseline.current.dataset_version === datasetVersion) throw new Error('Rollback target is already active; use the original immutable intent to finalize an interrupted rollback')
  const rolledBackAt = new Date().toISOString()
  const artifacts = buildRollbackArtifacts({ baseline, target, rolledBackAt })
  if ((await cloud.getObject('housing-data/current.json')).toString('utf8') !== baseline.currentText) {
    throw new Error('Production current.json changed while preparing the immutable rollback intent')
  }
  const intent = buildManualRollbackIntent({
    beforeCurrentText: baseline.currentText,
    afterCurrentText: artifacts.currentText,
    revocationsText: artifacts.registryArtifact.text,
    targetManifestSha256: audit.manifest_sha256,
    rollbackRevisionId: artifacts.rollbackRevisionId,
    preparedAt: rolledBackAt,
    cloudEnvId,
    storageBucket: cloud.bucket,
    commitSha: process.env.CI_COMMIT_SHA,
    githubRunId: process.env.GITHUB_RUN_ID,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    ordinaryCiRunId: authorization.ordinary_ci_run_id,
    preSwitchVerificationOutput: target.verificationOutput,
  })
  const intentText = manualRollbackIntentText(intent)
  const immutableIntentRoot = resolve(workRoot, 'immutable-intent')
  await mkdir(immutableIntentRoot, { recursive: true })
  const outputPath = resolve(immutableIntentRoot, manualRollbackIntentFileName(intentText))
  await writeFile(outputPath, intentText, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({
    state: 'prepared',
    dataset_version: datasetVersion,
    intent_file: relative(root, outputPath).replaceAll('\\', '/'),
    intent_sha256: sha256(intentText),
    origin_commit_sha: intent.commit_sha,
    origin_github_run_id: intent.github_run_id,
    origin_github_run_attempt: intent.github_run_attempt,
    production_writes: 0,
  }, null, 2))
}

async function verifyAppliedIntent({ intent, intentText, target, recoveredAfterPointerSwitch }) {
  const currentText = (await cloud.getObject('housing-data/current.json')).toString('utf8')
  if (currentText !== intent.after_current_text) throw new Error('Rollback current.json round-trip bytes differ from the immutable intent')
  const current = JSON.parse(currentText)
  const registryKey = `housing-data/control/revocations-${intent.revocations_sha256}.json`
  const registryText = (await cloud.getObject(registryKey)).toString('utf8')
  if (registryText !== intent.revocations_text) throw new Error('Rollback revocations bytes differ from the immutable intent')
  const registry = validateRevocationRegistry(JSON.parse(registryText))
  validateControlPointer(current, {
    allowLegacy: false,
    requireContext: true,
    manifest: target.manifest,
    registry,
    cloudEnvId,
    storageBucket: cloud.bucket,
  })
  assertRollbackClosure(registry, {
    failedDatasetVersion: intent.from_dataset_version,
    failedSourceDatasetVersion: intent.from_source_dataset_version,
    targetDatasetVersion: intent.to_dataset_version,
    targetSourceDatasetVersion: intent.to_source_dataset_version,
    revisionId: intent.rollback_revision_id,
  })
  const invocation = await cloud.invokeFunction('getHousingDataManifest')
  const cloudFunctionCurrent = validateManifestFunctionOutput(JSON.stringify(invocation), current)
  const postSwitchTarget = await downloadAndVerifyTarget('post-switch-target')
  if (postSwitchTarget.verificationOutput !== intent.pre_switch_verification_output || postSwitchTarget.manifestText !== target.manifestText) {
    throw new Error('Rollback target bytes changed between intent preparation and final verification')
  }
  const rollbackAudit = buildManualRollbackAudit({
    intentText,
    finalizerCommitSha: process.env.CI_COMMIT_SHA,
    finalizerGithubRunId: process.env.GITHUB_RUN_ID,
    finalizerGithubRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    finalizerOrdinaryCiRunId: authorization.ordinary_ci_run_id,
    recoveredAfterPointerSwitch,
    cloudFunctionVerified: cloudFunctionCurrent.dataset_version === current.dataset_version,
  })
  validateManualRollbackAudit(rollbackAudit, {
    datasetVersion,
    cloudEnvId,
    storageBucket: cloud.bucket,
    expectedOriginCommitSha: originCommitSha,
    expectedOriginGithubRunId: originRunId,
    expectedOriginGithubRunAttempt: originRunAttempt,
    expectedFinalizerCommitSha: process.env.CI_COMMIT_SHA,
    expectedFinalizerGithubRunId: process.env.GITHUB_RUN_ID,
    expectedFinalizerGithubRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    expectedFinalizerOrdinaryCiRunId: authorization.ordinary_ci_run_id,
  })
  const immutableAuditRoot = resolve(workRoot, 'immutable-audit')
  await mkdir(immutableAuditRoot, { recursive: true })
  const outputPath = resolve(immutableAuditRoot, manualRollbackAuditFileName(rollbackAudit))
  await writeFile(outputPath, `${JSON.stringify(rollbackAudit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({
    state: 'verified',
    recovered_after_pointer_switch: recoveredAfterPointerSwitch,
    audit_file: relative(root, outputPath).replaceAll('\\', '/'),
    from_dataset_version: intent.from_dataset_version,
    to_dataset_version: intent.to_dataset_version,
  }, null, 2))
}

async function applyRollbackIntent() {
  const intentPath = resolveRepositoryFile(applyIntentPath, '--apply-intent')
  const intentText = await readFile(intentPath, 'utf8')
  const intent = parseManualRollbackIntentText(intentText, {
    expectedCommitSha: originCommitSha,
    expectedGithubRunId: originRunId,
    expectedGithubRunAttempt: originRunAttempt,
    expectedDatasetVersion: datasetVersion,
    expectedCloudEnvId: cloudEnvId,
  })
  if (basename(intentPath) !== manualRollbackIntentFileName(intentText)) throw new Error('Rollback intent filename does not match its immutable content hash')
  await resetWorkRoot()
  const target = await downloadAndVerifyTarget('apply-target')
  if (target.manifestText && sha256(target.manifestText) !== intent.target_manifest_sha256) throw new Error('Remote target manifest differs from the immutable rollback intent')
  if (target.manifest.source_dataset_version !== intent.to_source_dataset_version || target.verificationOutput !== intent.pre_switch_verification_output) {
    throw new Error('Remote full-release verification differs from the immutable rollback intent')
  }

  const observedCurrentText = (await cloud.getObject('housing-data/current.json')).toString('utf8')
  const state = classifyManualRollbackIntentState(observedCurrentText, intent)
  if (state === 'conflict') throw new Error(`Production current.json conflicts with the immutable rollback intent (SHA-256 ${sha256(observedCurrentText)})`)

  if (state === 'old_active') {
    assertManualRollbackWriteOrigin(intent, {
      commitSha: process.env.CI_COMMIT_SHA,
      githubRunId: process.env.GITHUB_RUN_ID,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    })
    const baseline = await readAndValidateActiveBaseline(intent.before_current_text)
    const rebuilt = buildRollbackArtifacts({ baseline, target, rolledBackAt: intent.prepared_at })
    if (rebuilt.currentText !== intent.after_current_text || rebuilt.registryArtifact.text !== intent.revocations_text) {
      throw new Error('Rebuilt rollback artifacts differ from the immutable rollback intent')
    }
    if (await cloud.objectExists(rebuilt.registryArtifact.cosKey)) {
      const existingRegistryText = (await cloud.getObject(rebuilt.registryArtifact.cosKey)).toString('utf8')
      if (existingRegistryText !== intent.revocations_text) throw new Error('Content-addressed revocations path already contains different bytes')
    } else {
      await cloud.putObject(rebuilt.registryArtifact.cosKey, Buffer.from(intent.revocations_text, 'utf8'))
    }
    if ((await cloud.getObject(rebuilt.registryArtifact.cosKey)).toString('utf8') !== intent.revocations_text) {
      throw new Error('Revocations registry round-trip verification failed')
    }
    if ((await cloud.getObject('housing-data/current.json')).toString('utf8') !== intent.before_current_text) {
      throw new Error('Production current.json changed before the final rollback switch')
    }
    try {
      await cloud.putObject('housing-data/current.json', Buffer.from(intent.after_current_text, 'utf8'))
    } catch (error) {
      const observed = (await cloud.getObject('housing-data/current.json')).toString('utf8')
      if (observed === intent.before_current_text) throw error
      if (observed !== intent.after_current_text) throw new Error('Rollback pointer write failed and production moved to an unknown conflicting state', { cause: error })
    }
  }

  await verifyAppliedIntent({
    intent,
    intentText,
    target,
    recoveredAfterPointerSwitch: state === 'target_active',
  })
}

if (prepareIntent) {
  await prepareRollbackIntent()
} else {
  await applyRollbackIntent()
}
