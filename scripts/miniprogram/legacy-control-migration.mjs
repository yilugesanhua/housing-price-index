import {
  AUDITED_LEGACY_MIGRATIONS,
  buildControlValidUntil,
  buildRevocationRegistryArtifact,
  createRevocationRegistry,
  sha256,
  stableJson,
  validateControlPointer,
  validateRevocationRegistry,
} from './control-plane.mjs'

const LEGACY_POINTER_FIELDS = [
  'dataset_as_of',
  'dataset_version',
  'manifest_file_id',
  'manifest_sha256',
  'next_check_at',
  'previous_dataset_version',
  'published_at',
  'schema_version',
]

export const LEGACY_MIGRATION_AUDIT_SCHEMA_VERSION = 'legacy-control-migration-audit-v3'
export const LEGACY_MIGRATION_INTENT_SCHEMA_VERSION = 'legacy-control-migration-intent-v3'
export const LEGACY_MIGRATION_VALIDATOR_ID = 'housing-control-validator-v2'
export const LEGACY_MIGRATION_RECEIPT_SCHEMA_VERSION = '1.0.0'
export const LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS = 600000

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/
const GITHUB_RUN_ID_PATTERN = /^\d+$/
const GITHUB_RUN_ATTEMPT_PATTERN = /^[1-9]\d*$/
const EVIDENCE_FIXTURE_FIELDS = [
  'dataset_version',
  'dry_run',
  'evidence_files',
  'independent_audit',
  'migration_id',
  'schema_version',
  'source_dataset_version',
]
const EVIDENCE_FILE_FIELDS = ['path', 'raw_sha256', 'role']
const INDEPENDENT_AUDIT_FIELDS = [
  'audit_version',
  'batch_count',
  'batches',
  'batches_stable_sha256',
  'coverage_end',
  'coverage_start',
  'record_count',
]
const DRY_RUN_FIELDS = [
  'expected_candidate_sha256',
  'expected_revocations_sha256',
  'legacy_current_text',
  'manifest_context',
  'migrated_at',
]
const MIGRATION_INTENT_FIELDS = [
  'after_current_text',
  'after_sha256',
  'before_current_text',
  'before_sha256',
  'city_count',
  'cloud_env_id',
  'commit_sha',
  'dataset_version',
  'fixed_evidence_verified',
  'full_release_verified_before',
  'github_run_id',
  'github_run_attempt',
  'intent_schema_version',
  'manifest_sha256',
  'manifest_text',
  'migrated_at',
  'migration_id',
  'pre_switch_verification_sha256',
  'pre_switch_verification',
  'revocations_sha256',
  'revocations_text',
  'source_dataset_version',
  'status',
  'storage_bucket',
  'validator_contract',
]
const PRE_SWITCH_VERIFICATION_FIELDS = [
  'bootstrap_bytes',
  'bootstrap_sha256',
  'city_files',
  'current_sha256',
  'dataset_version',
  'evidence_schema_version',
  'manifest_bytes',
  'manifest_sha256',
  'source_dataset_version',
  'status',
  'total_bytes',
  'verification_scope',
  'verifier',
  'verifier_output',
]
const PRE_SWITCH_CITY_FILE_FIELDS = ['bytes', 'city_id', 'sha256']
const MIGRATION_INTENT_VALIDATOR_FIELDS = [
  'contract_sha256',
  'max_receipt_validity_ms',
  'receipt_schema_version',
  'validator_id',
]
const MIGRATION_AUDIT_FIELDS = [
  'after_sha256',
  'audit_schema_version',
  'automatic_release_enabled',
  'before_sha256',
  'city_count',
  'cloud_env_id',
  'cloud_function_response_observed',
  'commit_sha',
  'control_generation',
  'dataset_version',
  'describe_validator_observed',
  'describe_validator_verified',
  'fixed_evidence_verified',
  'full_release_verified_after',
  'full_release_verified_before',
  'finalizer_commit_sha',
  'finalizer_github_run_id',
  'finalizer_github_run_attempt',
  'github_run_id',
  'github_run_attempt',
  'legacy_control_migration_authorized',
  'legacy_current_raw_sha256_verified',
  'legacy_manifest_raw_sha256_verified',
  'manifest_sha256',
  'max_receipt_validity_ms',
  'migrated_at',
  'migration_id',
  'migration_intent_sha256',
  'migration_intent_text',
  'migration_pointer_validated',
  'post_write_current',
  'post_write_current_fingerprint',
  'post_write_current_sha256',
  'post_write_receipt_valid_until',
  'post_write_receipt_validated_at',
  'post_write_validation_receipt_sha256',
  'post_write_validation_receipt_verified',
  'production_release_authorized',
  'production_pointer_round_trip_verified',
  'receipt_schema_version',
  'recovered_after_pointer_switch',
  'revocation_registry_round_trip_verified',
  'revocations_generation',
  'revocations_sha256',
  'source_dataset_version',
  'status',
  'storage_bucket',
  'strict_validator_evidence_sha256',
  'strict_validator_verified',
  'validator_id',
  'validator_preflight_response_sha256',
]
const VALIDATOR_DESCRIPTION_FIELDS = ['max_receipt_validity_ms', 'receipt_schema_version', 'validator_id']
const VALIDATION_RECEIPT_FIELDS = [
  'control_generation',
  'current_fingerprint',
  'manifest_sha256',
  'receipt_schema_version',
  'revocations_generation',
  'revocations_sha256',
  'validated_at',
  'valid_until',
  'validator_id',
]

const FIXED_EVIDENCE = {
  'legacy-control-2026-06-e9788d0bddf3': {
    schema_version: 'legacy-control-migration-evidence-v1',
    fixture_raw_sha256: '2e6ce6cc3fc266236134ee3241f3edc6312836c6dee63e636dc44a60dc3a8d61',
    evidence_files: {
      publish_audit: {
        path: 'data/releases/2026-06-e9788d0bddf3.json',
        raw_sha256: '4feebce388f750e0aa4c00907f47bca13f94521e3daf5efb73c568cd1990f569',
      },
      invalid_pointer_correction: {
        path: 'data/releases/2026-06-679ea146d4e2.correction.json',
        raw_sha256: '416ac8ebc8355832e39b9d3b750fc0fe555039ba13cb2d806e3be72d91879a7a',
      },
      source_correction: {
        path: 'data/releases/2026-06-ec36ff8fb2e5.correction.json',
        raw_sha256: '71c296ea0032c8f5a35ddffa63ffdb2ee41787fe6e17f5c5ee57ccf8e62ccc1d',
      },
    },
    independent_audit: {
      audit_version: 'full-record-audit-v5',
      coverage_start: '2016-01',
      coverage_end: '2026-06',
      batch_count: 126,
      record_count: 70560,
      batches_stable_sha256: '2b2879af0ddafad9df805627dbd3bbc0105b538fd9b3baeaa6af130bb24a98fd',
    },
    dry_run: {
      migrated_at: '2026-07-31T06:00:00.000Z',
      expected_candidate_sha256: '840d3b65a9e1a20ef28ee5c3c4261f2e9cffa45a6450f6b2262b9dee3d51bc10',
      expected_revocations_sha256: '2dd55d55908afb9e4e9fa6da5fd1ee7b0c8c7695d1f70fece92a80c7fe40f457',
    },
  },
}

function assert(condition, message) {
  if (!condition) throw new Error(`Legacy control migration rejected: ${message}`)
}

function exactFields(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`)
  const actual = Object.keys(value).sort()
  const fields = [...expected].sort()
  assert(actual.length === fields.length && actual.every((field, index) => field === fields[index]), `${label} fields are invalid`)
}

function canonicalIso(value, label) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${label} is invalid`)
  assert(new Date(value).toISOString() === value, `${label} is not canonical ISO 8601`)
  return Date.parse(value)
}

function parseJsonText(text, label) {
  assert(typeof text === 'string', `${label} bytes are unavailable`)
  try {
    return JSON.parse(text)
  } catch (_) {
    throw new Error(`Legacy control migration rejected: ${label} is not JSON`)
  }
}

function scfPayload(invocation, label) {
  const result = invocation?.Result
  assert(result && typeof result === 'object' && !Array.isArray(result), `${label} SDK result is missing`)
  assert(result.InvokeResult === 0, `${label} invocation failed${result.ErrMsg ? `: ${result.ErrMsg}` : ''}`)
  assert(typeof result.RetMsg === 'string', `${label} authoritative RetMsg is missing`)
  return parseJsonText(result.RetMsg, `${label} RetMsg`)
}

function pointerFingerprint(current) {
  const canonical = stableJson(current)
  assert(canonical.endsWith('\n'), 'canonical current pointer encoding is invalid')
  return sha256(canonical.slice(0, -1))
}

export function buildValidatorContract(values = {}) {
  const contract = {
    validator_id: values.validator_id || LEGACY_MIGRATION_VALIDATOR_ID,
    receipt_schema_version: values.receipt_schema_version || LEGACY_MIGRATION_RECEIPT_SCHEMA_VERSION,
    max_receipt_validity_ms: values.max_receipt_validity_ms || LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS,
  }
  return {
    ...contract,
    contract_sha256: sha256(stableJson({ validator: contract })),
  }
}

export function validateValidatorContract(contract) {
  exactFields(contract, MIGRATION_INTENT_VALIDATOR_FIELDS, 'migration intent validator contract')
  const expected = buildValidatorContract(contract)
  assert(contract.validator_id === LEGACY_MIGRATION_VALIDATOR_ID, 'migration intent validator contract ID is invalid')
  assert(contract.receipt_schema_version === LEGACY_MIGRATION_RECEIPT_SCHEMA_VERSION, 'migration intent validator contract receipt schema is invalid')
  assert(contract.max_receipt_validity_ms === LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS, 'migration intent validator contract receipt validity is invalid')
  assert(contract.contract_sha256 === expected.contract_sha256, 'migration intent validator contract hash is invalid')
  return contract
}

export function validateValidatorPreflightInvocation(invocation) {
  const payload = scfPayload(invocation, 'validator preflight')
  exactFields(payload, ['validator'], 'validator preflight payload')
  exactFields(payload.validator, VALIDATOR_DESCRIPTION_FIELDS, 'validator preflight identity')
  assert(payload.validator.validator_id === LEGACY_MIGRATION_VALIDATOR_ID, 'validator preflight ID is invalid')
  assert(payload.validator.receipt_schema_version === LEGACY_MIGRATION_RECEIPT_SCHEMA_VERSION, 'validator preflight receipt schema is invalid')
  assert(payload.validator.max_receipt_validity_ms === LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS, 'validator preflight receipt validity is invalid')
  return {
    ...payload.validator,
    describe_validator_observed: true,
    describe_validator_verified: true,
    response_sha256: sha256(stableJson(payload)),
  }
}

export function validatePostWriteValidationReceiptInvocation(invocation, expectedCurrent, {
  observedAt = new Date().toISOString(),
} = {}) {
  const payload = scfPayload(invocation, 'post-write validator')
  exactFields(payload, ['current', 'validation_receipt'], 'post-write validator payload')
  assert(stableJson(payload.current) === stableJson(expectedCurrent), 'post-write validator current pointer differs from the expected pointer')
  const receipt = payload.validation_receipt
  exactFields(receipt, VALIDATION_RECEIPT_FIELDS, 'post-write validation receipt')
  assert(receipt.validator_id === LEGACY_MIGRATION_VALIDATOR_ID, 'post-write validation receipt validator is invalid')
  assert(receipt.receipt_schema_version === LEGACY_MIGRATION_RECEIPT_SCHEMA_VERSION, 'post-write validation receipt schema is invalid')
  const validatedAt = canonicalIso(receipt.validated_at, 'post-write receipt validated_at')
  const validUntil = canonicalIso(receipt.valid_until, 'post-write receipt valid_until')
  const observed = canonicalIso(observedAt, 'post-write receipt observation time')
  const controlGeneratedAt = canonicalIso(expectedCurrent.control_generated_at, 'post-write expected control_generated_at')
  assert(validUntil - validatedAt === LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS, 'post-write validation receipt validity window is invalid')
  assert(validatedAt <= observed + 60000 && observed <= validUntil, 'post-write validation receipt is not current')
  assert(validatedAt >= controlGeneratedAt, 'post-write validation receipt predates the control pointer')
  assert(receipt.current_fingerprint === pointerFingerprint(expectedCurrent), 'post-write validation receipt pointer fingerprint is invalid')
  assert(receipt.manifest_sha256 === expectedCurrent.manifest_sha256, 'post-write validation receipt manifest hash is invalid')
  assert(receipt.revocations_sha256 === expectedCurrent.revocations_sha256, 'post-write validation receipt revocations hash is invalid')
  assert(receipt.control_generation === expectedCurrent.control_generation, 'post-write validation receipt control generation is invalid')
  assert(receipt.revocations_generation === expectedCurrent.revocations_generation, 'post-write validation receipt revocations generation is invalid')
  return {
    cloud_function_response_observed: true,
    current_sha256: sha256(stableJson(payload.current)),
    receipt,
    receipt_sha256: sha256(stableJson(receipt)),
    strict_validator_verified: true,
  }
}

export function migrationDescriptor(migrationId) {
  const descriptor = AUDITED_LEGACY_MIGRATIONS[migrationId]
  assert(descriptor, 'migration ID is not approved')
  return descriptor
}

export function validateLegacyCurrentText(text, descriptor = migrationDescriptor('legacy-control-2026-06-e9788d0bddf3')) {
  assert(typeof text === 'string', 'legacy current.json bytes are unavailable')
  assert(sha256(text) === descriptor.legacy_current_sha256, 'legacy current.json raw SHA-256 changed')
  let current
  try { current = JSON.parse(text) } catch (_) { throw new Error('Legacy control migration rejected: legacy current.json is not JSON') }
  exactFields(current, LEGACY_POINTER_FIELDS, 'legacy current.json')
  const releaseRoot = `cloud://${descriptor.cloud_env_id}.${descriptor.storage_bucket}/housing-data/releases/${descriptor.dataset_version}`
  assert(current.dataset_version === descriptor.dataset_version, 'legacy dataset version differs from the approved migration')
  assert(current.dataset_as_of === descriptor.dataset_as_of, 'legacy month differs from the approved migration')
  assert(current.schema_version === descriptor.schema_version, 'legacy schema differs from the approved migration')
  assert(current.manifest_file_id === `${releaseRoot}/manifest.json`, 'legacy manifest file ID differs from the approved migration')
  assert(current.manifest_sha256 === descriptor.legacy_manifest_sha256, 'legacy manifest hash differs from the approved migration')
  assert(current.published_at === descriptor.published_at, 'legacy publication time differs from the approved migration')
  assert(current.previous_dataset_version === descriptor.previous_dataset_version, 'legacy pointer exposes an unapproved previous dataset')
  assert(current.next_check_at === descriptor.next_check_at, 'legacy next check time differs from the approved migration')
  return current
}

export function validateLegacyManifestText(text, current, descriptor = migrationDescriptor('legacy-control-2026-06-e9788d0bddf3')) {
  assert(typeof text === 'string', 'legacy manifest bytes are unavailable')
  assert(sha256(text) === descriptor.legacy_manifest_sha256, 'legacy manifest raw SHA-256 changed')
  let manifest
  try { manifest = JSON.parse(text) } catch (_) { throw new Error('Legacy control migration rejected: legacy manifest is not JSON') }
  assert(current?.manifest_sha256 === descriptor.legacy_manifest_sha256, 'legacy pointer and manifest hash differ')
  assert(manifest.dataset_version === descriptor.dataset_version, 'legacy manifest dataset version is invalid')
  assert(manifest.source_dataset_version === descriptor.source_dataset_version, 'legacy manifest source dataset version is invalid')
  assert(manifest.dataset_as_of === descriptor.dataset_as_of, 'legacy manifest month is invalid')
  assert(manifest.schema_version === descriptor.schema_version, 'legacy manifest schema is invalid')
  assert(manifest.release_type === undefined, 'immutable legacy manifest must not be relabelled')
  assert(manifest.validation_status === 'passed', 'legacy manifest validation status is not passed')
  assert(manifest.bootstrap_file_id === current.manifest_file_id.replace(/\/manifest\.json$/, '/bootstrap.json'), 'legacy bootstrap file ID is invalid')
  assert(Object.keys(manifest.city_files || {}).length === 70, 'legacy manifest does not contain exactly 70 cities')
  return manifest
}

export function validateMigrationEvidenceFixture(fixture, descriptor = migrationDescriptor('legacy-control-2026-06-e9788d0bddf3')) {
  exactFields(fixture, EVIDENCE_FIXTURE_FIELDS, 'migration evidence fixture')
  const fixed = FIXED_EVIDENCE[descriptor.migration_id]
  assert(fixed, 'fixed migration evidence is unavailable')
  assert(fixture.schema_version === fixed.schema_version, 'migration evidence fixture schema is invalid')
  assert(fixture.migration_id === descriptor.migration_id, 'migration evidence fixture ID is invalid')
  assert(fixture.dataset_version === descriptor.dataset_version, 'migration evidence fixture dataset is invalid')
  assert(fixture.source_dataset_version === descriptor.source_dataset_version, 'migration evidence fixture source dataset is invalid')

  assert(Array.isArray(fixture.evidence_files) && fixture.evidence_files.length === 3, 'migration evidence file list is incomplete')
  const filesByRole = new Map()
  for (const file of fixture.evidence_files) {
    exactFields(file, EVIDENCE_FILE_FIELDS, 'migration evidence file')
    assert(!filesByRole.has(file.role), `migration evidence role is duplicated: ${file.role}`)
    filesByRole.set(file.role, file)
  }
  for (const [role, expected] of Object.entries(fixed.evidence_files)) {
    const actual = filesByRole.get(role)
    assert(actual?.path === expected.path, `migration evidence path changed for ${role}`)
    assert(actual?.raw_sha256 === expected.raw_sha256, `migration evidence hash changed for ${role}`)
  }

  exactFields(fixture.independent_audit, INDEPENDENT_AUDIT_FIELDS, 'migration independent audit fixture')
  for (const [field, expected] of Object.entries(fixed.independent_audit)) {
    assert(fixture.independent_audit[field] === expected, `migration independent audit ${field} changed`)
  }
  const fixedBatches = fixture.independent_audit.batches
  assert(Array.isArray(fixedBatches) && fixedBatches.length === fixed.independent_audit.batch_count, 'fixed migration audit batches are incomplete')
  assert(fixedBatches.every((batch) => batch?.result === 'passed'), 'fixed migration audit contains a failed batch')
  assert(fixedBatches.reduce((total, batch) => total + Number(batch?.records_checked || 0), 0) === fixed.independent_audit.record_count, 'fixed migration audit record count is invalid')
  assert(fixedBatches[0]?.stat_month === fixed.independent_audit.coverage_start
    && fixedBatches.at(-1)?.stat_month === fixed.independent_audit.coverage_end, 'fixed migration audit month coverage is invalid')
  assert(sha256(stableJson(fixedBatches)) === fixed.independent_audit.batches_stable_sha256, 'fixed migration audit batch identities changed')

  exactFields(fixture.dry_run, DRY_RUN_FIELDS, 'migration dry-run fixture')
  exactFields(fixture.dry_run.manifest_context, ['dataset_as_of', 'dataset_version', 'schema_version', 'source_dataset_version'], 'migration dry-run manifest context')
  canonicalIso(fixture.dry_run.migrated_at, 'migration dry-run timestamp')
  assert(fixture.dry_run.migrated_at === fixed.dry_run.migrated_at, 'migration dry-run timestamp changed')
  assert(fixture.dry_run.expected_candidate_sha256 === fixed.dry_run.expected_candidate_sha256, 'migration dry-run candidate hash changed')
  assert(fixture.dry_run.expected_revocations_sha256 === fixed.dry_run.expected_revocations_sha256, 'migration dry-run revocations hash changed')
  assert(fixture.dry_run.manifest_context.dataset_version === descriptor.dataset_version, 'migration dry-run manifest dataset is invalid')
  assert(fixture.dry_run.manifest_context.source_dataset_version === descriptor.source_dataset_version, 'migration dry-run manifest source dataset is invalid')
  assert(fixture.dry_run.manifest_context.dataset_as_of === descriptor.dataset_as_of, 'migration dry-run manifest month is invalid')
  assert(fixture.dry_run.manifest_context.schema_version === descriptor.schema_version, 'migration dry-run manifest schema is invalid')
  validateLegacyCurrentText(fixture.dry_run.legacy_current_text, descriptor)
  return fixture
}

export function parseMigrationEvidenceFixtureText(
  fixtureText,
  descriptor = migrationDescriptor('legacy-control-2026-06-e9788d0bddf3'),
) {
  const fixed = FIXED_EVIDENCE[descriptor.migration_id]
  assert(typeof fixtureText === 'string', 'migration evidence fixture bytes are unavailable')
  assert(sha256(fixtureText) === fixed?.fixture_raw_sha256, 'migration evidence fixture raw SHA-256 changed')
  return validateMigrationEvidenceFixture(parseJsonText(fixtureText, 'migration evidence fixture'), descriptor)
}

export function assertMigrationEvidence(
  { publishAudit, invalidPointerCorrection, sourceCorrection, auditReport } = {},
  descriptor = migrationDescriptor('legacy-control-2026-06-e9788d0bddf3'),
  auditExpectation = FIXED_EVIDENCE[descriptor.migration_id]?.independent_audit,
) {
  assert(publishAudit?.status === 'published', 'current package publish audit is missing')
  assert(publishAudit.cloud_env_id === descriptor.cloud_env_id, 'publish audit cloud environment is invalid')
  assert(publishAudit.dataset_version === descriptor.dataset_version, 'publish audit dataset version is invalid')
  assert(publishAudit.source_dataset_version === descriptor.source_dataset_version, 'publish audit source version is invalid')
  assert(publishAudit.manifest_sha256 === descriptor.legacy_manifest_sha256, 'publish audit manifest hash is invalid')
  assert(publishAudit.current_sha256 === descriptor.legacy_current_sha256, 'publish audit current hash is invalid')
  assert(publishAudit.city_count === 70, 'publish audit city count is invalid')

  const initialRevocation = descriptor.revoked_dataset_versions.find((entry) => entry.revision_id === null)
  assert(invalidPointerCorrection?.status === 'superseded_invalid_pointer', 'invalid-pointer correction audit is missing')
  assert(invalidPointerCorrection.dataset_version === initialRevocation.dataset_version, 'invalid-pointer correction dataset is invalid')
  assert(invalidPointerCorrection.replacement_dataset_version === initialRevocation.replacement_dataset_version, 'invalid-pointer replacement is invalid')
  assert(invalidPointerCorrection.rollback_allowed === false, 'invalid-pointer package remains rollback eligible')

  assert(sourceCorrection?.status === 'superseded_incorrect_source_data', 'incorrect-source correction audit is missing')
  assert(sourceCorrection.dataset_version === descriptor.superseded_dataset_version, 'incorrect-source package identity is invalid')
  assert(sourceCorrection.replacement_dataset_version === descriptor.dataset_version, 'incorrect-source package replacement is invalid')
  assert(sourceCorrection.replacement_source_dataset_version === descriptor.source_dataset_version, 'incorrect-source replacement is invalid')
  assert(sourceCorrection.rollback_allowed === false, 'incorrect-source package remains rollback eligible')

  assert(auditExpectation, 'fixed independent audit expectation is missing')
  assert(auditReport?.result === 'passed', 'current independent audit has not passed')
  assert(auditReport.audit_version === auditExpectation.audit_version, 'current independent audit version is invalid')
  assert(Array.isArray(auditReport.batches), 'current independent audit batches are unavailable')
  const allRecordCount = auditReport.batches.reduce((total, batch) => total + Number(batch?.records_checked || 0), 0)
  assert(auditReport.batch_count === auditReport.batches.length && auditReport.record_count === allRecordCount, 'current independent audit summary differs from its batches')
  assert(auditReport.batches.every((batch) => batch?.result === 'passed'), 'current independent audit contains a failed batch')
  const auditedBatches = auditReport.batches.filter((batch) => (
    batch.stat_month >= auditExpectation.coverage_start && batch.stat_month <= auditExpectation.coverage_end
  ))
  const auditedRecordCount = auditedBatches.reduce((total, batch) => total + Number(batch.records_checked || 0), 0)
  assert(auditedBatches.length === auditExpectation.batch_count && auditedRecordCount === auditExpectation.record_count, 'fixed independent audit coverage is incomplete')
  assert(auditedBatches[0]?.stat_month === auditExpectation.coverage_start
    && auditedBatches.at(-1)?.stat_month === auditExpectation.coverage_end, 'fixed independent audit month coverage is incomplete')
  assert(sha256(stableJson(auditedBatches)) === auditExpectation.batches_stable_sha256, 'fixed independent audit batch summary changed')
  return true
}

export function validateFixedMigrationEvidence(
  { fixtureText, evidenceTexts } = {},
  descriptor = migrationDescriptor('legacy-control-2026-06-e9788d0bddf3'),
) {
  const fixture = parseMigrationEvidenceFixtureText(fixtureText, descriptor)
  assert(evidenceTexts && typeof evidenceTexts === 'object' && !Array.isArray(evidenceTexts), 'migration evidence bytes are unavailable')
  const parsed = {}
  for (const evidenceFile of fixture.evidence_files) {
    const text = evidenceTexts[evidenceFile.role]
    assert(typeof text === 'string', `migration evidence bytes are unavailable for ${evidenceFile.role}`)
    assert(sha256(text) === evidenceFile.raw_sha256, `migration evidence raw SHA-256 changed for ${evidenceFile.role}`)
    parsed[evidenceFile.role] = parseJsonText(text, `migration evidence ${evidenceFile.role}`)
  }
  assertMigrationEvidence({
    publishAudit: parsed.publish_audit,
    invalidPointerCorrection: parsed.invalid_pointer_correction,
    sourceCorrection: parsed.source_correction,
    auditReport: {
      result: 'passed',
      audit_version: fixture.independent_audit.audit_version,
      batch_count: fixture.independent_audit.batch_count,
      record_count: fixture.independent_audit.record_count,
      coverage_start: fixture.independent_audit.coverage_start,
      coverage_end: fixture.independent_audit.coverage_end,
      batches: fixture.independent_audit.batches,
    },
  }, descriptor, fixture.independent_audit)
  return { fixture, evidence: parsed }
}

export function buildDryRunMigrationArtifacts(
  { fixtureText, evidenceTexts, migrationId } = {},
) {
  const descriptor = migrationDescriptor(migrationId)
  const { fixture } = validateFixedMigrationEvidence({ fixtureText, evidenceTexts }, descriptor)
  const legacyCurrent = validateLegacyCurrentText(fixture.dry_run.legacy_current_text, descriptor)
  const manifest = fixture.dry_run.manifest_context
  const registry = buildInitialMigrationRegistry(descriptor)
  const registryArtifact = buildRevocationRegistryArtifact(registry, {
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  })
  const current = buildLegacyMigrationPointer({
    legacyCurrent,
    manifest,
    registryArtifact,
    migratedAt: fixture.dry_run.migrated_at,
    descriptor,
  })
  const currentText = stableJson(current)
  assert(registryArtifact.sha256 === fixture.dry_run.expected_revocations_sha256, 'dry-run revocations candidate changed')
  assert(sha256(currentText) === fixture.dry_run.expected_candidate_sha256, 'dry-run current pointer candidate changed')
  assert(classifyMigrationState(fixture.dry_run.legacy_current_text, migrationId) === 'ready', 'dry-run legacy pointer is not ready')
  assert(classifyMigrationState(currentText, migrationId) === 'already_migrated', 'dry-run migrated pointer is invalid')
  return { descriptor, legacyCurrent, manifest, registry, registryArtifact, current, currentText }
}

export function buildInitialMigrationRegistry(descriptor = migrationDescriptor('legacy-control-2026-06-e9788d0bddf3')) {
  return createRevocationRegistry({
    generatedAt: descriptor.registry_generated_at,
    revokedDatasetVersions: descriptor.revoked_dataset_versions,
    revokedSourceDatasetVersions: descriptor.revoked_source_dataset_versions,
  })
}

export function buildLegacyMigrationPointer({
  legacyCurrent,
  manifest,
  registryArtifact,
  migratedAt,
  descriptor = migrationDescriptor('legacy-control-2026-06-e9788d0bddf3'),
} = {}) {
  assert(legacyCurrent && manifest && registryArtifact, 'migration inputs are incomplete')
  assert(Number.isFinite(Date.parse(migratedAt || '')) && new Date(migratedAt).toISOString() === migratedAt, 'migration time is invalid')
  const current = {
    dataset_version: legacyCurrent.dataset_version,
    source_dataset_version: manifest.source_dataset_version,
    dataset_as_of: legacyCurrent.dataset_as_of,
    schema_version: legacyCurrent.schema_version,
    manifest_file_id: legacyCurrent.manifest_file_id,
    manifest_sha256: legacyCurrent.manifest_sha256,
    published_at: legacyCurrent.published_at,
    previous_dataset_version: null,
    next_check_at: legacyCurrent.next_check_at,
    control_schema_version: '1.0.0',
    control_generation: 1,
    ...registryArtifact.currentFields,
    transition_type: 'migration',
    migration_id: descriptor.migration_id,
    migrated_from_current_sha256: descriptor.legacy_current_sha256,
    migrated_from_manifest_sha256: descriptor.legacy_manifest_sha256,
    superseded_dataset_version: descriptor.superseded_dataset_version,
    superseded_source_dataset_version: descriptor.superseded_source_dataset_version,
    data_status: 'current',
    status_reason: 'audited_legacy_control_migration',
    control_generated_at: migratedAt,
    control_valid_until: buildControlValidUntil(migratedAt),
  }
  validateControlPointer(current, {
    allowLegacy: false,
    requireContext: true,
    manifest,
    registry: registryArtifact.registry,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  })
  return current
}

export function buildMigrationArtifacts({ legacyCurrentText, manifestText, migratedAt, migrationId } = {}) {
  const descriptor = migrationDescriptor(migrationId)
  const legacyCurrent = validateLegacyCurrentText(legacyCurrentText, descriptor)
  const manifest = validateLegacyManifestText(manifestText, legacyCurrent, descriptor)
  const registry = buildInitialMigrationRegistry(descriptor)
  const registryArtifact = buildRevocationRegistryArtifact(registry, {
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  })
  const current = buildLegacyMigrationPointer({ legacyCurrent, manifest, registryArtifact, migratedAt, descriptor })
  return { descriptor, legacyCurrent, manifest, registry, registryArtifact, current, currentText: stableJson(current) }
}

export function buildPreSwitchVerificationEvidence({
  currentText,
  manifestText,
  bootstrapBytes,
  cityFiles,
  verifierOutput,
} = {}) {
  assert(typeof currentText === 'string' && typeof manifestText === 'string', 'pre-switch verification pointer or manifest bytes are missing')
  assert(Buffer.isBuffer(bootstrapBytes), 'pre-switch verification bootstrap bytes are missing')
  assert(cityFiles && typeof cityFiles === 'object' && !Array.isArray(cityFiles), 'pre-switch verification city files are missing')
  const manifest = parseJsonText(manifestText, 'pre-switch verification manifest')
  const cityIds = Object.keys(cityFiles).sort((left, right) => left.localeCompare(right, 'en'))
  assert(cityIds.length === 70 && new Set(cityIds).size === 70, 'pre-switch verification requires exactly 70 unique city files')
  const cities = cityIds.map((cityId) => {
    const bytes = cityFiles[cityId]
    assert(Buffer.isBuffer(bytes), `pre-switch verification city bytes are missing for ${cityId}`)
    const entry = { city_id: cityId, sha256: sha256(bytes), bytes: bytes.length }
    assert(manifest.city_files?.[cityId]?.sha256 === entry.sha256, `pre-switch verification city hash differs for ${cityId}`)
    assert(manifest.city_files?.[cityId]?.bytes === entry.bytes, `pre-switch verification city size differs for ${cityId}`)
    return entry
  })
  const manifestBytes = Buffer.byteLength(manifestText)
  const totalBytes = manifestBytes + bootstrapBytes.length + cities.reduce((sum, entry) => sum + entry.bytes, 0)
  const expectedOutput = `Verified ${manifest.dataset_version}: 70 city shards, ${totalBytes} bytes, exact snapshot reconstruction passed`
  assert(String(verifierOutput || '').trim() === expectedOutput, 'pre-switch verifier did not report exact snapshot reconstruction')
  assert(manifest.bootstrap_sha256 === sha256(bootstrapBytes), 'pre-switch verification bootstrap hash differs')
  assert(manifest.bootstrap_bytes === bootstrapBytes.length, 'pre-switch verification bootstrap size differs')
  return {
    evidence_schema_version: 'legacy-control-pre-switch-verification-v1',
    status: 'passed',
    verifier: 'scripts/miniprogram/verify-remote-data.mjs',
    verification_scope: 'exact_snapshot_reconstruction',
    dataset_version: manifest.dataset_version,
    source_dataset_version: manifest.source_dataset_version,
    current_sha256: sha256(currentText),
    manifest_sha256: sha256(manifestText),
    manifest_bytes: manifestBytes,
    bootstrap_sha256: sha256(bootstrapBytes),
    bootstrap_bytes: bootstrapBytes.length,
    city_files: cities,
    total_bytes: totalBytes,
    verifier_output: expectedOutput,
  }
}

export function validatePreSwitchVerificationEvidence(evidence, { currentText, manifestText } = {}) {
  exactFields(evidence, PRE_SWITCH_VERIFICATION_FIELDS, 'pre-switch verification evidence')
  assert(evidence.evidence_schema_version === 'legacy-control-pre-switch-verification-v1', 'pre-switch verification evidence schema is invalid')
  assert(evidence.status === 'passed', 'pre-switch verification did not pass')
  assert(evidence.verifier === 'scripts/miniprogram/verify-remote-data.mjs', 'pre-switch verification used an unapproved verifier')
  assert(evidence.verification_scope === 'exact_snapshot_reconstruction', 'pre-switch verification scope is incomplete')
  assert(typeof currentText === 'string' && evidence.current_sha256 === sha256(currentText), 'pre-switch verification pointer bytes are not bound')
  assert(typeof manifestText === 'string' && evidence.manifest_sha256 === sha256(manifestText), 'pre-switch verification manifest bytes are not bound')
  assert(evidence.manifest_bytes === Buffer.byteLength(manifestText), 'pre-switch verification manifest size is invalid')
  const manifest = parseJsonText(manifestText, 'pre-switch verification manifest')
  assert(evidence.dataset_version === manifest.dataset_version, 'pre-switch verification dataset is invalid')
  assert(evidence.source_dataset_version === manifest.source_dataset_version, 'pre-switch verification source dataset is invalid')
  assert(evidence.bootstrap_sha256 === manifest.bootstrap_sha256, 'pre-switch verification bootstrap hash is invalid')
  assert(evidence.bootstrap_bytes === manifest.bootstrap_bytes, 'pre-switch verification bootstrap size is invalid')
  assert(Array.isArray(evidence.city_files) && evidence.city_files.length === 70, 'pre-switch verification does not cover 70 cities')
  const expectedCityIds = Object.keys(manifest.city_files || {}).sort((left, right) => left.localeCompare(right, 'en'))
  assert(expectedCityIds.length === 70, 'pre-switch verification manifest does not contain 70 cities')
  for (const [index, entry] of evidence.city_files.entries()) {
    exactFields(entry, PRE_SWITCH_CITY_FILE_FIELDS, `pre-switch verification city ${index}`)
    const cityId = expectedCityIds[index]
    assert(entry.city_id === cityId, 'pre-switch verification city set or order is invalid')
    assert(entry.sha256 === manifest.city_files[cityId].sha256, `pre-switch verification city hash is invalid for ${cityId}`)
    assert(entry.bytes === manifest.city_files[cityId].bytes, `pre-switch verification city size is invalid for ${cityId}`)
  }
  const expectedTotalBytes = evidence.manifest_bytes + evidence.bootstrap_bytes
    + evidence.city_files.reduce((sum, entry) => sum + entry.bytes, 0)
  assert(evidence.total_bytes === expectedTotalBytes, 'pre-switch verification total size is invalid')
  assert(evidence.verifier_output === `Verified ${evidence.dataset_version}: 70 city shards, ${evidence.total_bytes} bytes, exact snapshot reconstruction passed`, 'pre-switch verifier output is invalid')
  return evidence
}

export function validateMigrationIntent(intent, {
  expectedCommitSha,
  expectedGithubRunId,
  expectedGithubRunAttempt,
} = {}) {
  exactFields(intent, MIGRATION_INTENT_FIELDS, 'migration intent')
  assert(intent.intent_schema_version === LEGACY_MIGRATION_INTENT_SCHEMA_VERSION, 'migration intent schema is invalid')
  assert(intent.status === 'legacy_control_migration_prepared', 'migration intent status is invalid')
  const descriptor = migrationDescriptor(intent.migration_id)
  assert(intent.cloud_env_id === descriptor.cloud_env_id, 'migration intent environment is invalid')
  assert(intent.storage_bucket === descriptor.storage_bucket, 'migration intent storage bucket is invalid')
  assert(intent.dataset_version === descriptor.dataset_version, 'migration intent dataset is invalid')
  assert(intent.source_dataset_version === descriptor.source_dataset_version, 'migration intent source dataset is invalid')
  assert(COMMIT_SHA_PATTERN.test(intent.commit_sha || ''), 'migration intent commit SHA is invalid')
  assert(GITHUB_RUN_ID_PATTERN.test(intent.github_run_id || ''), 'migration intent GitHub run ID is invalid')
  assert(GITHUB_RUN_ATTEMPT_PATTERN.test(intent.github_run_attempt || ''), 'migration intent GitHub run attempt is invalid')
  if (expectedCommitSha !== undefined) assert(intent.commit_sha === expectedCommitSha, 'migration intent commit differs from the protected run')
  if (expectedGithubRunId !== undefined) assert(intent.github_run_id === String(expectedGithubRunId), 'migration intent run differs from the approved origin run')
  if (expectedGithubRunAttempt !== undefined) assert(intent.github_run_attempt === String(expectedGithubRunAttempt), 'migration intent run attempt differs from the approved origin run')
  canonicalIso(intent.migrated_at, 'migration intent timestamp')
  assert(intent.before_sha256 === descriptor.legacy_current_sha256, 'migration intent baseline is invalid')
  assert(intent.manifest_sha256 === descriptor.legacy_manifest_sha256, 'migration intent manifest is invalid')
  assert(sha256(intent.before_current_text || '') === intent.before_sha256, 'migration intent legacy pointer bytes changed')
  assert(sha256(intent.manifest_text || '') === intent.manifest_sha256, 'migration intent manifest bytes changed')

  const artifacts = buildMigrationArtifacts({
    legacyCurrentText: intent.before_current_text,
    manifestText: intent.manifest_text,
    migratedAt: intent.migrated_at,
    migrationId: intent.migration_id,
  })
  assert(intent.after_current_text === artifacts.currentText, 'migration intent candidate pointer bytes are not deterministic')
  assert(intent.after_sha256 === sha256(intent.after_current_text), 'migration intent candidate pointer hash is invalid')
  assert(intent.after_sha256 !== intent.before_sha256, 'migration intent does not change the pointer')
  assert(intent.revocations_text === artifacts.registryArtifact.text, 'migration intent revocations bytes are not deterministic')
  assert(intent.revocations_sha256 === artifacts.registryArtifact.sha256, 'migration intent revocations hash is invalid')
  assert(intent.migrated_at === artifacts.current.control_generated_at, 'migration intent timestamp differs from the candidate pointer')
  assert(intent.fixed_evidence_verified === true, 'migration intent fixed evidence is incomplete')
  assert(intent.full_release_verified_before === true && intent.city_count === 70, 'migration intent pre-switch full-release evidence is incomplete')
  validatePreSwitchVerificationEvidence(intent.pre_switch_verification, {
    currentText: intent.before_current_text,
    manifestText: intent.manifest_text,
  })

  validateValidatorContract(intent.validator_contract)
  assert(intent.pre_switch_verification_sha256 === sha256(stableJson(intent.pre_switch_verification)), 'migration intent pre-switch verification hash is invalid')
  return { descriptor, artifacts, intent }
}

export function buildMigrationIntent({
  legacyCurrentText,
  manifestText,
  migratedAt,
  verifiedBefore,
  commitSha,
  githubRunId,
  githubRunAttempt,
  validatorContract,
  validatorPreflight,
  preSwitchVerification,
  descriptor = migrationDescriptor('legacy-control-2026-06-e9788d0bddf3'),
} = {}) {
  assert(verifiedBefore === true, 'migration intent requires pre-switch full-release verification')
  const artifacts = buildMigrationArtifacts({
    legacyCurrentText,
    manifestText,
    migratedAt,
    migrationId: descriptor.migration_id,
  })
  const contractSource = validatorContract || validatorPreflight || {}
  const intent = {
    intent_schema_version: LEGACY_MIGRATION_INTENT_SCHEMA_VERSION,
    status: 'legacy_control_migration_prepared',
    migration_id: descriptor.migration_id,
    migrated_at: migratedAt,
    cloud_env_id: descriptor.cloud_env_id,
    storage_bucket: descriptor.storage_bucket,
    dataset_version: descriptor.dataset_version,
    source_dataset_version: descriptor.source_dataset_version,
    commit_sha: commitSha,
    github_run_id: String(githubRunId || ''),
    github_run_attempt: String(githubRunAttempt || ''),
    before_current_text: legacyCurrentText,
    before_sha256: sha256(legacyCurrentText || ''),
    after_current_text: artifacts.currentText,
    after_sha256: sha256(artifacts.currentText),
    manifest_text: manifestText,
    manifest_sha256: sha256(manifestText || ''),
    revocations_text: artifacts.registryArtifact.text,
    revocations_sha256: artifacts.registryArtifact.sha256,
    city_count: 70,
    fixed_evidence_verified: true,
    full_release_verified_before: verifiedBefore === true,
    validator_contract: buildValidatorContract(contractSource),
    pre_switch_verification: preSwitchVerification,
    pre_switch_verification_sha256: '',
  }
  intent.pre_switch_verification_sha256 = sha256(stableJson(intent.pre_switch_verification))
  validateMigrationIntent(intent, {
    expectedCommitSha: commitSha,
    expectedGithubRunId: githubRunId,
    expectedGithubRunAttempt: githubRunAttempt,
  })
  return intent
}

export function migrationIntentText(intent) {
  validateMigrationIntent(intent)
  return `${JSON.stringify(intent, null, 2)}\n`
}

export function parseMigrationIntentText(text, options = {}) {
  const intent = parseJsonText(text, 'migration intent')
  validateMigrationIntent(intent, options)
  assert(text === `${JSON.stringify(intent, null, 2)}\n`, 'migration intent bytes are not canonical')
  return intent
}

export function migrationIntentFileName(text) {
  parseMigrationIntentText(text)
  return `legacy-control-migration-intent-${sha256(text)}.json`
}

export function classifyMigrationIntentState(currentText, intent) {
  validateMigrationIntent(intent)
  if (currentText === intent.before_current_text) return 'ready'
  if (currentText === intent.after_current_text) return 'recover_finalize'
  return 'conflict'
}

export function classifyMigrationState(currentText, migrationId) {
  const descriptor = migrationDescriptor(migrationId)
  if (sha256(currentText || '') === descriptor.legacy_current_sha256) return 'ready'
  try {
    const current = JSON.parse(currentText)
    if (current.transition_type === 'migration'
      && current.migration_id === descriptor.migration_id
      && current.migrated_from_current_sha256 === descriptor.legacy_current_sha256
      && current.migrated_from_manifest_sha256 === descriptor.legacy_manifest_sha256) return 'already_migrated'
  } catch (_) {}
  return 'conflict'
}

export function validateMigrationAuditTransition(audit, {
  expectedBeforeSha256,
  expectedAfterSha256,
  datasetVersion,
  sourceDatasetVersion,
  manifestSha256,
  cloudEnvId,
  storageBucket,
  expectedCommitSha,
  expectedOriginGithubRunId,
  expectedOriginGithubRunAttempt,
  expectedFinalizerCommitSha,
  expectedFinalizerGithubRunId,
  expectedFinalizerGithubRunAttempt,
} = {}) {
  exactFields(audit, MIGRATION_AUDIT_FIELDS, 'migration audit')
  assert(audit.audit_schema_version === LEGACY_MIGRATION_AUDIT_SCHEMA_VERSION, 'migration audit schema is invalid')
  assert(audit?.status === 'legacy_control_migrated', 'migration audit status is invalid')
  assert(typeof audit.migration_intent_text === 'string', 'migration audit intent bytes are unavailable')
  assert(audit.migration_intent_sha256 === sha256(audit.migration_intent_text), 'migration audit intent hash is invalid')
  const intent = parseMigrationIntentText(audit.migration_intent_text, {
    expectedCommitSha,
    expectedGithubRunId: expectedOriginGithubRunId,
    expectedGithubRunAttempt: expectedOriginGithubRunAttempt,
  })
  const descriptor = migrationDescriptor(audit.migration_id)
  assert(intent.migration_id === audit.migration_id, 'migration audit intent targets a different migration')
  assert(audit.cloud_env_id === descriptor.cloud_env_id, 'migration audit environment is invalid')
  assert(audit.storage_bucket === descriptor.storage_bucket, 'migration audit storage bucket is invalid')
  if (cloudEnvId !== undefined) assert(audit.cloud_env_id === cloudEnvId, 'migration audit environment differs from the monitored environment')
  if (storageBucket !== undefined) assert(audit.storage_bucket === storageBucket, 'migration audit bucket differs from the monitored bucket')
  assert(audit.dataset_version === descriptor.dataset_version, 'migration audit dataset is invalid')
  assert(audit.source_dataset_version === descriptor.source_dataset_version, 'migration audit source dataset is invalid')
  assert(audit.dataset_version === intent.dataset_version && audit.source_dataset_version === intent.source_dataset_version, 'migration audit dataset differs from its intent')
  if (datasetVersion !== undefined) assert(audit.dataset_version === datasetVersion, 'migration audit dataset differs from the monitored dataset')
  if (sourceDatasetVersion !== undefined) assert(audit.source_dataset_version === sourceDatasetVersion, 'migration audit source differs from the monitored source')
  assert(audit.before_sha256 === descriptor.legacy_current_sha256, 'migration audit baseline is invalid')
  assert(audit.before_sha256 === intent.before_sha256, 'migration audit baseline differs from its intent')
  if (expectedBeforeSha256 !== undefined) assert(audit.before_sha256 === expectedBeforeSha256, 'migration audit does not continue the pointer chain')
  assert(audit.manifest_sha256 === descriptor.legacy_manifest_sha256, 'migration audit manifest is invalid')
  assert(audit.manifest_sha256 === intent.manifest_sha256, 'migration audit manifest differs from its intent')
  if (manifestSha256 !== undefined) assert(audit.manifest_sha256 === manifestSha256, 'migration audit manifest differs from the publish audit')
  assert(SHA256_PATTERN.test(audit.after_sha256 || '') && audit.after_sha256 !== audit.before_sha256, 'migration audit result hash is invalid')
  assert(audit.after_sha256 === intent.after_sha256, 'migration audit result differs from its intent')
  if (expectedAfterSha256 !== undefined) assert(audit.after_sha256 === expectedAfterSha256, 'migration audit result differs from the observed pointer')
  assert(SHA256_PATTERN.test(audit.revocations_sha256 || ''), 'migration audit revocations hash is invalid')
  assert(audit.revocations_sha256 === intent.revocations_sha256, 'migration audit revocations differ from its intent')
  assert(audit.control_generation === 1 && audit.revocations_generation === 1, 'migration audit generations are invalid')

  assert(typeof audit.recovered_after_pointer_switch === 'boolean', 'migration audit recovery mode is invalid')
  assert(audit.full_release_verified_before === true
    && intent.full_release_verified_before === true
    && audit.legacy_current_raw_sha256_verified === true, 'migration audit pre-switch evidence is incomplete')
  assert(audit.city_count === 70 && audit.full_release_verified_after === true, 'migration audit full-release evidence is incomplete')
  assert(audit.city_count === intent.city_count, 'migration audit city count differs from its intent')
  assert(audit.fixed_evidence_verified === true, 'migration audit fixed evidence is incomplete')
  assert(audit.legacy_manifest_raw_sha256_verified === true, 'migration audit manifest evidence is incomplete')
  assert(audit.migration_pointer_validated === true, 'migration audit pointer validation is incomplete')
  assert(audit.revocation_registry_round_trip_verified === true, 'migration audit revocation round-trip is incomplete')
  assert(audit.production_pointer_round_trip_verified === true, 'migration audit pointer round-trip is incomplete')
  assert(audit.describe_validator_observed === true, 'migration audit validator preflight response was not observed')
  assert(audit.describe_validator_verified === true, 'migration audit validator preflight was not verified')
  assert(audit.validator_id === LEGACY_MIGRATION_VALIDATOR_ID, 'migration audit validator ID is invalid')
  assert(audit.receipt_schema_version === LEGACY_MIGRATION_RECEIPT_SCHEMA_VERSION, 'migration audit receipt schema is invalid')
  assert(audit.max_receipt_validity_ms === LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS, 'migration audit receipt validity limit is invalid')
  assert(audit.validator_id === intent.validator_contract.validator_id
    && audit.receipt_schema_version === intent.validator_contract.receipt_schema_version
    && audit.max_receipt_validity_ms === intent.validator_contract.max_receipt_validity_ms, 'migration audit validator differs from its intent')
  const validatorPayload = {
    validator: {
      validator_id: audit.validator_id,
      receipt_schema_version: audit.receipt_schema_version,
      max_receipt_validity_ms: audit.max_receipt_validity_ms,
    },
  }
  assert(audit.validator_preflight_response_sha256 === sha256(stableJson(validatorPayload)), 'migration audit validator preflight hash is invalid')
  assert(audit.validator_preflight_response_sha256 === intent.validator_contract.contract_sha256, 'migration audit validator preflight differs from its intent')
  assert(audit.post_write_validation_receipt_verified === true, 'migration audit post-write receipt is incomplete')
  assert(audit.cloud_function_response_observed === true, 'migration audit post-write cloud response was not observed')
  validateControlPointer(audit.post_write_current, {
    allowLegacy: false,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  })
  const postWriteCurrentText = stableJson(audit.post_write_current)
  assert(sha256(postWriteCurrentText) === audit.after_sha256, 'migration audit embedded pointer differs from the migrated pointer')
  assert(postWriteCurrentText === intent.after_current_text, 'migration audit embedded pointer bytes differ from its intent')
  assert(SHA256_PATTERN.test(audit.post_write_current_fingerprint || ''), 'migration audit post-write pointer fingerprint is invalid')
  assert(pointerFingerprint(audit.post_write_current) === audit.post_write_current_fingerprint, 'migration audit post-write pointer fingerprint differs from the embedded pointer')
  assert(audit.post_write_current_sha256 === audit.after_sha256, 'migration audit post-write pointer hash differs from the migrated pointer')
  const receiptValidatedAt = canonicalIso(audit.post_write_receipt_validated_at, 'migration audit receipt validated_at')
  const receiptValidUntil = canonicalIso(audit.post_write_receipt_valid_until, 'migration audit receipt valid_until')
  const migratedAt = canonicalIso(audit.migrated_at, 'migration audit timestamp')
  assert(audit.migrated_at === intent.migrated_at, 'migration audit timestamp differs from its intent')
  assert(audit.migrated_at === audit.post_write_current.control_generated_at, 'migration audit timestamp differs from the migrated pointer')
  assert(receiptValidatedAt >= migratedAt, 'migration audit receipt predates the migration')
  if (audit.recovered_after_pointer_switch === false) {
    assert(receiptValidatedAt <= migratedAt + LEGACY_MIGRATION_MAX_RECEIPT_VALIDITY_MS, 'migration audit receipt is implausibly later than the migration')
  }
  assert(receiptValidUntil - receiptValidatedAt === audit.max_receipt_validity_ms, 'migration audit receipt validity window is invalid')
  const receipt = {
    receipt_schema_version: audit.receipt_schema_version,
    validator_id: audit.validator_id,
    validated_at: audit.post_write_receipt_validated_at,
    valid_until: audit.post_write_receipt_valid_until,
    current_fingerprint: audit.post_write_current_fingerprint,
    manifest_sha256: audit.manifest_sha256,
    revocations_sha256: audit.revocations_sha256,
    control_generation: audit.control_generation,
    revocations_generation: audit.revocations_generation,
  }
  assert(audit.post_write_validation_receipt_sha256 === sha256(stableJson(receipt)), 'migration audit post-write receipt hash is invalid')
  const strictEvidenceSha256 = sha256(stableJson({
    migration_intent_sha256: audit.migration_intent_sha256,
    post_write_current_sha256: audit.post_write_current_sha256,
    post_write_validation_receipt_sha256: audit.post_write_validation_receipt_sha256,
    validator_preflight_response_sha256: audit.validator_preflight_response_sha256,
  }))
  assert(audit.strict_validator_verified === true, 'migration audit strict validator has not been verified')
  assert(audit.strict_validator_evidence_sha256 === strictEvidenceSha256, 'migration audit strict validator evidence is invalid')
  assert(audit.automatic_release_enabled === false, 'migration audit changed automatic release state')
  assert(audit.production_release_authorized === false, 'migration audit enabled ordinary production release authorization')
  assert(audit.legacy_control_migration_authorized === true, 'migration audit lacks one-time authorization evidence')
  assert(audit.commit_sha === intent.commit_sha, 'migration audit origin commit differs from its intent')
  assert(audit.github_run_id === intent.github_run_id, 'migration audit origin run differs from its intent')
  assert(audit.github_run_attempt === intent.github_run_attempt, 'migration audit origin run attempt differs from its intent')
  assert(COMMIT_SHA_PATTERN.test(audit.finalizer_commit_sha || ''), 'migration audit finalizer commit SHA is invalid')
  assert(GITHUB_RUN_ID_PATTERN.test(audit.finalizer_github_run_id || ''), 'migration audit finalizer GitHub run ID is invalid')
  assert(GITHUB_RUN_ATTEMPT_PATTERN.test(audit.finalizer_github_run_attempt || ''), 'migration audit finalizer GitHub run attempt is invalid')
  assert(audit.finalizer_commit_sha === intent.commit_sha, 'migration audit finalizer used a different commit')
  if (audit.recovered_after_pointer_switch === false) {
    assert(audit.finalizer_github_run_id === intent.github_run_id
      && audit.finalizer_github_run_attempt === intent.github_run_attempt,
    'normal migration audit was finalized by a different run or attempt')
  }
  if (expectedFinalizerCommitSha !== undefined) assert(audit.finalizer_commit_sha === expectedFinalizerCommitSha, 'migration audit finalizer commit differs from the protected run')
  if (expectedFinalizerGithubRunId !== undefined) assert(audit.finalizer_github_run_id === String(expectedFinalizerGithubRunId), 'migration audit finalizer run differs from the protected run')
  if (expectedFinalizerGithubRunAttempt !== undefined) assert(audit.finalizer_github_run_attempt === String(expectedFinalizerGithubRunAttempt), 'migration audit finalizer run attempt differs from the protected run')
  return audit.after_sha256
}

export function buildMigrationAudit({
  current,
  currentText,
  migrationIntentText: preparedIntentText,
  verifiedAfter,
  recoveredAfterPointerSwitch = false,
  commitSha,
  githubRunId,
  githubRunAttempt,
  finalizerCommitSha = commitSha,
  finalizerGithubRunId = githubRunId,
  finalizerGithubRunAttempt = githubRunAttempt,
  validatorPreflight,
  postWriteReceipt,
  automaticReleaseEnabled,
  productionReleaseAuthorized,
  legacyControlMigrationAuthorized,
  descriptor = migrationDescriptor('legacy-control-2026-06-e9788d0bddf3'),
} = {}) {
  const intent = parseMigrationIntentText(preparedIntentText, {
    expectedCommitSha: commitSha,
    expectedGithubRunId: githubRunId,
    expectedGithubRunAttempt: githubRunAttempt,
  })
  assert(intent.migration_id === descriptor.migration_id, 'migration audit intent targets a different descriptor')
  assert(verifiedAfter === true, 'migration audit cannot be built without post-switch full-release verification')
  assert(current && typeof current === 'object' && !Array.isArray(current), 'migration audit current pointer is unavailable')
  assert(currentText === stableJson(current), 'migration audit current pointer bytes differ from the validated pointer')
  assert(currentText === intent.after_current_text, 'migration audit current pointer differs from the prepared intent')
  assert(postWriteReceipt?.current_sha256 === sha256(currentText), 'migration audit cloud response pointer hash differs from the migrated pointer')
  assert(postWriteReceipt?.receipt?.current_fingerprint === pointerFingerprint(current), 'migration audit cloud response fingerprint differs from the migrated pointer')
  const strictValidatorEvidenceSha256 = sha256(stableJson({
    migration_intent_sha256: sha256(preparedIntentText),
    post_write_current_sha256: postWriteReceipt?.current_sha256,
    post_write_validation_receipt_sha256: postWriteReceipt?.receipt_sha256,
    validator_preflight_response_sha256: validatorPreflight?.response_sha256,
  }))
  const audit = {
    audit_schema_version: LEGACY_MIGRATION_AUDIT_SCHEMA_VERSION,
    status: 'legacy_control_migrated',
    migration_id: descriptor.migration_id,
    migrated_at: intent.migrated_at,
    migration_intent_text: preparedIntentText,
    migration_intent_sha256: sha256(preparedIntentText),
    cloud_env_id: descriptor.cloud_env_id,
    storage_bucket: descriptor.storage_bucket,
    dataset_version: descriptor.dataset_version,
    source_dataset_version: descriptor.source_dataset_version,
    before_sha256: intent.before_sha256,
    after_sha256: sha256(currentText || ''),
    manifest_sha256: descriptor.legacy_manifest_sha256,
    revocations_sha256: intent.revocations_sha256,
    control_generation: current?.control_generation,
    revocations_generation: current?.revocations_generation,
    city_count: 70,
    fixed_evidence_verified: intent.fixed_evidence_verified === true,
    legacy_current_raw_sha256_verified: sha256(intent.before_current_text) === descriptor.legacy_current_sha256,
    legacy_manifest_raw_sha256_verified: true,
    migration_pointer_validated: true,
    revocation_registry_round_trip_verified: true,
    production_pointer_round_trip_verified: true,
    full_release_verified_before: intent.full_release_verified_before === true,
    full_release_verified_after: verifiedAfter === true,
    recovered_after_pointer_switch: recoveredAfterPointerSwitch === true,
    describe_validator_observed: validatorPreflight?.describe_validator_observed === true,
    describe_validator_verified: validatorPreflight?.describe_validator_verified === true,
    validator_id: validatorPreflight?.validator_id,
    receipt_schema_version: validatorPreflight?.receipt_schema_version,
    max_receipt_validity_ms: validatorPreflight?.max_receipt_validity_ms,
    validator_preflight_response_sha256: validatorPreflight?.response_sha256,
    cloud_function_response_observed: postWriteReceipt?.cloud_function_response_observed === true,
    post_write_validation_receipt_verified: postWriteReceipt?.strict_validator_verified === true,
    post_write_validation_receipt_sha256: postWriteReceipt?.receipt_sha256,
    post_write_receipt_validated_at: postWriteReceipt?.receipt?.validated_at,
    post_write_receipt_valid_until: postWriteReceipt?.receipt?.valid_until,
    post_write_current: current,
    post_write_current_fingerprint: postWriteReceipt?.receipt?.current_fingerprint,
    post_write_current_sha256: postWriteReceipt?.current_sha256,
    strict_validator_verified: validatorPreflight?.describe_validator_verified === true
      && postWriteReceipt?.strict_validator_verified === true,
    strict_validator_evidence_sha256: strictValidatorEvidenceSha256,
    automatic_release_enabled: automaticReleaseEnabled === true,
    production_release_authorized: productionReleaseAuthorized === true,
    legacy_control_migration_authorized: legacyControlMigrationAuthorized === true,
    commit_sha: commitSha,
    github_run_id: String(githubRunId || ''),
    github_run_attempt: String(githubRunAttempt || ''),
    finalizer_commit_sha: finalizerCommitSha,
    finalizer_github_run_id: String(finalizerGithubRunId || ''),
    finalizer_github_run_attempt: String(finalizerGithubRunAttempt || ''),
  }
  validateMigrationAuditTransition(audit, {
    expectedBeforeSha256: descriptor.legacy_current_sha256,
    expectedAfterSha256: sha256(currentText || ''),
    datasetVersion: descriptor.dataset_version,
    sourceDatasetVersion: descriptor.source_dataset_version,
    manifestSha256: descriptor.legacy_manifest_sha256,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
    expectedCommitSha: commitSha,
    expectedOriginGithubRunId: githubRunId,
    expectedOriginGithubRunAttempt: githubRunAttempt,
    expectedFinalizerCommitSha: finalizerCommitSha,
    expectedFinalizerGithubRunId: finalizerGithubRunId,
    expectedFinalizerGithubRunAttempt: finalizerGithubRunAttempt,
  })
  return audit
}

export function migrationAuditFileName(audit) {
  validateMigrationAuditTransition(audit)
  return `legacy-control-migration-${audit.migrated_at.replace(/[:.]/g, '-')}.json`
}

function normalizeRepairTransition({ audit, fileName }, options) {
  assert(audit?.status === 'current_pointer_repaired', `repair audit status is invalid: ${fileName}`)
  assert(audit.cloud_env_id === options.cloudEnvId, `repair audit environment is invalid: ${fileName}`)
  assert(audit.dataset_version === options.datasetVersion, `repair audit dataset is invalid: ${fileName}`)
  assert(SHA256_PATTERN.test(audit.before_sha256 || '') && SHA256_PATTERN.test(audit.after_sha256 || ''), `repair audit hash is invalid: ${fileName}`)
  assert(audit.before_sha256 !== audit.after_sha256, `repair audit does not change the pointer: ${fileName}`)
  const transitionTime = canonicalIso(audit.repaired_at, `repair audit timestamp: ${fileName}`)
  const generation = audit.control_generation === undefined ? null : audit.control_generation
  assert(generation === null || (Number.isSafeInteger(generation) && generation > 0), `repair audit control generation is invalid: ${fileName}`)
  return { kind: 'repair', fileName, audit, generation, transitionTime }
}

function normalizeMigrationTransition({ audit, fileName }, options) {
  validateMigrationAuditTransition(audit, {
    datasetVersion: options.datasetVersion,
    sourceDatasetVersion: options.sourceDatasetVersion,
    manifestSha256: options.manifestSha256,
    cloudEnvId: options.cloudEnvId,
    storageBucket: options.storageBucket,
  })
  return {
    kind: 'migration',
    fileName,
    audit,
    generation: audit.control_generation,
    transitionTime: canonicalIso(audit.migrated_at, `migration audit timestamp: ${fileName}`),
  }
}

export function validateControlAuditTransitions({
  initialSha256,
  finalSha256,
  datasetVersion,
  sourceDatasetVersion,
  manifestSha256,
  cloudEnvId,
  storageBucket,
  repairs = [],
  migrations = [],
} = {}) {
  assert(SHA256_PATTERN.test(initialSha256 || ''), 'control audit chain initial hash is invalid')
  assert(Array.isArray(repairs) && Array.isArray(migrations), 'control audit transition inputs are invalid')
  const options = { datasetVersion, sourceDatasetVersion, manifestSha256, cloudEnvId, storageBucket }
  const transitions = [
    ...repairs.filter(({ audit }) => audit?.dataset_version === datasetVersion).map((entry) => normalizeRepairTransition(entry, options)),
    ...migrations.filter(({ audit }) => audit?.dataset_version === datasetVersion).map((entry) => normalizeMigrationTransition(entry, options)),
  ]
  const identities = transitions.map((entry) => `${entry.transitionTime}:${entry.fileName}`)
  assert(new Set(identities).size === identities.length, 'control audit transitions contain an ambiguous time and file identity')
  const baselines = transitions.map((entry) => entry.audit.before_sha256)
  assert(new Set(baselines).size === baselines.length, 'control audit transitions branch from the same pointer state')

  const transitionsByBefore = new Map(transitions.map((transition) => [transition.audit.before_sha256, transition]))
  const orderedTransitions = []
  let expectedSha256 = initialSha256
  const observedPointerHashes = new Set([expectedSha256])
  while (transitionsByBefore.has(expectedSha256)) {
    const transition = transitionsByBefore.get(expectedSha256)
    transitionsByBefore.delete(expectedSha256)
    assert(!observedPointerHashes.has(transition.audit.after_sha256), `control audit chain contains a cycle at ${transition.fileName}`)
    orderedTransitions.push(transition)
    expectedSha256 = transition.audit.after_sha256
    observedPointerHashes.add(expectedSha256)
  }
  assert(orderedTransitions.length === transitions.length, 'control audit transitions cannot be joined into one actual pointer chain')

  expectedSha256 = initialSha256
  let lastGeneration = 0
  let lastTransitionTime = Number.NEGATIVE_INFINITY
  let controlledTransitionObserved = false
  let pointerRepairCount = 0
  let pointerMigrationCount = 0
  for (const transition of orderedTransitions) {
    assert(transition.audit.before_sha256 === expectedSha256, `control audit chain is discontinuous at ${transition.fileName}`)
    assert(transition.transitionTime >= lastTransitionTime, `control audit timestamps go backwards at ${transition.fileName}`)
    lastTransitionTime = transition.transitionTime
    if (transition.generation === null) {
      assert(!controlledTransitionObserved, `control generation is missing after controlled transitions at ${transition.fileName}`)
    } else {
      assert(transition.generation > lastGeneration, `control generation does not strictly increase at ${transition.fileName}`)
      lastGeneration = transition.generation
      controlledTransitionObserved = true
    }
    if (transition.kind === 'migration') {
      validateMigrationAuditTransition(transition.audit, {
        expectedBeforeSha256: expectedSha256,
        datasetVersion,
        sourceDatasetVersion,
        manifestSha256,
        cloudEnvId,
        storageBucket,
      })
      pointerMigrationCount += 1
    } else {
      pointerRepairCount += 1
    }
    expectedSha256 = transition.audit.after_sha256
  }
  if (finalSha256 !== undefined) assert(expectedSha256 === finalSha256, 'control audit chain does not end at the production pointer')
  return { expectedCurrentSha256: expectedSha256, pointerRepairCount, pointerMigrationCount, transitions: orderedTransitions }
}

export function validateAlreadyMigratedPointer({ currentText, manifestText, registryText, migrationId } = {}) {
  const descriptor = migrationDescriptor(migrationId)
  assert(classifyMigrationState(currentText, migrationId) === 'already_migrated', 'current pointer is not the approved migrated state')
  const current = JSON.parse(currentText)
  const manifest = validateLegacyManifestText(manifestText, current, descriptor)
  assert(sha256(registryText || '') === current.revocations_sha256, 'migrated revocations raw SHA-256 changed')
  const registry = validateRevocationRegistry(JSON.parse(registryText))
  validateControlPointer(current, {
    allowLegacy: false,
    requireContext: true,
    manifest,
    registry,
    cloudEnvId: descriptor.cloud_env_id,
    storageBucket: descriptor.storage_bucket,
  })
  return { descriptor, current, manifest, registry }
}
