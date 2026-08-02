import {
  assertRollbackClosure,
  assertTargetNotRevoked,
  buildRollbackRevisionId,
  sha256,
  validateControlPointer,
  validateRevocationRegistry,
} from './control-plane.mjs'

export const MANUAL_ROLLBACK_INTENT_SCHEMA_VERSION = 'manual-data-rollback-intent-v2'
export const MANUAL_ROLLBACK_AUDIT_SCHEMA_VERSION = 'manual-data-rollback-audit-v4'

const SHA_PATTERN = /^[a-f0-9]{40}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const RUN_ID_PATTERN = /^\d+$/
const RUN_ATTEMPT_PATTERN = /^[1-9]\d*$/
const DATASET_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const REVISION_PATTERN = /^revision-[a-z0-9][a-z0-9-]{5,80}$/
const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'

const INTENT_FIELDS = [
  'after_current_text',
  'after_sha256',
  'automatic_release_enabled',
  'before_control_generation',
  'before_current_text',
  'before_revocations_generation',
  'before_sha256',
  'city_count',
  'cloud_env_id',
  'commit_sha',
  'control_generation',
  'from_dataset_version',
  'from_source_dataset_version',
  'full_release_verified_before',
  'github_run_id',
  'github_run_attempt',
  'intent_schema_version',
  'ordinary_ci_run_id',
  'ordinary_ci_workflow',
  'pre_switch_verification_output',
  'pre_switch_verification_sha256',
  'prepared_at',
  'production_environment_authorized',
  'revocations_generation',
  'revocations_sha256',
  'revocations_text',
  'rollback_revision_id',
  'status',
  'storage_bucket',
  'target_manifest_sha256',
  'to_dataset_version',
  'to_source_dataset_version',
]

const AUDIT_FIELDS = [
  'after_sha256',
  'audit_schema_version',
  'automatic_release_enabled',
  'before_control_generation',
  'before_revocations_generation',
  'before_sha256',
  'city_count',
  'cloud_env_id',
  'cloud_function_verified',
  'commit_sha',
  'control_generation',
  'finalizer_commit_sha',
  'finalizer_github_run_id',
  'finalizer_github_run_attempt',
  'finalizer_ordinary_ci_run_id',
  'from_dataset_version',
  'from_source_dataset_version',
  'full_release_verified',
  'github_run_id',
  'github_run_attempt',
  'ordinary_ci_run_id',
  'ordinary_ci_workflow',
  'production_environment_authorized',
  'production_pointer_round_trip_verified',
  'recovered_after_pointer_switch',
  'replacement_dataset_version',
  'replacement_source_dataset_version',
  'revoked_dataset_version',
  'revoked_source_dataset_version',
  'revocations_generation',
  'revocations_sha256',
  'rollback_intent_sha256',
  'rollback_intent_text',
  'rollback_revision_id',
  'rolled_back_at',
  'status',
  'storage_bucket',
  'target_manifest_sha256',
  'to_dataset_version',
  'to_source_dataset_version',
]

function assert(condition, message) {
  if (!condition) throw new Error(`Manual rollback rejected: ${message}`)
}

function exactFields(value, fields, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`)
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  assert(actual.length === expected.length && actual.every((field, index) => field === expected[index]), `${label} fields are invalid`)
}

function canonicalIso(value, label) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${label} is invalid`)
  assert(new Date(value).toISOString() === value, `${label} is not canonical ISO time`)
}

function parseJsonText(text, label) {
  assert(typeof text === 'string' && text.endsWith('\n'), `${label} bytes are not canonical`)
  try {
    return JSON.parse(text)
  } catch (_) {
    throw new Error(`Manual rollback rejected: ${label} is not valid JSON`)
  }
}

export function validateManualRollbackIntent(intent, {
  expectedCommitSha,
  expectedGithubRunId,
  expectedGithubRunAttempt,
  expectedDatasetVersion,
  expectedCloudEnvId,
} = {}) {
  exactFields(intent, INTENT_FIELDS, 'manual rollback intent')
  assert(intent.intent_schema_version === MANUAL_ROLLBACK_INTENT_SCHEMA_VERSION, 'intent schema is invalid')
  assert(intent.status === 'manual_data_rollback_prepared', 'intent status is invalid')
  assert(DATASET_PATTERN.test(intent.from_dataset_version || '') && DATASET_PATTERN.test(intent.to_dataset_version || ''), 'intent dataset identity is invalid')
  assert(DATASET_PATTERN.test(intent.from_source_dataset_version || '') && DATASET_PATTERN.test(intent.to_source_dataset_version || ''), 'intent source identity is invalid')
  assert(intent.from_dataset_version !== intent.to_dataset_version, 'intent does not change the active dataset')
  assert(intent.from_source_dataset_version !== intent.to_source_dataset_version, 'intent does not replace the unsafe source dataset')
  assert(REVISION_PATTERN.test(intent.rollback_revision_id || ''), 'intent rollback revision is invalid')
  assert(intent.rollback_revision_id === buildRollbackRevisionId(intent.from_dataset_version), 'intent rollback revision is not deterministic')
  assert(SHA_PATTERN.test(intent.commit_sha || '')
    && RUN_ID_PATTERN.test(intent.github_run_id || '')
    && RUN_ATTEMPT_PATTERN.test(intent.github_run_attempt || ''), 'intent origin run identity is invalid')
  assert(RUN_ID_PATTERN.test(intent.ordinary_ci_run_id || '') && intent.ordinary_ci_workflow === CI_WORKFLOW_PATH, 'intent ordinary CI identity is invalid')
  assert(intent.automatic_release_enabled === true && intent.production_environment_authorized === true, 'intent production authorization is incomplete')
  assert(typeof intent.cloud_env_id === 'string' && intent.cloud_env_id.length > 0, 'intent cloud environment is invalid')
  assert(typeof intent.storage_bucket === 'string' && intent.storage_bucket.length > 0, 'intent storage bucket is invalid')
  assert(SHA256_PATTERN.test(intent.target_manifest_sha256 || ''), 'intent target manifest hash is invalid')
  assert(intent.city_count === 70 && intent.full_release_verified_before === true, 'intent full-release evidence is incomplete')
  assert(typeof intent.pre_switch_verification_output === 'string' && intent.pre_switch_verification_output.includes(`Verified ${intent.to_dataset_version}: 70 city shards`), 'intent verifier output is invalid')
  assert(intent.pre_switch_verification_sha256 === sha256(intent.pre_switch_verification_output), 'intent verifier output hash is invalid')
  canonicalIso(intent.prepared_at, 'intent prepared_at')

  assert(SHA256_PATTERN.test(intent.before_sha256 || '') && intent.before_sha256 === sha256(intent.before_current_text || ''), 'intent baseline bytes are invalid')
  assert(SHA256_PATTERN.test(intent.after_sha256 || '') && intent.after_sha256 === sha256(intent.after_current_text || ''), 'intent candidate bytes are invalid')
  assert(intent.before_sha256 !== intent.after_sha256, 'intent does not change current.json')
  assert(SHA256_PATTERN.test(intent.revocations_sha256 || '') && intent.revocations_sha256 === sha256(intent.revocations_text || ''), 'intent revocations bytes are invalid')

  const before = parseJsonText(intent.before_current_text, 'intent baseline current.json')
  const after = parseJsonText(intent.after_current_text, 'intent candidate current.json')
  const registry = validateRevocationRegistry(parseJsonText(intent.revocations_text, 'intent revocations registry'))
  validateControlPointer(before, { allowLegacy: false })
  validateControlPointer(after, {
    allowLegacy: false,
    registry,
    cloudEnvId: intent.cloud_env_id,
    storageBucket: intent.storage_bucket,
  })

  assert(before.dataset_version === intent.from_dataset_version && before.source_dataset_version === intent.from_source_dataset_version, 'intent baseline identity changed')
  assert(after.dataset_version === intent.to_dataset_version && after.source_dataset_version === intent.to_source_dataset_version, 'intent target identity changed')
  assert(after.manifest_sha256 === intent.target_manifest_sha256, 'intent target manifest changed')
  assert(after.transition_type === 'rollback' && after.rollback_from_dataset_version === intent.from_dataset_version, 'intent rollback transition is invalid')
  assert(after.status_reason === 'manual_rollback' && after.published_at === intent.prepared_at && after.control_generated_at === intent.prepared_at, 'intent rollback timing or reason is invalid')
  assert(intent.before_control_generation === before.control_generation && intent.before_revocations_generation === before.revocations_generation, 'intent baseline generations are invalid')
  assert(intent.control_generation === before.control_generation + 1 && after.control_generation === intent.control_generation, 'intent control generation is invalid')
  assert(intent.revocations_generation === before.revocations_generation + 1 && registry.generation === intent.revocations_generation && after.revocations_generation === intent.revocations_generation, 'intent revocations generation is invalid')
  assert(after.revocations_sha256 === intent.revocations_sha256, 'intent pointer does not bind the revocations registry')
  assertRollbackClosure(registry, {
    failedDatasetVersion: intent.from_dataset_version,
    failedSourceDatasetVersion: intent.from_source_dataset_version,
    targetDatasetVersion: intent.to_dataset_version,
    targetSourceDatasetVersion: intent.to_source_dataset_version,
    revisionId: intent.rollback_revision_id,
  })
  assertTargetNotRevoked(registry, {
    datasetVersion: intent.to_dataset_version,
    sourceDatasetVersion: intent.to_source_dataset_version,
  })

  if (expectedCommitSha !== undefined) assert(intent.commit_sha === expectedCommitSha, 'intent origin commit differs from the protected run')
  if (expectedGithubRunId !== undefined) assert(intent.github_run_id === String(expectedGithubRunId), 'intent origin run differs from the protected run')
  if (expectedGithubRunAttempt !== undefined) assert(intent.github_run_attempt === String(expectedGithubRunAttempt), 'intent origin run attempt differs from the protected run')
  if (expectedDatasetVersion !== undefined) assert(intent.to_dataset_version === expectedDatasetVersion, 'intent target differs from the requested dataset')
  if (expectedCloudEnvId !== undefined) assert(intent.cloud_env_id === expectedCloudEnvId, 'intent environment differs from the requested environment')
  return { intent, before, after, registry }
}

export function buildManualRollbackIntent({
  beforeCurrentText,
  afterCurrentText,
  revocationsText,
  targetManifestSha256,
  rollbackRevisionId,
  preparedAt,
  cloudEnvId,
  storageBucket,
  commitSha,
  githubRunId,
  githubRunAttempt,
  ordinaryCiRunId,
  preSwitchVerificationOutput,
}) {
  const before = parseJsonText(beforeCurrentText, 'baseline current.json')
  const after = parseJsonText(afterCurrentText, 'candidate current.json')
  const registry = parseJsonText(revocationsText, 'candidate revocations registry')
  const intent = {
    intent_schema_version: MANUAL_ROLLBACK_INTENT_SCHEMA_VERSION,
    status: 'manual_data_rollback_prepared',
    prepared_at: preparedAt,
    cloud_env_id: cloudEnvId,
    storage_bucket: storageBucket,
    from_dataset_version: before.dataset_version,
    from_source_dataset_version: before.source_dataset_version,
    to_dataset_version: after.dataset_version,
    to_source_dataset_version: after.source_dataset_version,
    rollback_revision_id: rollbackRevisionId,
    target_manifest_sha256: targetManifestSha256,
    before_current_text: beforeCurrentText,
    before_sha256: sha256(beforeCurrentText),
    after_current_text: afterCurrentText,
    after_sha256: sha256(afterCurrentText),
    revocations_text: revocationsText,
    revocations_sha256: sha256(revocationsText),
    before_control_generation: before.control_generation,
    before_revocations_generation: before.revocations_generation,
    control_generation: after.control_generation,
    revocations_generation: registry.generation,
    city_count: 70,
    full_release_verified_before: true,
    pre_switch_verification_output: preSwitchVerificationOutput,
    pre_switch_verification_sha256: sha256(preSwitchVerificationOutput),
    automatic_release_enabled: true,
    production_environment_authorized: true,
    commit_sha: commitSha,
    github_run_id: String(githubRunId),
    github_run_attempt: String(githubRunAttempt),
    ordinary_ci_workflow: CI_WORKFLOW_PATH,
    ordinary_ci_run_id: String(ordinaryCiRunId),
  }
  validateManualRollbackIntent(intent, {
    expectedCommitSha: commitSha,
    expectedGithubRunId: githubRunId,
    expectedGithubRunAttempt: githubRunAttempt,
    expectedDatasetVersion: after.dataset_version,
    expectedCloudEnvId: cloudEnvId,
  })
  return intent
}

export function manualRollbackIntentText(intent) {
  validateManualRollbackIntent(intent)
  return `${JSON.stringify(intent, null, 2)}\n`
}

export function parseManualRollbackIntentText(text, options = {}) {
  const intent = parseJsonText(text, 'manual rollback intent')
  validateManualRollbackIntent(intent, options)
  assert(text === manualRollbackIntentText(intent), 'intent bytes are not canonical')
  return intent
}

export function manualRollbackIntentFileName(text) {
  parseManualRollbackIntentText(text)
  return `manual-data-rollback-intent-${sha256(text)}.json`
}

export function classifyManualRollbackIntentState(currentText, intent) {
  validateManualRollbackIntent(intent)
  if (currentText === intent.before_current_text) return 'old_active'
  if (currentText === intent.after_current_text) return 'target_active'
  return 'conflict'
}

export function assertManualRollbackWriteOrigin(intent, { commitSha, githubRunId, githubRunAttempt } = {}) {
  validateManualRollbackIntent(intent)
  assert(intent.commit_sha === commitSha, 'a different commit may not execute the prepared rollback write')
  assert(intent.github_run_id === String(githubRunId), 'a different GitHub run may only finalize an already-applied rollback')
  assert(intent.github_run_attempt === String(githubRunAttempt), 'a different GitHub run attempt may only finalize an already-applied rollback')
  return intent
}

export function buildManualRollbackAudit({
  intentText,
  finalizerCommitSha,
  finalizerGithubRunId,
  finalizerGithubRunAttempt,
  finalizerOrdinaryCiRunId,
  recoveredAfterPointerSwitch,
  cloudFunctionVerified,
}) {
  const intent = parseManualRollbackIntentText(intentText)
  const audit = {
    audit_schema_version: MANUAL_ROLLBACK_AUDIT_SCHEMA_VERSION,
    status: 'rolled_back',
    rolled_back_at: intent.prepared_at,
    rollback_intent_text: intentText,
    rollback_intent_sha256: sha256(intentText),
    recovered_after_pointer_switch: recoveredAfterPointerSwitch,
    cloud_env_id: intent.cloud_env_id,
    storage_bucket: intent.storage_bucket,
    from_dataset_version: intent.from_dataset_version,
    from_source_dataset_version: intent.from_source_dataset_version,
    to_dataset_version: intent.to_dataset_version,
    to_source_dataset_version: intent.to_source_dataset_version,
    rollback_revision_id: intent.rollback_revision_id,
    revoked_dataset_version: intent.from_dataset_version,
    revoked_source_dataset_version: intent.from_source_dataset_version,
    replacement_dataset_version: intent.to_dataset_version,
    replacement_source_dataset_version: intent.to_source_dataset_version,
    target_manifest_sha256: intent.target_manifest_sha256,
    before_sha256: intent.before_sha256,
    after_sha256: intent.after_sha256,
    revocations_sha256: intent.revocations_sha256,
    before_control_generation: intent.before_control_generation,
    before_revocations_generation: intent.before_revocations_generation,
    control_generation: intent.control_generation,
    revocations_generation: intent.revocations_generation,
    city_count: intent.city_count,
    full_release_verified: true,
    production_pointer_round_trip_verified: true,
    cloud_function_verified: cloudFunctionVerified,
    automatic_release_enabled: intent.automatic_release_enabled,
    production_environment_authorized: intent.production_environment_authorized,
    commit_sha: intent.commit_sha,
    github_run_id: intent.github_run_id,
    github_run_attempt: intent.github_run_attempt,
    ordinary_ci_workflow: intent.ordinary_ci_workflow,
    ordinary_ci_run_id: intent.ordinary_ci_run_id,
    finalizer_commit_sha: finalizerCommitSha,
    finalizer_github_run_id: String(finalizerGithubRunId),
    finalizer_github_run_attempt: String(finalizerGithubRunAttempt),
    finalizer_ordinary_ci_run_id: String(finalizerOrdinaryCiRunId),
  }
  validateManualRollbackAudit(audit, {
    datasetVersion: intent.to_dataset_version,
    cloudEnvId: intent.cloud_env_id,
    storageBucket: intent.storage_bucket,
    expectedOriginCommitSha: intent.commit_sha,
    expectedOriginGithubRunId: intent.github_run_id,
    expectedOriginGithubRunAttempt: intent.github_run_attempt,
    expectedFinalizerCommitSha: finalizerCommitSha,
    expectedFinalizerGithubRunId: finalizerGithubRunId,
    expectedFinalizerGithubRunAttempt: finalizerGithubRunAttempt,
    expectedFinalizerOrdinaryCiRunId: finalizerOrdinaryCiRunId,
  })
  return audit
}

export function validateManualRollbackAudit(audit, {
  datasetVersion,
  cloudEnvId,
  storageBucket,
  expectedOriginCommitSha,
  expectedOriginGithubRunId,
  expectedOriginGithubRunAttempt,
  expectedFinalizerCommitSha,
  expectedFinalizerGithubRunId,
  expectedFinalizerGithubRunAttempt,
  expectedFinalizerOrdinaryCiRunId,
} = {}) {
  exactFields(audit, AUDIT_FIELDS, 'manual rollback audit')
  assert(audit.audit_schema_version === MANUAL_ROLLBACK_AUDIT_SCHEMA_VERSION, 'manual rollback audit schema is invalid')
  assert(audit.status === 'rolled_back', 'manual rollback audit status is invalid')
  assert(typeof audit.rollback_intent_text === 'string' && audit.rollback_intent_sha256 === sha256(audit.rollback_intent_text), 'manual rollback audit intent hash is invalid')
  const intent = parseManualRollbackIntentText(audit.rollback_intent_text, {
    expectedCommitSha: expectedOriginCommitSha,
    expectedGithubRunId: expectedOriginGithubRunId,
    expectedGithubRunAttempt: expectedOriginGithubRunAttempt,
    expectedDatasetVersion: datasetVersion,
    expectedCloudEnvId: cloudEnvId,
  })
  assert(audit.cloud_env_id === intent.cloud_env_id && audit.storage_bucket === intent.storage_bucket, 'manual rollback audit authority differs from its intent')
  if (storageBucket !== undefined) assert(audit.storage_bucket === storageBucket, 'manual rollback audit storage bucket mismatch')
  assert(audit.rolled_back_at === intent.prepared_at, 'manual rollback audit timestamp differs from its intent')
  for (const field of [
    'from_dataset_version',
    'from_source_dataset_version',
    'to_dataset_version',
    'to_source_dataset_version',
    'rollback_revision_id',
    'target_manifest_sha256',
    'before_sha256',
    'after_sha256',
    'revocations_sha256',
    'before_control_generation',
    'before_revocations_generation',
    'control_generation',
    'revocations_generation',
    'city_count',
    'automatic_release_enabled',
    'production_environment_authorized',
    'commit_sha',
    'github_run_id',
    'github_run_attempt',
    'ordinary_ci_workflow',
    'ordinary_ci_run_id',
  ]) {
    assert(audit[field] === intent[field], `manual rollback audit ${field} differs from its intent`)
  }
  assert(audit.revoked_dataset_version === intent.from_dataset_version && audit.revoked_source_dataset_version === intent.from_source_dataset_version, 'manual rollback audit revocation identity is invalid')
  assert(audit.replacement_dataset_version === intent.to_dataset_version && audit.replacement_source_dataset_version === intent.to_source_dataset_version, 'manual rollback audit replacement identity is invalid')
  assert(audit.full_release_verified === true && audit.production_pointer_round_trip_verified === true && audit.cloud_function_verified === true, 'manual rollback audit verification evidence is incomplete')
  assert(typeof audit.recovered_after_pointer_switch === 'boolean', 'manual rollback audit recovery flag is invalid')
  assert(SHA_PATTERN.test(audit.finalizer_commit_sha || '')
    && RUN_ID_PATTERN.test(audit.finalizer_github_run_id || '')
    && RUN_ATTEMPT_PATTERN.test(audit.finalizer_github_run_attempt || '')
    && RUN_ID_PATTERN.test(audit.finalizer_ordinary_ci_run_id || ''), 'manual rollback audit finalizer identity is invalid')
  if (!audit.recovered_after_pointer_switch) {
    assert(audit.finalizer_commit_sha === intent.commit_sha
      && audit.finalizer_github_run_id === intent.github_run_id
      && audit.finalizer_github_run_attempt === intent.github_run_attempt
      && audit.finalizer_ordinary_ci_run_id === intent.ordinary_ci_run_id,
    'normal rollback audit must be finalized by its exact origin attempt and CI')
  }
  if (expectedFinalizerCommitSha !== undefined) assert(audit.finalizer_commit_sha === expectedFinalizerCommitSha, 'manual rollback audit finalizer commit mismatch')
  if (expectedFinalizerGithubRunId !== undefined) assert(audit.finalizer_github_run_id === String(expectedFinalizerGithubRunId), 'manual rollback audit finalizer run mismatch')
  if (expectedFinalizerGithubRunAttempt !== undefined) assert(audit.finalizer_github_run_attempt === String(expectedFinalizerGithubRunAttempt), 'manual rollback audit finalizer run attempt mismatch')
  if (expectedFinalizerOrdinaryCiRunId !== undefined) assert(audit.finalizer_ordinary_ci_run_id === String(expectedFinalizerOrdinaryCiRunId), 'manual rollback audit finalizer ordinary CI mismatch')
  return audit
}

export function manualRollbackAuditFileName(audit) {
  validateManualRollbackAudit(audit, {
    datasetVersion: audit?.to_dataset_version,
    cloudEnvId: audit?.cloud_env_id,
    storageBucket: audit?.storage_bucket,
    expectedOriginCommitSha: audit?.commit_sha,
    expectedOriginGithubRunId: audit?.github_run_id,
    expectedOriginGithubRunAttempt: audit?.github_run_attempt,
    expectedFinalizerCommitSha: audit?.finalizer_commit_sha,
    expectedFinalizerGithubRunId: audit?.finalizer_github_run_id,
    expectedFinalizerGithubRunAttempt: audit?.finalizer_github_run_attempt,
    expectedFinalizerOrdinaryCiRunId: audit?.finalizer_ordinary_ci_run_id,
  })
  return `manual-data-rollback-${audit.rolled_back_at.replace(/[:.]/g, '-')}.json`
}
