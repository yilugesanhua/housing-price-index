import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS,
  LEGACY_MIGRATION_RECEIPT_SCHEMA_VERSION,
  LEGACY_MIGRATION_VALIDATOR_ID,
  assertMigrationEvidence,
  buildDryRunMigrationArtifacts,
  buildInitialMigrationRegistry,
  buildLegacyMigrationPointer,
  buildMigrationAudit,
  buildMigrationIntent,
  classifyMigrationIntentState,
  classifyMigrationState,
  migrationAuditFileName,
  migrationDescriptor,
  migrationIntentFileName,
  migrationIntentText,
  parseMigrationEvidenceFixtureText,
  parseMigrationIntentText,
  validateControlAuditTransitions,
  validateLegacyCurrentText,
  validateLegacyManifestText,
  validateMigrationAuditTransition,
  validatePostWriteValidationReceiptInvocation,
  validateValidatorPreflightInvocation,
} from './legacy-control-migration.mjs'
import {
  buildRevocationRegistryArtifact,
  sha256,
  stableJson,
  validateControlPointer,
} from './control-plane.mjs'
import { buildScfInvokeRequest } from './tencent-cloud-sdk.mjs'
import {
  assertMonitorPointerStable,
  loadExplicitMigrationAudit,
  mergeMigrationAuditEntries,
} from './monitor-audit-chain.mjs'

const root = resolve(import.meta.dirname, '../..')
const migrationId = 'legacy-control-2026-06-e9788d0bddf3'
const descriptor = migrationDescriptor(migrationId)
const fixedEvidenceFixture = JSON.parse(await readFile(
  resolve(root, 'scripts/miniprogram/fixtures', `${migrationId}.evidence.json`),
  'utf8',
))
const legacyCurrentText = '{"dataset_version":"2026-06-e9788d0bddf3","dataset_as_of":"2026-06","schema_version":"1.3.0","manifest_file_id":"cloud://cloud1-d3gpdx70w5d05c68c.636c-cloud1-d3gpdx70w5d05c68c-1456861154/housing-data/releases/2026-06-e9788d0bddf3/manifest.json","manifest_sha256":"62692a9c33928377b576f4e814e12bcf6cc265779d7564a4eaa6befb540d062e","published_at":"2026-07-29T03:17:46.325Z","previous_dataset_version":null,"next_check_at":"2026-08-17T01:40:00.000Z"}\n'
const legacyCurrent = JSON.parse(legacyCurrentText)
const legacyManifestText = await readFile(
  resolve(root, 'tests/fixtures/miniprogram/legacy-control-2026-06/manifest.json'),
  'utf8',
)
const manifest = JSON.parse(legacyManifestText)
const originCommitSha = 'a'.repeat(40)
const originGithubRunId = '123456789'
const originGithubRunAttempt = '1'

function preSwitchVerificationEvidence() {
  const cityFiles = Object.entries(manifest.city_files)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([cityId, metadata]) => ({ city_id: cityId, sha256: metadata.sha256, bytes: metadata.bytes }))
  const manifestBytes = Buffer.byteLength(legacyManifestText)
  const totalBytes = manifestBytes + manifest.bootstrap_bytes + cityFiles.reduce((sum, entry) => sum + entry.bytes, 0)
  return {
    evidence_schema_version: 'legacy-control-pre-switch-verification-v1',
    status: 'passed',
    verifier: 'scripts/miniprogram/verify-remote-data.mjs',
    verification_scope: 'exact_snapshot_reconstruction',
    dataset_version: manifest.dataset_version,
    source_dataset_version: manifest.source_dataset_version,
    current_sha256: sha256(legacyCurrentText),
    manifest_sha256: sha256(legacyManifestText),
    manifest_bytes: manifestBytes,
    bootstrap_sha256: manifest.bootstrap_sha256,
    bootstrap_bytes: manifest.bootstrap_bytes,
    city_files: cityFiles,
    total_bytes: totalBytes,
    verifier_output: `Verified ${manifest.dataset_version}: 70 city shards, ${totalBytes} bytes, exact snapshot reconstruction passed`,
  }
}

function artifacts() {
  const registry = buildInitialMigrationRegistry(descriptor)
  const registryArtifact = buildRevocationRegistryArtifact(registry, {
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  })
  const current = buildLegacyMigrationPointer({
    legacyCurrent,
    manifest,
    registryArtifact,
    migratedAt: '2026-07-31T06:00:00.000Z',
    descriptor,
  })
  return { registry, registryArtifact, current, currentText: stableJson(current) }
}

function buildCompleteMigrationAudit({
  recoveredAfterPointerSwitch = false,
  finalizerCommitSha = originCommitSha,
  finalizerGithubRunId = originGithubRunId,
  finalizerGithubRunAttempt = originGithubRunAttempt,
  receiptValidatedAt,
} = {}) {
  const { current, currentText } = artifacts()
  const validatedAt = receiptValidatedAt || current.control_generated_at
  const validator = {
    validator_id: LEGACY_MIGRATION_VALIDATOR_ID,
    receipt_schema_version: LEGACY_MIGRATION_RECEIPT_SCHEMA_VERSION,
    max_receipt_validity_ms: LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS,
  }
  const receipt = {
    receipt_schema_version: LEGACY_MIGRATION_RECEIPT_SCHEMA_VERSION,
    validator_id: LEGACY_MIGRATION_VALIDATOR_ID,
    validated_at: validatedAt,
    valid_until: new Date(Date.parse(validatedAt) + LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS).toISOString(),
    current_fingerprint: sha256(currentText.slice(0, -1)),
    manifest_sha256: current.manifest_sha256,
    revocations_sha256: current.revocations_sha256,
    control_generation: current.control_generation,
    revocations_generation: current.revocations_generation,
  }
  const validatorPreflight = {
    ...validator,
    describe_validator_observed: true,
    describe_validator_verified: true,
    response_sha256: sha256(stableJson({ validator })),
  }
  const intent = buildMigrationIntent({
    legacyCurrentText,
    manifestText: legacyManifestText,
    migratedAt: current.control_generated_at,
    verifiedBefore: true,
    commitSha: originCommitSha,
    githubRunId: originGithubRunId,
    githubRunAttempt: originGithubRunAttempt,
    validatorPreflight,
    preSwitchVerification: preSwitchVerificationEvidence(),
    descriptor,
  })
  const preparedIntentText = migrationIntentText(intent)
  const audit = buildMigrationAudit({
    current,
    currentText,
    migrationIntentText: preparedIntentText,
    verifiedAfter: true,
    recoveredAfterPointerSwitch,
    commitSha: originCommitSha,
    githubRunId: originGithubRunId,
    githubRunAttempt: originGithubRunAttempt,
    finalizerCommitSha,
    finalizerGithubRunId,
    finalizerGithubRunAttempt,
    validatorPreflight,
    postWriteReceipt: {
      cloud_function_response_observed: true,
      current_sha256: sha256(currentText),
      receipt,
      receipt_sha256: sha256(stableJson(receipt)),
      strict_validator_verified: true,
    },
    automaticReleaseEnabled: false,
    productionReleaseAuthorized: false,
    legacyControlMigrationAuthorized: true,
    descriptor,
  })
  return { audit, current, currentText, intent, preparedIntentText }
}

test('the one approved legacy pointer is bound by its exact raw bytes', () => {
  assert.equal(sha256(legacyCurrentText), descriptor.legacy_current_sha256)
  assert.deepEqual(validateLegacyCurrentText(legacyCurrentText, descriptor), legacyCurrent)
  const reordered = `${JSON.stringify(Object.fromEntries(Object.entries(legacyCurrent).reverse()))}\n`
  assert.notEqual(sha256(reordered), descriptor.legacy_current_sha256)
  assert.throws(() => validateLegacyCurrentText(reordered, descriptor), /raw SHA-256 changed/)
  assert.throws(() => validateLegacyCurrentText(legacyCurrentText.replace('null', '"2026-06-ec36ff8fb2e5"'), descriptor), /raw SHA-256 changed/)
})

test('the fixed migration evidence fixture is bound by its exact raw bytes', async () => {
  const fixtureText = await readFile(
    resolve(root, 'scripts/miniprogram/fixtures', `${migrationId}.evidence.json`),
    'utf8',
  )
  assert.equal(
    parseMigrationEvidenceFixtureText(fixtureText, descriptor).migration_id,
    migrationId,
  )
  assert.throws(
    () => parseMigrationEvidenceFixtureText(`${fixtureText} `, descriptor),
    /fixture raw SHA-256 changed/,
  )
  const fixture = JSON.parse(fixtureText)
  const evidenceTexts = Object.fromEntries(await Promise.all(fixture.evidence_files.map(async ({ role, path }) => [
    role,
    await readFile(resolve(root, path), 'utf8'),
  ])))
  assert.equal(
    buildDryRunMigrationArtifacts({ fixtureText, evidenceTexts, migrationId }).current.dataset_version,
    descriptor.dataset_version,
  )
})

test('legacy migration refuses a relabelled or byte-changed immutable manifest', () => {
  assert.throws(() => validateLegacyManifestText('{}\n', legacyCurrent, descriptor), /raw SHA-256 changed/)
  const relabelledText = `${JSON.stringify({
    dataset_version: descriptor.dataset_version,
    source_dataset_version: descriptor.source_dataset_version,
    dataset_as_of: descriptor.dataset_as_of,
    schema_version: descriptor.schema_version,
    release_type: 'monthly_update',
  })}\n`
  const changed = { ...descriptor, legacy_manifest_sha256: sha256(relabelledText) }
  const changedCurrent = { ...legacyCurrent, manifest_sha256: changed.legacy_manifest_sha256 }
  assert.throws(() => validateLegacyManifestText(relabelledText, changedCurrent, changed), /must not be relabelled/)
})

test('migration establishes generation one with the complete audited revocation set', () => {
  const { registry, current } = artifacts()
  assert.equal(registry.generation, 1)
  assert.deepEqual(registry.revoked_dataset_versions.map((entry) => entry.dataset_version), [
    '2026-06-679ea146d4e2',
    '2026-06-ec36ff8fb2e5',
  ])
  assert.deepEqual(registry.revoked_source_dataset_versions.map((entry) => entry.source_dataset_version), ['2026-06-679ea146d4e2'])
  assert.equal(current.transition_type, 'migration')
  assert.equal(current.published_at, descriptor.published_at)
  assert.equal(current.previous_dataset_version, null)
  assert.equal(validateControlPointer(current, {
    allowLegacy: false,
    requireContext: true,
    manifest,
    registry,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  }), current)
})

test('migration validator rejects unknown identity, altered generations, and relabelled manifest', () => {
  const { registry, current } = artifacts()
  const context = {
    allowLegacy: false,
    requireContext: true,
    manifest,
    registry,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  }
  assert.throws(() => validateControlPointer({ ...current, migration_id: 'legacy-control-2026-06-unknown000000' }, context), /migration ID is not approved/)
  assert.throws(() => validateControlPointer({ ...current, control_generation: 2 }, context), /generation one/)
  assert.throws(() => validateControlPointer({ ...current, previous_dataset_version: '2026-06-ec36ff8fb2e5' }, context), /unsafe previous dataset/)
  assert.throws(() => validateControlPointer(current, { ...context, manifest: { ...manifest, release_type: 'monthly_update' } }), /preserve the immutable legacy manifest type/)
})

test('migration validator rejects missing or rewritten dual revocations', () => {
  const { registry, current } = artifacts()
  const validate = (candidateRegistry) => validateControlPointer(current, {
    allowLegacy: false,
    requireContext: true,
    manifest,
    registry: candidateRegistry,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  })
  assert.throws(() => validate({ ...registry, revoked_dataset_versions: registry.revoked_dataset_versions.slice(0, 1) }), /dataset revocations are incomplete/)
  assert.throws(() => validate({ ...registry, revoked_source_dataset_versions: [] }), /source revocations are incomplete/)
  assert.throws(() => validate({
    ...registry,
    revoked_source_dataset_versions: registry.revoked_source_dataset_versions.map((entry) => ({
      ...entry,
      revision_id: 'revision-2026-06-wrong-audit-id',
    })),
  }), /source revocations are incomplete/)
})

test('migration state machine distinguishes exact legacy, migrated, and conflict states', () => {
  const { currentText } = artifacts()
  assert.equal(classifyMigrationState(legacyCurrentText, migrationId), 'ready')
  assert.equal(classifyMigrationState(currentText, migrationId), 'already_migrated')
  assert.equal(classifyMigrationState('{"dataset_version":"2026-07-aaaaaaaaaaaa"}\n', migrationId), 'conflict')
})

test('immutable intent state machine permits only the exact baseline or exact candidate bytes', () => {
  const { intent, preparedIntentText } = buildCompleteMigrationAudit()
  assert.match(migrationIntentFileName(preparedIntentText), /^legacy-control-migration-intent-[a-f0-9]{64}\.json$/)
  assert.equal(classifyMigrationIntentState(intent.before_current_text, intent), 'ready')
  assert.equal(classifyMigrationIntentState(intent.after_current_text, intent), 'recover_finalize')
  assert.equal(classifyMigrationIntentState(`${intent.after_current_text} `, intent), 'conflict')
})

test('immutable intent rejects tampered pointer, manifest, registry, validator, identity, and time evidence', () => {
  const { intent } = buildCompleteMigrationAudit()
  const expected = {
    expectedCommitSha: originCommitSha,
    expectedGithubRunId: originGithubRunId,
    expectedGithubRunAttempt: originGithubRunAttempt,
  }
  const cases = [
    ['before_current_text', `${intent.before_current_text} `],
    ['after_current_text', `${intent.after_current_text} `],
    ['manifest_text', `${intent.manifest_text} `],
    ['revocations_text', `${intent.revocations_text} `],
    ['commit_sha', 'b'.repeat(40)],
    ['github_run_id', '987654321'],
    ['github_run_attempt', '2'],
    ['migrated_at', '2026-07-31T06:00:01.000Z'],
  ]
  for (const [field, value] of cases) {
    const changed = { ...intent, [field]: value }
    assert.throws(() => parseMigrationIntentText(`${JSON.stringify(changed, null, 2)}\n`, expected), /migration intent/)
  }
  const changedValidator = {
    ...intent,
    validator_contract: { ...intent.validator_contract, contract_sha256: '0'.repeat(64) },
  }
  assert.throws(() => parseMigrationIntentText(`${JSON.stringify(changedValidator, null, 2)}\n`, expected), /validator contract hash is invalid/)

  const changedCityEvidence = structuredClone(intent)
  changedCityEvidence.pre_switch_verification.city_files[0].sha256 = '0'.repeat(64)
  changedCityEvidence.pre_switch_verification_sha256 = sha256(stableJson(changedCityEvidence.pre_switch_verification))
  assert.throws(() => parseMigrationIntentText(`${JSON.stringify(changedCityEvidence, null, 2)}\n`, expected), /city hash is invalid/)

  const changedVerifierEvidence = structuredClone(intent)
  changedVerifierEvidence.pre_switch_verification.verifier_output = 'passed without file evidence'
  changedVerifierEvidence.pre_switch_verification_sha256 = sha256(stableJson(changedVerifierEvidence.pre_switch_verification))
  assert.throws(() => parseMigrationIntentText(`${JSON.stringify(changedVerifierEvidence, null, 2)}\n`, expected), /verifier output is invalid/)
})

test('audit is self-contained, preserves origin identity, and supports read-only finalization recovery', () => {
  const normal = buildCompleteMigrationAudit()
  const changedIntent = JSON.parse(normal.preparedIntentText)
  changedIntent.revocations_text = `${changedIntent.revocations_text} `
  const changedIntentText = `${JSON.stringify(changedIntent, null, 2)}\n`
  assert.throws(() => validateMigrationAuditTransition({
    ...normal.audit,
    migration_intent_text: changedIntentText,
    migration_intent_sha256: sha256(changedIntentText),
  }), /migration intent/)

  assert.throws(() => buildCompleteMigrationAudit({
    finalizerGithubRunId: '987654321',
  }), /normal migration audit was finalized by a different run or attempt/)
  assert.throws(() => buildCompleteMigrationAudit({
    finalizerGithubRunAttempt: '2',
  }), /normal migration audit was finalized by a different run or attempt/)

  const recovered = buildCompleteMigrationAudit({
    recoveredAfterPointerSwitch: true,
    finalizerGithubRunId: '987654321',
    finalizerGithubRunAttempt: '2',
    receiptValidatedAt: '2026-08-01T06:00:00.000Z',
  })
  assert.equal(validateMigrationAuditTransition(recovered.audit), recovered.audit.after_sha256)
  assert.equal(recovered.audit.github_run_id, originGithubRunId)
  assert.equal(recovered.audit.github_run_attempt, originGithubRunAttempt)
  assert.equal(recovered.audit.finalizer_github_run_id, '987654321')
  assert.equal(recovered.audit.finalizer_github_run_attempt, '2')
  const recoveredFromDescendantCommit = buildCompleteMigrationAudit({
    recoveredAfterPointerSwitch: true,
    finalizerCommitSha: 'b'.repeat(40),
    finalizerGithubRunId: '987654321',
    finalizerGithubRunAttempt: '2',
    receiptValidatedAt: '2026-08-01T06:00:00.000Z',
  })
  assert.equal(
    validateMigrationAuditTransition(recoveredFromDescendantCommit.audit),
    recoveredFromDescendantCommit.audit.after_sha256,
  )
  assert.equal(recoveredFromDescendantCommit.audit.finalizer_commit_sha, 'b'.repeat(40))
})

test('prepare and recovery branches contain no production object writes', async () => {
  const script = await readFile(resolve(root, 'scripts/miniprogram/migrate-legacy-control.mjs'), 'utf8')
  const prepareBranch = script.slice(script.indexOf('async function prepareMigrationIntent'), script.indexOf('async function verifyAppliedPointer'))
  const recoveryBranch = script.slice(script.indexOf('async function verifyAppliedPointer'), script.indexOf('async function finalizePreparedIntent'))
  const applyBranch = script.slice(script.indexOf('async function applyPreparedIntent'))
  assert.doesNotMatch(prepareBranch, /putObject/)
  assert.doesNotMatch(recoveryBranch, /putObject/)
  assert.ok(applyBranch.indexOf('parseMigrationIntentText') >= 0)
  assert.ok(applyBranch.indexOf('parseMigrationIntentText') < applyBranch.indexOf('cloud.putObject'))
  assert.ok(applyBranch.indexOf("intentState === 'recover_finalize'") < applyBranch.indexOf('cloud.putObject'))
})

test('the package migration entry point is bound to the approved ID and stays dry-run by default', async () => {
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const command = packageJson.scripts['miniprogram:data:migrate-legacy-control']
  assert.equal(
    command,
    'node scripts/miniprogram/migrate-legacy-control.mjs --migration=legacy-control-2026-06-e9788d0bddf3',
  )
  assert.doesNotMatch(command, /--prepare-intent|--apply-intent|--apply/)
})

test('local evidence must bind the correct package, both correction records, and full audit v5', () => {
  const evidence = {
    publishAudit: {
      status: 'published', cloud_env_id: descriptor.cloud_env_id, dataset_version: descriptor.dataset_version,
      source_dataset_version: descriptor.source_dataset_version, manifest_sha256: descriptor.legacy_manifest_sha256,
      current_sha256: descriptor.legacy_current_sha256, city_count: 70,
    },
    invalidPointerCorrection: {
      status: 'superseded_invalid_pointer', dataset_version: '2026-06-679ea146d4e2',
      replacement_dataset_version: '2026-06-ec36ff8fb2e5', rollback_allowed: false,
    },
    sourceCorrection: {
      status: 'superseded_incorrect_source_data', dataset_version: descriptor.superseded_dataset_version,
      replacement_dataset_version: descriptor.dataset_version, replacement_source_dataset_version: descriptor.source_dataset_version,
      rollback_allowed: false,
    },
    auditReport: {
      result: 'passed',
      ...fixedEvidenceFixture.independent_audit,
    },
  }
  assert.equal(assertMigrationEvidence(evidence, descriptor), true)
  assert.throws(() => assertMigrationEvidence({ ...evidence, sourceCorrection: { ...evidence.sourceCorrection, rollback_allowed: true } }, descriptor), /remains rollback eligible/)
  const incompleteAudit = structuredClone(evidence.auditReport)
  incompleteAudit.record_count -= 1
  incompleteAudit.batches.at(-1).records_checked -= 1
  assert.throws(() => assertMigrationEvidence({ ...evidence, auditReport: incompleteAudit }, descriptor), /coverage is incomplete/)
})

test('monitor audit transition closes the exact old and new pointer hash chain', () => {
  const { audit } = buildCompleteMigrationAudit()
  const options = {
    expectedBeforeSha256: descriptor.legacy_current_sha256,
    datasetVersion: descriptor.dataset_version,
    sourceDatasetVersion: descriptor.source_dataset_version,
    manifestSha256: descriptor.legacy_manifest_sha256,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  }
  assert.equal(validateMigrationAuditTransition(audit, options), audit.after_sha256)
  assert.throws(() => validateMigrationAuditTransition({ ...audit, full_release_verified_before: false }, options), /pre-switch evidence is incomplete/)
  assert.throws(() => validateMigrationAuditTransition({ ...audit, describe_validator_observed: false }, options), /response was not observed/)
  assert.throws(() => validateMigrationAuditTransition({ ...audit, describe_validator_verified: false }, options), /preflight was not verified/)
  assert.throws(() => validateMigrationAuditTransition({ ...audit, cloud_function_response_observed: false }, options), /cloud response was not observed/)
  assert.throws(() => validateMigrationAuditTransition({ ...audit, post_write_validation_receipt_verified: false }, options), /post-write receipt is incomplete/)
  assert.throws(() => validateMigrationAuditTransition({ ...audit, strict_validator_verified: false }, options), /strict validator has not been verified/)
  assert.throws(() => validateMigrationAuditTransition({ ...audit, post_write_current_sha256: '0'.repeat(64) }, options), /pointer hash differs/)
  assert.throws(() => validateMigrationAuditTransition({
    ...audit,
    post_write_current: { ...audit.post_write_current, control_generated_at: '2026-07-31T06:00:01.000Z' },
  }, options), /embedded pointer differs/)
  assert.throws(() => validateMigrationAuditTransition({ ...audit, automatic_release_enabled: true }, options), /automatic release state/)
  assert.throws(() => validateMigrationAuditTransition({ ...audit, production_release_authorized: true }, options), /ordinary production release authorization/)
})

test('monitor merges repair and migration audits by the actual pointer hash chain', () => {
  const { audit } = buildCompleteMigrationAudit()
  const initialSha256 = '1'.repeat(64)
  const finalSha256 = '2'.repeat(64)
  const beforeMigrationRepair = {
    status: 'current_pointer_repaired',
    repaired_at: '2026-07-31T05:00:00.000Z',
    cloud_env_id: descriptor.cloud_env_id,
    dataset_version: descriptor.dataset_version,
    before_sha256: initialSha256,
    after_sha256: descriptor.legacy_current_sha256,
  }
  const afterMigrationRepair = {
    status: 'current_pointer_repaired',
    repaired_at: '2026-07-31T07:00:00.000Z',
    cloud_env_id: descriptor.cloud_env_id,
    dataset_version: descriptor.dataset_version,
    before_sha256: audit.after_sha256,
    after_sha256: finalSha256,
    control_generation: 2,
  }
  const result = validateControlAuditTransitions({
    initialSha256,
    finalSha256,
    datasetVersion: descriptor.dataset_version,
    sourceDatasetVersion: descriptor.source_dataset_version,
    manifestSha256: descriptor.legacy_manifest_sha256,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
    repairs: [
      { fileName: 'repair-after.json', audit: afterMigrationRepair },
      { fileName: 'repair-before.json', audit: beforeMigrationRepair },
    ],
    migrations: [{ fileName: migrationAuditFileName(audit), audit }],
  })
  assert.deepEqual(result.transitions.map((entry) => entry.fileName), [
    'repair-before.json',
    migrationAuditFileName(audit),
    'repair-after.json',
  ])
  assert.equal(result.pointerRepairCount, 2)
  assert.equal(result.pointerMigrationCount, 1)
  assert.equal(result.expectedCurrentSha256, finalSha256)

  const backwardsRepair = { ...beforeMigrationRepair, repaired_at: '2026-07-31T06:30:00.000Z' }
  assert.throws(() => validateControlAuditTransitions({
    initialSha256,
    datasetVersion: descriptor.dataset_version,
    sourceDatasetVersion: descriptor.source_dataset_version,
    manifestSha256: descriptor.legacy_manifest_sha256,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
    repairs: [{ fileName: 'repair-before.json', audit: backwardsRepair }],
    migrations: [{ fileName: migrationAuditFileName(audit), audit }],
  }), /timestamps go backwards/)
})

test('monitor consumes the sole immutable work audit before that audit is committed', async (t) => {
  const { audit } = buildCompleteMigrationAudit()
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'housing-monitor-audit-'))
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }))
  const relativeAuditRoot = `work/control-migrations/${migrationId}/immutable-audit`
  const auditRoot = resolve(temporaryRoot, relativeAuditRoot)
  await mkdir(auditRoot, { recursive: true })
  const fileName = migrationAuditFileName(audit)
  const text = `${JSON.stringify(audit, null, 2)}\n`
  await writeFile(resolve(auditRoot, fileName), text, 'utf8')

  assert.throws(() => validateControlAuditTransitions({
    initialSha256: descriptor.legacy_current_sha256,
    finalSha256: audit.after_sha256,
    datasetVersion: descriptor.dataset_version,
    sourceDatasetVersion: descriptor.source_dataset_version,
    manifestSha256: descriptor.legacy_manifest_sha256,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
    migrations: [],
  }), /does not end at the production pointer/)

  const explicit = await loadExplicitMigrationAudit({
    root: temporaryRoot,
    directory: relativeAuditRoot,
    datasetVersion: descriptor.dataset_version,
    sourceDatasetVersion: descriptor.source_dataset_version,
    manifestSha256: descriptor.legacy_manifest_sha256,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  })
  const merged = mergeMigrationAuditEntries([], [explicit])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].text, text)
  assert.equal(validateControlAuditTransitions({
    initialSha256: descriptor.legacy_current_sha256,
    finalSha256: audit.after_sha256,
    datasetVersion: descriptor.dataset_version,
    sourceDatasetVersion: descriptor.source_dataset_version,
    manifestSha256: descriptor.legacy_manifest_sha256,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
    migrations: merged,
  }).pointerMigrationCount, 1)

  const workflow = await readFile(resolve(root, '.github/workflows/legacy-control-migration.yml'), 'utf8')
  assert.match(workflow, /--migration-audit-dir=work\/control-migrations\/legacy-control-2026-06-e9788d0bddf3\/immutable-audit/)

  await writeFile(resolve(auditRoot, 'unexpected.json'), '{}\n', 'utf8')
  await assert.rejects(loadExplicitMigrationAudit({
    root: temporaryRoot,
    directory: relativeAuditRoot,
    datasetVersion: descriptor.dataset_version,
    sourceDatasetVersion: descriptor.source_dataset_version,
    manifestSha256: descriptor.legacy_manifest_sha256,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  }), /exactly one file/)
  await assert.rejects(loadExplicitMigrationAudit({
    root: temporaryRoot,
    directory: 'data/releases',
    datasetVersion: descriptor.dataset_version,
  }), /outside work\/control-migrations/)
  assert.throws(() => mergeMigrationAuditEntries(
    [explicit],
    [{ ...explicit, text: `${text} ` }],
  ), /bytes conflict/)
})

test('SCF invocation accepts only the exact read-only validator preflight event', () => {
  assert.deepEqual(buildScfInvokeRequest('getHousingDataManifest', descriptor.cloud_env_id), {
    FunctionName: 'getHousingDataManifest',
    Namespace: descriptor.cloud_env_id,
    InvocationType: 'RequestResponse',
  })
  assert.equal(
    buildScfInvokeRequest('getHousingDataManifest', descriptor.cloud_env_id, { action: 'describe_validator' }).ClientContext,
    '{"action":"describe_validator"}',
  )
  assert.throws(() => buildScfInvokeRequest('getHousingDataManifest', descriptor.cloud_env_id, { action: 'publish' }), /not an approved plain-object request/)
  assert.throws(() => buildScfInvokeRequest('getHousingDataManifest', descriptor.cloud_env_id, { action: 'describe_validator', extra: true }), /not an approved plain-object request/)

  const validator = {
    validator_id: LEGACY_MIGRATION_VALIDATOR_ID,
    receipt_schema_version: LEGACY_MIGRATION_RECEIPT_SCHEMA_VERSION,
    max_receipt_validity_ms: LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS,
  }
  const preflight = validateValidatorPreflightInvocation({
    Result: { InvokeResult: 0, RetMsg: JSON.stringify({ validator }) },
  })
  assert.equal(preflight.describe_validator_observed, true)
  assert.equal(preflight.describe_validator_verified, true)

  const { current, currentText } = artifacts()
  const validatedAt = current.control_generated_at
  const receipt = {
    receipt_schema_version: LEGACY_MIGRATION_RECEIPT_SCHEMA_VERSION,
    validator_id: LEGACY_MIGRATION_VALIDATOR_ID,
    validated_at: validatedAt,
    valid_until: new Date(Date.parse(validatedAt) + LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS).toISOString(),
    current_fingerprint: sha256(currentText.slice(0, -1)),
    manifest_sha256: current.manifest_sha256,
    revocations_sha256: current.revocations_sha256,
    control_generation: current.control_generation,
    revocations_generation: current.revocations_generation,
  }
  const postWrite = validatePostWriteValidationReceiptInvocation({
    Result: { InvokeResult: 0, RetMsg: JSON.stringify({ current, validation_receipt: receipt }) },
  }, current, { observedAt: validatedAt })
  assert.equal(postWrite.cloud_function_response_observed, true)
  assert.equal(postWrite.current_sha256, sha256(currentText))
  assert.equal(postWrite.strict_validator_verified, true)
  assert.throws(() => validatePostWriteValidationReceiptInvocation({
    Result: {
      InvokeResult: 0,
      RetMsg: JSON.stringify({
        current,
        validation_receipt: {
          ...receipt,
          validated_at: new Date(Date.parse(current.control_generated_at) - 1).toISOString(),
          valid_until: new Date(Date.parse(current.control_generated_at) - 1 + LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS).toISOString(),
        },
      }),
    },
  }, current, { observedAt: validatedAt }), /predates the control pointer/)
})

test('monitor rejects a production pointer that changes during the full-release check', () => {
  assert.equal(assertMonitorPointerStable('same\n', 'same\n'), true)
  assert.throws(() => assertMonitorPointerStable('before\n', 'after\n'), /changed during the monitor run/)
})
