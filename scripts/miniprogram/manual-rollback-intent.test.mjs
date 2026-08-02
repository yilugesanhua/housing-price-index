import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendFailedReleaseRevocations,
  buildRevocationRegistryArtifact,
  buildRollbackRevisionId,
  createRevocationRegistry,
} from './control-plane.mjs'
import { buildAutomaticRollbackPointer } from './post-publish-guard.mjs'
import { stableJson } from './remote-data-lib.mjs'
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

const cloudEnvId = 'cloud1-d3gpdx70w5d05c68c'
const storageBucket = '636c-cloud1-d3gpdx70w5d05c68c-1456861154'
const commitSha = 'a'.repeat(40)
const originRunId = '123456'
const originRunAttempt = '1'
const finalizerCommitSha = 'b'.repeat(40)
const finalizerRunId = '234567'
const finalizerRunAttempt = '2'
const ordinaryCiRunId = '654321'
const finalizerOrdinaryCiRunId = '765432'
const failedDatasetVersion = '2026-07-111111111111'
const failedSourceDatasetVersion = '2026-07-222222222222'
const targetDatasetVersion = '2026-06-e9788d0bddf3'
const targetSourceDatasetVersion = '2026-06-4fd1d1a8ff12'
const baselineAt = '2026-08-01T01:00:00.000Z'
const rolledBackAt = '2026-08-01T02:00:00.000Z'

function fixture() {
  const baselineRegistry = createRevocationRegistry({ generatedAt: baselineAt })
  const baselineArtifact = buildRevocationRegistryArtifact(baselineRegistry, { cloudEnvId, storageBucket })
  const before = {
    dataset_version: failedDatasetVersion,
    source_dataset_version: failedSourceDatasetVersion,
    dataset_as_of: '2026-07',
    schema_version: '1.3.0',
    manifest_file_id: `cloud://${cloudEnvId}.${storageBucket}/housing-data/releases/${failedDatasetVersion}/manifest.json`,
    manifest_sha256: '1'.repeat(64),
    control_schema_version: '1.0.0',
    control_generation: 4,
    ...baselineArtifact.currentFields,
    transition_type: 'publish',
    data_status: 'current',
    status_reason: 'monthly_publish',
    control_generated_at: baselineAt,
    control_valid_until: '2026-08-02T01:00:00.000Z',
    published_at: baselineAt,
    previous_dataset_version: null,
    next_check_at: '2026-08-15T01:40:00.000Z',
  }
  const rollbackRevisionId = buildRollbackRevisionId(failedDatasetVersion)
  const registry = appendFailedReleaseRevocations(baselineRegistry, {
    datasetVersion: failedDatasetVersion,
    sourceDatasetVersion: failedSourceDatasetVersion,
    revokedAt: rolledBackAt,
    replacementDatasetVersion: targetDatasetVersion,
    replacementSourceDatasetVersion: targetSourceDatasetVersion,
    revisionId: rollbackRevisionId,
    reason: 'manual rollback after the active dataset was declared unsafe',
  })
  const registryArtifact = buildRevocationRegistryArtifact(registry, { cloudEnvId, storageBucket })
  const target = {
    dataset_version: targetDatasetVersion,
    source_dataset_version: targetSourceDatasetVersion,
    dataset_as_of: '2026-06',
    schema_version: '1.3.0',
    manifest_file_id: `cloud://${cloudEnvId}.${storageBucket}/housing-data/releases/${targetDatasetVersion}/manifest.json`,
    manifest_sha256: '2'.repeat(64),
    published_at: null,
    previous_dataset_version: null,
    next_check_at: '2026-08-15T01:40:00.000Z',
  }
  const after = buildAutomaticRollbackPointer(target, failedDatasetVersion, {
    rolledBackAt,
    controlGeneration: before.control_generation + 1,
    registryArtifact,
    failedSourceDatasetVersion,
    rollbackRevisionId,
    targetSourceDatasetVersion,
    statusReason: 'manual_rollback',
  })
  const intent = buildManualRollbackIntent({
    beforeCurrentText: stableJson(before),
    afterCurrentText: stableJson(after),
    revocationsText: registryArtifact.text,
    targetManifestSha256: target.manifest_sha256,
    rollbackRevisionId,
    preparedAt: rolledBackAt,
    cloudEnvId,
    storageBucket,
    commitSha,
    githubRunId: originRunId,
    githubRunAttempt: originRunAttempt,
    ordinaryCiRunId,
    preSwitchVerificationOutput: `Verified ${targetDatasetVersion}: 70 city shards, 12345 bytes, self-consistent full release reconstruction passed`,
  })
  const intentText = manualRollbackIntentText(intent)
  return { before, after, intent, intentText, registryArtifact }
}

test('builds and parses one content-addressed immutable rollback intent', () => {
  const { intent, intentText } = fixture()
  assert.equal(parseManualRollbackIntentText(intentText, {
    expectedCommitSha: commitSha,
    expectedGithubRunId: originRunId,
    expectedGithubRunAttempt: originRunAttempt,
    expectedDatasetVersion: targetDatasetVersion,
    expectedCloudEnvId: cloudEnvId,
  }).after_sha256, intent.after_sha256)
  assert.match(manualRollbackIntentFileName(intentText), /^manual-data-rollback-intent-[a-f0-9]{64}\.json$/)
})

test('classifies only exact old and target pointer bytes as recoverable states', () => {
  const { intent, intentText } = fixture()
  assert.equal(classifyManualRollbackIntentState(intent.before_current_text, intent), 'old_active')
  assert.equal(classifyManualRollbackIntentState(intent.after_current_text, intent), 'target_active')
  assert.equal(classifyManualRollbackIntentState(`${intent.after_current_text} `, intent), 'conflict')
  assert.throws(() => parseManualRollbackIntentText(intentText.replace('12345 bytes', '12346 bytes')), /verifier output hash/)
})

test('only the origin run may execute writes while a later run may finalize an applied intent', () => {
  const { intent, intentText } = fixture()
  assert.equal(assertManualRollbackWriteOrigin(intent, { commitSha, githubRunId: originRunId, githubRunAttempt: originRunAttempt }), intent)
  assert.throws(() => assertManualRollbackWriteOrigin(intent, {
    commitSha,
    githubRunId: originRunId,
    githubRunAttempt: finalizerRunAttempt,
  }), /different GitHub run attempt/)
  assert.throws(() => assertManualRollbackWriteOrigin(intent, {
    commitSha: finalizerCommitSha,
    githubRunId: finalizerRunId,
    githubRunAttempt: finalizerRunAttempt,
  }), /different commit/)
  const audit = buildManualRollbackAudit({
    intentText,
    finalizerCommitSha,
    finalizerGithubRunId: finalizerRunId,
    finalizerGithubRunAttempt: finalizerRunAttempt,
    finalizerOrdinaryCiRunId,
    recoveredAfterPointerSwitch: true,
    cloudFunctionVerified: true,
  })
  assert.equal(validateManualRollbackAudit(audit, {
    datasetVersion: targetDatasetVersion,
    cloudEnvId,
    storageBucket,
    expectedOriginCommitSha: commitSha,
    expectedOriginGithubRunId: originRunId,
    expectedOriginGithubRunAttempt: originRunAttempt,
    expectedFinalizerCommitSha: finalizerCommitSha,
    expectedFinalizerGithubRunId: finalizerRunId,
    expectedFinalizerGithubRunAttempt: finalizerRunAttempt,
    expectedFinalizerOrdinaryCiRunId: finalizerOrdinaryCiRunId,
  }), audit)
  assert.equal(manualRollbackAuditFileName(audit), 'manual-data-rollback-2026-08-01T02-00-00-000Z.json')
})

test('normal audit must be finalized by its origin and all audit identity is intent-bound', () => {
  const { intentText } = fixture()
  const audit = buildManualRollbackAudit({
    intentText,
    finalizerCommitSha: commitSha,
    finalizerGithubRunId: originRunId,
    finalizerGithubRunAttempt: originRunAttempt,
    finalizerOrdinaryCiRunId: ordinaryCiRunId,
    recoveredAfterPointerSwitch: false,
    cloudFunctionVerified: true,
  })
  assert.throws(() => validateManualRollbackAudit({ ...audit, after_sha256: '3'.repeat(64) }), /differs from its intent/)
  assert.throws(() => validateManualRollbackAudit({ ...audit, cloud_function_verified: false }), /verification evidence is incomplete/)
  assert.throws(() => validateManualRollbackAudit({ ...audit, finalizer_ordinary_ci_run_id: finalizerOrdinaryCiRunId }), /exact origin attempt and CI/)
  assert.throws(() => buildManualRollbackAudit({
    intentText,
    finalizerCommitSha,
    finalizerGithubRunId: finalizerRunId,
    finalizerGithubRunAttempt: finalizerRunAttempt,
    finalizerOrdinaryCiRunId,
    recoveredAfterPointerSwitch: false,
    cloudFunctionVerified: true,
  }), /normal rollback audit must be finalized by its exact origin attempt and CI/)
})
