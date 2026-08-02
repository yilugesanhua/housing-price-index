import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { validateManifestFunctionOutput } from './post-publish-guard.mjs'
import { createTencentCloudClient } from './tencent-cloud-sdk.mjs'
import {
  buildDryRunMigrationArtifacts,
  buildMigrationArtifacts,
  buildMigrationAudit,
  buildMigrationIntent,
  buildPreSwitchVerificationEvidence,
  classifyMigrationIntentState,
  classifyMigrationState,
  migrationAuditFileName,
  migrationDescriptor,
  migrationIntentFileName,
  migrationIntentText,
  parseMigrationEvidenceFixtureText,
  parseMigrationIntentText,
  validateAlreadyMigratedPointer,
  validateMigrationAuditTransition,
  validateLegacyCurrentText,
  validateLegacyManifestText,
  validatePostWriteValidationReceiptInvocation,
  validateValidatorPreflightInvocation,
} from './legacy-control-migration.mjs'
import { sha256 } from './control-plane.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const migrationId = argument('migration')
const confirmation = argument('confirmation')
const verifyAuditPath = argument('verify-audit')
const verifyIntentPath = argument('verify-intent')
const applyIntentPath = argument('apply-intent')
const finalizeIntentPath = argument('finalize-intent')
const originRunId = argument('origin-run-id') || process.env.GITHUB_RUN_ID
const originRunAttempt = argument('origin-run-attempt') || process.env.GITHUB_RUN_ATTEMPT
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const apply = process.argv.includes('--apply')
const prepareIntent = process.argv.includes('--prepare-intent')
const descriptor = migrationDescriptor(migrationId)

if ([Boolean(verifyAuditPath), Boolean(verifyIntentPath), prepareIntent, Boolean(applyIntentPath), Boolean(finalizeIntentPath)].filter(Boolean).length > 1) {
  throw new Error('Choose exactly one migration operation')
}
if (apply !== Boolean(applyIntentPath)) throw new Error('--apply is allowed only together with --apply-intent=<path>')
if (finalizeIntentPath && apply) throw new Error('--finalize-intent cannot be combined with --apply')

if (cloudEnvId !== descriptor.cloud_env_id) throw new Error('Migration environment differs from the approved descriptor')

function resolveRepositoryFile(input, label) {
  if (!input || isAbsolute(input)) throw new Error(`${label} must be a repository-relative path`)
  const absolutePath = resolve(root, input)
  const repositoryRelativePath = relative(root, absolutePath)
  if (!repositoryRelativePath || repositoryRelativePath.startsWith('..') || isAbsolute(repositoryRelativePath)) {
    throw new Error(`${label} must remain inside the repository`)
  }
  return absolutePath
}

async function loadFixedEvidence() {
  const fixturePath = resolve(root, 'scripts/miniprogram/fixtures', `${descriptor.migration_id}.evidence.json`)
  const fixtureText = await readFile(fixturePath, 'utf8')
  const fixture = parseMigrationEvidenceFixtureText(fixtureText, descriptor)
  const evidenceTexts = Object.fromEntries(await Promise.all(fixture.evidence_files.map(async (entry) => [
    entry.role,
    await readFile(resolve(root, entry.path), 'utf8'),
  ])))
  return { fixture, fixtureText, evidenceTexts }
}

if (verifyAuditPath) {
  if (apply) throw new Error('--verify-audit cannot be combined with --apply')
  const auditText = await readFile(resolve(root, verifyAuditPath), 'utf8')
  const audit = JSON.parse(auditText)
  validateMigrationAuditTransition(audit, {
    expectedBeforeSha256: descriptor.legacy_current_sha256,
    datasetVersion: descriptor.dataset_version,
    sourceDatasetVersion: descriptor.source_dataset_version,
    manifestSha256: descriptor.legacy_manifest_sha256,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  })
  if (basename(verifyAuditPath) !== migrationAuditFileName(audit)) throw new Error('Migration audit filename does not match its canonical timestamp')
  console.log(JSON.stringify({ verified: true, audit_file: basename(verifyAuditPath), migration_id: descriptor.migration_id }))
  process.exit(0)
}

if (verifyIntentPath) {
  const intentPath = resolveRepositoryFile(verifyIntentPath, '--verify-intent')
  const intentText = await readFile(intentPath, 'utf8')
  const intent = parseMigrationIntentText(intentText, {
    expectedCommitSha: process.env.CI_COMMIT_SHA,
    expectedGithubRunId: originRunId,
    expectedGithubRunAttempt: originRunAttempt,
  })
  if (basename(intentPath) !== migrationIntentFileName(intentText)) throw new Error('Migration intent filename does not match its immutable content hash')
  console.log(JSON.stringify({
    verified: true,
    migration_id: intent.migration_id,
    intent_file: relative(root, intentPath).replaceAll('\\', '/'),
    intent_sha256: sha256(intentText),
    origin_commit_sha: intent.commit_sha,
    origin_github_run_id: intent.github_run_id,
    origin_github_run_attempt: intent.github_run_attempt,
    production_writes: 0,
  }))
  process.exit(0)
}

const fixedEvidence = await loadFixedEvidence()
const dryRunArtifacts = buildDryRunMigrationArtifacts({ ...fixedEvidence, migrationId: descriptor.migration_id })

if (!prepareIntent && !applyIntentPath) {
  console.log(JSON.stringify({
    dry_run: true,
    fixed_evidence_verified: true,
    independent_audit_batches_verified: fixedEvidence.fixture.independent_audit.batch_count,
    migration_id: descriptor.migration_id,
    cloud_env_id: descriptor.cloud_env_id,
    expected_current_sha256: descriptor.legacy_current_sha256,
    expected_manifest_sha256: descriptor.legacy_manifest_sha256,
    candidate_current_sha256: sha256(dryRunArtifacts.currentText),
    candidate_revocations_sha256: dryRunArtifacts.registryArtifact.sha256,
    target_dataset_version: descriptor.dataset_version,
    target_source_dataset_version: descriptor.source_dataset_version,
    automatic_release_enabled: false,
    writes: [
      'immutable migration intent artifact before any production object write',
      'content-addressed immutable revocations registry after complete 70-city verification',
      'housing-data/current.json after exact raw-byte baseline recheck',
      'strict getHousingDataManifest deployment after the pointer switch',
      'local immutable migration audit after strict cloud-function and second 70-city verification',
    ],
  }, null, 2))
  process.exit(0)
}

if (confirmation !== descriptor.migration_id) throw new Error('Migration confirmation does not match the complete approved migration ID')
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Production legacy migration is allowed only in the protected GitHub Actions workflow')
if (process.env.CI_PRODUCTION_ENVIRONMENT !== 'housing-data-production') throw new Error('Protected production environment identity is missing')
if (!/^[a-f0-9]{40}$/.test(process.env.CI_COMMIT_SHA || '')) throw new Error('Exact migration commit SHA is missing')
if (!/^\d+$/.test(process.env.GITHUB_RUN_ID || '')) throw new Error('GitHub migration run identity is missing')
if (!/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ATTEMPT || '')) throw new Error('GitHub migration run attempt is missing')
const legacyMigrationAuthorization = String(process.env.LEGACY_CONTROL_MIGRATION_AUTHORIZED || '').trim().toLowerCase()
  if (prepareIntent && legacyMigrationAuthorization) throw new Error('LEGACY_CONTROL_MIGRATION_AUTHORIZED must remain unset while preparing the immutable intent')
  if ((applyIntentPath || finalizeIntentPath) && legacyMigrationAuthorization !== 'true') throw new Error('LEGACY_CONTROL_MIGRATION_AUTHORIZED must be explicitly true for the protected migration phase')
if (String(process.env.AUTOMATIC_RELEASE_ENABLED || '').trim().toLowerCase() !== 'false') {
  throw new Error('AUTOMATIC_RELEASE_ENABLED must be explicitly false during the one-time migration')
}
const productionReleaseAuthorization = String(process.env.PRODUCTION_RELEASE_AUTHORIZED || '').trim().toLowerCase()
if (productionReleaseAuthorization && productionReleaseAuthorization !== 'false') {
  throw new Error('PRODUCTION_RELEASE_AUTHORIZED must remain false or unset during the one-time migration')
}

const migrationAuthorization = {
  automaticReleaseEnabled: false,
  legacyControlMigrationAuthorized: true,
  productionReleaseAuthorized: false,
}

const cloud = createTencentCloudClient({ cloudEnvId })
let validatorPreflight = null
const workRoot = resolve(root, 'work/control-migrations', descriptor.migration_id)
if (prepareIntent) {
  await rm(workRoot, { recursive: true, force: true })
} else {
  for (const name of ['immutable-audit', 'migration-result.json', 'remote-verify-before-switch-recheck', 'remote-verify-after-switch', 'remote-verify-recovered', 'remote-verify-finalize']) {
    await rm(resolve(workRoot, name), { recursive: true, force: true })
  }
}
await mkdir(workRoot, { recursive: true })

async function readCurrentText() {
  return (await cloud.getObject('housing-data/current.json')).toString('utf8')
}

async function downloadAndVerifyFullRelease(label, currentText, manifestText, manifest) {
  const outputRoot = resolve(workRoot, label)
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(resolve(outputRoot, 'cities'), { recursive: true })
  await writeFile(resolve(outputRoot, 'current.candidate.json'), currentText, 'utf8')
  await writeFile(resolve(outputRoot, 'manifest.json'), manifestText, 'utf8')
  const bootstrapBytes = await cloud.getObject(`housing-data/releases/${descriptor.dataset_version}/bootstrap.json`)
  await writeFile(resolve(outputRoot, 'bootstrap.json'), bootstrapBytes)
  const cityIds = Object.keys(manifest.city_files || {})
  if (cityIds.length !== 70 || new Set(cityIds).size !== 70) throw new Error('Migration full-release verification requires exactly 70 unique cities')
  const cityFiles = {}
  for (const cityId of cityIds) {
    const bytes = await cloud.getObject(`housing-data/releases/${descriptor.dataset_version}/cities/${cityId}.json`)
    cityFiles[cityId] = bytes
    await writeFile(resolve(outputRoot, 'cities', `${cityId}.json`), bytes)
  }
  const result = await execFileAsync(process.execPath, [resolve(root, 'scripts/miniprogram/verify-remote-data.mjs'), `--dir=${outputRoot}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  console.log(result.stdout.trim())
  return buildPreSwitchVerificationEvidence({
    currentText,
    manifestText,
    bootstrapBytes,
    cityFiles,
    verifierOutput: result.stdout,
  })
}

async function invokeAndVerify(current) {
  const invocation = await cloud.invokeFunction('getHousingDataManifest')
  validateManifestFunctionOutput(JSON.stringify(invocation), current)
  return validatePostWriteValidationReceiptInvocation(invocation, current, { observedAt: new Date().toISOString() })
}

async function writeWorkAudit(text) {
  const audit = JSON.parse(text)
  validateMigrationAuditTransition(audit, {
    expectedBeforeSha256: descriptor.legacy_current_sha256,
    datasetVersion: descriptor.dataset_version,
    sourceDatasetVersion: descriptor.source_dataset_version,
    manifestSha256: descriptor.legacy_manifest_sha256,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  })
  await writeFile(resolve(workRoot, 'migration-result.json'), text, 'utf8')
  const immutableAuditRoot = resolve(workRoot, 'immutable-audit')
  await mkdir(immutableAuditRoot, { recursive: true })
  await writeFile(resolve(immutableAuditRoot, migrationAuditFileName(audit)), text, { encoding: 'utf8', flag: 'wx' })
}

async function findExistingMigrationAudit(currentText, preparedIntentText) {
  const releaseRoot = resolve(root, 'data/releases')
  const fileNames = (await readdir(releaseRoot))
    .filter((name) => name.startsWith('legacy-control-migration-') && name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right, 'en'))
  const matches = []
  for (const fileName of fileNames) {
    const text = await readFile(resolve(releaseRoot, fileName), 'utf8')
    const audit = JSON.parse(text)
    if (audit.migration_id !== descriptor.migration_id) continue
    validateMigrationAuditTransition(audit, {
      expectedBeforeSha256: descriptor.legacy_current_sha256,
      expectedAfterSha256: sha256(currentText),
      datasetVersion: descriptor.dataset_version,
      sourceDatasetVersion: descriptor.source_dataset_version,
      manifestSha256: descriptor.legacy_manifest_sha256,
      cloudEnvId: descriptor.cloud_env_id,
      storageBucket: descriptor.storage_bucket,
      expectedCommitSha: process.env.CI_COMMIT_SHA,
      expectedOriginGithubRunId: originRunId,
    })
    if (audit.migration_intent_sha256 !== sha256(preparedIntentText)) {
      throw new Error(`Existing migration audit uses a different prepared intent: ${fileName}`)
    }
    if (fileName !== migrationAuditFileName(audit)) throw new Error(`Existing migration audit has a non-canonical filename: ${fileName}`)
    matches.push({ audit, fileName, text })
  }
  if (matches.length > 1) throw new Error('Multiple successful audits exist for the same one-time migration')
  return matches[0] || null
}

async function writeAudit({ current, currentText, preparedIntentText, verifiedAfter, recoveredAfterPointerSwitch, postWriteReceipt }) {
  const preparedIntent = parseMigrationIntentText(preparedIntentText, {
    expectedCommitSha: process.env.CI_COMMIT_SHA,
    expectedGithubRunId: originRunId,
    expectedGithubRunAttempt: originRunAttempt,
  })
  const audit = buildMigrationAudit({
    current,
    currentText,
    migrationIntentText: preparedIntentText,
    verifiedAfter,
    recoveredAfterPointerSwitch,
    commitSha: preparedIntent.commit_sha,
    githubRunId: preparedIntent.github_run_id,
    githubRunAttempt: preparedIntent.github_run_attempt,
    finalizerCommitSha: process.env.CI_COMMIT_SHA,
    finalizerGithubRunId: process.env.GITHUB_RUN_ID,
    finalizerGithubRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    validatorPreflight,
    postWriteReceipt,
    ...migrationAuthorization,
    descriptor,
  })
  const auditText = `${JSON.stringify(audit, null, 2)}\n`
  await writeWorkAudit(auditText)
  return audit
}

async function prepareMigrationIntent() {
  const initialCurrentText = await readCurrentText()
  if (classifyMigrationState(initialCurrentText, descriptor.migration_id) !== 'ready') {
    throw new Error(`Production current.json is not the exact approved legacy bytes (SHA-256 ${sha256(initialCurrentText)})`)
  }
  const legacyCurrent = validateLegacyCurrentText(initialCurrentText, descriptor)
  const manifestText = (await cloud.getObject(`housing-data/releases/${descriptor.dataset_version}/manifest.json`)).toString('utf8')
  const manifest = validateLegacyManifestText(manifestText, legacyCurrent, descriptor)
  const preSwitchVerification = await downloadAndVerifyFullRelease('remote-verify-before-switch', initialCurrentText, manifestText, manifest)
  if (await readCurrentText() !== initialCurrentText) throw new Error('Production current.json changed while preparing the immutable migration intent')

  const intent = buildMigrationIntent({
    legacyCurrentText: initialCurrentText,
    manifestText,
    migratedAt: new Date().toISOString(),
    verifiedBefore: true,
    commitSha: process.env.CI_COMMIT_SHA,
    githubRunId: process.env.GITHUB_RUN_ID,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    preSwitchVerification,
    descriptor,
  })
  const preparedIntentText = migrationIntentText(intent)
  const immutableIntentRoot = resolve(workRoot, 'immutable-intent')
  await mkdir(immutableIntentRoot, { recursive: true })
  const fileName = migrationIntentFileName(preparedIntentText)
  const outputPath = resolve(immutableIntentRoot, fileName)
  await writeFile(outputPath, preparedIntentText, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({
    state: 'prepared',
    migration_id: descriptor.migration_id,
    intent_file: relative(root, outputPath).replaceAll('\\', '/'),
    intent_sha256: sha256(preparedIntentText),
    origin_commit_sha: intent.commit_sha,
    origin_github_run_id: intent.github_run_id,
    origin_github_run_attempt: intent.github_run_attempt,
    production_writes: 0,
  }))
}

async function verifyAppliedPointer({ intent, manifestText, currentText, label }) {
  const registryText = (await cloud.getObject(`housing-data/control/revocations-${intent.revocations_sha256}.json`)).toString('utf8')
  if (registryText !== intent.revocations_text) throw new Error('Migrated revocations bytes differ from the immutable migration intent')
  const verified = validateAlreadyMigratedPointer({
    currentText,
    manifestText,
    registryText,
    migrationId: descriptor.migration_id,
  })
  await downloadAndVerifyFullRelease(label, currentText, manifestText, verified.manifest)
  return verified
}

async function finalizePreparedIntent() {
  const intentPath = resolveRepositoryFile(finalizeIntentPath, '--finalize-intent')
  const preparedIntentText = await readFile(intentPath, 'utf8')
  if (basename(intentPath) !== migrationIntentFileName(preparedIntentText)) {
    throw new Error('Migration intent filename does not match its canonical content hash')
  }
  const intent = parseMigrationIntentText(preparedIntentText, {
    expectedCommitSha: process.env.CI_COMMIT_SHA,
    expectedGithubRunId: originRunId,
    expectedGithubRunAttempt: originRunAttempt,
  })
  if (intent.cloud_env_id !== cloudEnvId) throw new Error('Migration intent targets a different production environment')

  const manifestText = (await cloud.getObject(`housing-data/releases/${descriptor.dataset_version}/manifest.json`)).toString('utf8')
  if (manifestText !== intent.manifest_text) throw new Error('Remote manifest bytes differ from the immutable migration intent')
  const currentText = await readCurrentText()
  if (classifyMigrationIntentState(currentText, intent) !== 'recover_finalize') {
    throw new Error('Finalization requires the exact migrated current.json pointer')
  }
  const verified = await verifyAppliedPointer({
    intent,
    manifestText,
    currentText,
    label: 'remote-verify-finalize',
  })
  validatorPreflight = validateValidatorPreflightInvocation(
    await cloud.invokeFunction('getHousingDataManifest', { action: 'describe_validator' }),
  )
  const postWriteReceipt = await invokeAndVerify(verified.current)
  const existingAudit = await findExistingMigrationAudit(currentText, preparedIntentText)

  if (existingAudit) {
    if (postWriteReceipt.receipt.current_fingerprint !== existingAudit.audit.post_write_current_fingerprint) {
      throw new Error('Current validator receipt does not bind the pointer recorded by the immutable migration audit')
    }
    await writeWorkAudit(existingAudit.text)
    console.log(JSON.stringify({ state: 'audit_committed', audit_reused: true, ...existingAudit.audit }))
    return
  }

  const recoveredAfterPointerSwitch = String(process.env.GITHUB_RUN_ID) !== intent.github_run_id
    || String(process.env.GITHUB_RUN_ATTEMPT) !== intent.github_run_attempt
  const audit = await writeAudit({
    current: verified.current,
    currentText,
    preparedIntentText,
    verifiedAfter: true,
    recoveredAfterPointerSwitch,
    postWriteReceipt,
  })
  console.log(JSON.stringify({ state: 'verified', recovered_after_pointer_switch: recoveredAfterPointerSwitch, ...audit }))
}

async function applyPreparedIntent() {
  const intentPath = resolveRepositoryFile(applyIntentPath, '--apply-intent')
  const preparedIntentText = await readFile(intentPath, 'utf8')
  if (basename(intentPath) !== migrationIntentFileName(preparedIntentText)) {
    throw new Error('Migration intent filename does not match its canonical content hash')
  }
  const intent = parseMigrationIntentText(preparedIntentText, {
    expectedCommitSha: process.env.CI_COMMIT_SHA,
    expectedGithubRunId: originRunId,
    expectedGithubRunAttempt: originRunAttempt,
  })
  if (intent.cloud_env_id !== cloudEnvId) throw new Error('Migration intent targets a different production environment')

  const manifestText = (await cloud.getObject(`housing-data/releases/${descriptor.dataset_version}/manifest.json`)).toString('utf8')
  if (manifestText !== intent.manifest_text) throw new Error('Remote manifest bytes differ from the immutable migration intent')
  const currentText = await readCurrentText()
  const intentState = classifyMigrationIntentState(currentText, intent)
  if (intentState === 'conflict') {
    throw new Error(`Production current.json conflicts with the immutable migration intent (SHA-256 ${sha256(currentText)})`)
  }
  if (intentState === 'recover_finalize') {
    const verified = await verifyAppliedPointer({
      intent,
      manifestText,
      currentText,
      label: 'remote-verify-recovered',
    })
    console.log(JSON.stringify({
      state: 'applied_recovered',
      migration_id: descriptor.migration_id,
      current_sha256: sha256(currentText),
      dataset_version: verified.current.dataset_version,
      strict_finalize_required: true,
      production_writes: 0,
    }))
    return
  }
  if (String(process.env.GITHUB_RUN_ID) !== intent.github_run_id
    || String(process.env.GITHUB_RUN_ATTEMPT) !== intent.github_run_attempt) {
    throw new Error('A new GitHub run or attempt may recover an applied intent but may not execute its production writes')
  }

  const artifacts = buildMigrationArtifacts({
    legacyCurrentText: intent.before_current_text,
    manifestText: intent.manifest_text,
    migratedAt: intent.migrated_at,
    migrationId: descriptor.migration_id,
  })
  if (artifacts.currentText !== intent.after_current_text || artifacts.registryArtifact.text !== intent.revocations_text) {
    throw new Error('Rebuilt migration artifacts differ from the immutable migration intent')
  }
  const preSwitchRecheck = await downloadAndVerifyFullRelease('remote-verify-before-switch-recheck', currentText, manifestText, artifacts.manifest)
  if (JSON.stringify(preSwitchRecheck) !== JSON.stringify(intent.pre_switch_verification)) {
    throw new Error('Pre-switch full-release recheck differs from the immutable migration intent')
  }
  if (await readCurrentText() !== intent.before_current_text) throw new Error('Production current.json changed before the revocations upload')

  if (await cloud.objectExists(artifacts.registryArtifact.cosKey)) {
    const existingRegistryText = (await cloud.getObject(artifacts.registryArtifact.cosKey)).toString('utf8')
    if (existingRegistryText !== intent.revocations_text) throw new Error('Content-addressed revocations path already contains different bytes')
  } else {
    await cloud.putObject(artifacts.registryArtifact.cosKey, Buffer.from(intent.revocations_text, 'utf8'))
  }
  if ((await cloud.getObject(artifacts.registryArtifact.cosKey)).toString('utf8') !== intent.revocations_text) {
    throw new Error('Revocations registry round-trip verification failed')
  }

  if (await readCurrentText() !== intent.before_current_text) throw new Error('Production current.json changed before the final migration switch')
  try {
    await cloud.putObject('housing-data/current.json', Buffer.from(intent.after_current_text, 'utf8'))
  } catch (error) {
    const observed = await readCurrentText()
    if (observed === intent.before_current_text) throw error
    if (observed !== intent.after_current_text) throw new Error('Migration pointer write failed and production moved to an unknown conflicting state', { cause: error })
  }

  const roundTripCurrentText = await readCurrentText()
  if (roundTripCurrentText !== intent.after_current_text) throw new Error('Migration pointer round-trip bytes differ; legacy state will not be silently restored')
  const verified = validateAlreadyMigratedPointer({
    currentText: roundTripCurrentText,
    manifestText,
    registryText: intent.revocations_text,
    migrationId: descriptor.migration_id,
  })
  await downloadAndVerifyFullRelease('remote-verify-after-switch', roundTripCurrentText, manifestText, verified.manifest)
  console.log(JSON.stringify({
    state: 'applied',
    migration_id: descriptor.migration_id,
    current_sha256: sha256(roundTripCurrentText),
    dataset_version: verified.current.dataset_version,
    strict_finalize_required: true,
    production_writes: 2,
  }))
}

if (prepareIntent) {
  await prepareMigrationIntent()
} else if (finalizeIntentPath) {
  await finalizePreparedIntent()
} else {
  await applyPreparedIntent()
}
