const CONTROL_SCHEMA_VERSION = '1.0.0'
const REGISTRY_SCHEMA_VERSION = '1.0.0'
const AUDITED_LEGACY_MIGRATIONS = require('./audited-legacy-migrations.js')
const DATASET_VERSION_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const MONTH_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const REVISION_ID_PATTERN = /^revision-[a-z0-9][a-z0-9-]{5,80}$/
const DEFAULT_CLOUD_ENV_ID = 'cloud1-d3gpdx70w5d05c68c'
const DEFAULT_STORAGE_BUCKET = '636c-cloud1-d3gpdx70w5d05c68c-1456861154'
const ALLOWED_DATA_ROOTS = new Set(['housing-data', 'housing-data/preview'])
const MAX_CONTROL_VALIDITY_MS = 24 * 60 * 60 * 1000
const VALIDATION_RECEIPT_SCHEMA_VERSION = '1.0.0'
const CONTROL_VALIDATOR_ID = 'housing-control-validator-v2'
const MAX_VALIDATION_RECEIPT_MS = 10 * 60 * 1000
const LEGACY_FIELDS = [
  'dataset_version',
  'source_dataset_version',
  'dataset_as_of',
  'schema_version',
  'manifest_file_id',
  'manifest_sha256',
  'published_at',
  'previous_dataset_version',
  'next_check_at',
]
const CONTROLLED_FIELDS = [
  ...LEGACY_FIELDS,
  'control_schema_version',
  'control_generation',
  'revocations_file_id',
  'revocations_sha256',
  'revocations_generation',
  'transition_type',
  'data_status',
  'status_reason',
  'control_generated_at',
  'control_valid_until',
]
const CONTROL_MARKER_FIELDS = CONTROLLED_FIELDS.filter((field) => !LEGACY_FIELDS.includes(field))
const DATASET_REVOCATION_FIELDS = ['dataset_version', 'reason', 'replacement_dataset_version', 'revision_id', 'revoked_at']
const SOURCE_REVOCATION_FIELDS = ['reason', 'replacement_source_dataset_version', 'revision_id', 'revoked_at', 'source_dataset_version']

function reject(message) {
  throw new Error(`Housing data control pointer rejected: ${message}`)
}

function assert(condition, message) {
  if (!condition) reject(message)
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactFields(value, expected, label) {
  assert(isPlainObject(value), `${label} is not an object`)
  const actual = Object.keys(value).sort()
  const fields = [...expected].sort()
  assert(actual.length === fields.length && actual.every((field, index) => field === fields[index]), `${label} fields are invalid`)
}

function canonicalIso(value, label) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${label} is invalid`)
  assert(new Date(value).toISOString() === value, `${label} is not canonical ISO 8601`)
  return Date.parse(value)
}

function assertDatasetVersion(value, label) {
  assert(DATASET_VERSION_PATTERN.test(value || ''), `${label} is invalid`)
}

function assertRevisionId(value, label, nullable = false) {
  if (nullable && value === null) return
  assert(REVISION_ID_PATTERN.test(value || ''), `${label} is invalid`)
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function classifyCurrent(value) {
  assert(isPlainObject(value), 'current pointer is invalid')
  const present = CONTROL_MARKER_FIELDS.filter((field) => value[field] !== undefined)
  if (!present.length && value.rollback_from_dataset_version === undefined) return 'legacy'
  assert(CONTROL_MARKER_FIELDS.every((field) => value[field] !== undefined), 'control fields are incomplete')
  assert(value.control_schema_version === CONTROL_SCHEMA_VERSION, 'control schema is unsupported')
  if (value.rollback_from_dataset_version !== undefined) {
    assert(value.transition_type === 'rollback', 'rollback source is present on a non-rollback pointer')
  }
  if (value.migration_id !== undefined
    || value.migrated_from_current_sha256 !== undefined
    || value.migrated_from_manifest_sha256 !== undefined) {
    assert(value.transition_type === 'migration', 'migration identity is present on a non-migration pointer')
  }
  if (value.superseded_dataset_version !== undefined || value.superseded_source_dataset_version !== undefined) {
    assert(['historical_correction', 'migration'].includes(value.transition_type), 'superseded identity is present on an invalid pointer')
  }
  return 'controlled'
}

function migrationDescriptor(value, cloudEnvId, storageBucket) {
  const descriptor = AUDITED_LEGACY_MIGRATIONS[value.migration_id]
  assert(descriptor, 'migration ID is not approved')
  assert(descriptor.cloud_env_id === cloudEnvId && descriptor.storage_bucket === storageBucket, 'migration authority is invalid')
  assert(value.dataset_version === descriptor.dataset_version, 'migration dataset version is invalid')
  assert(value.source_dataset_version === descriptor.source_dataset_version, 'migration source dataset version is invalid')
  assert(value.dataset_as_of === descriptor.dataset_as_of, 'migration month is invalid')
  assert(value.schema_version === descriptor.schema_version, 'migration data schema is invalid')
  assert(value.manifest_sha256 === descriptor.legacy_manifest_sha256, 'migration manifest hash is invalid')
  assert(value.migrated_from_current_sha256 === descriptor.legacy_current_sha256, 'migration source pointer hash is invalid')
  assert(value.migrated_from_manifest_sha256 === descriptor.legacy_manifest_sha256, 'migration source manifest hash is invalid')
  assert(value.published_at === descriptor.published_at, 'migration changed the data publication time')
  assert(value.previous_dataset_version === descriptor.previous_dataset_version, 'migration exposed an unsafe previous dataset')
  assert(value.next_check_at === descriptor.next_check_at, 'migration changed the next check time')
  assert(value.superseded_dataset_version === descriptor.superseded_dataset_version, 'migration superseded dataset is invalid')
  assert(value.superseded_source_dataset_version === descriptor.superseded_source_dataset_version, 'migration superseded source is invalid')
  assert(value.control_generation === 1 && value.revocations_generation === 1, 'migration must establish generation one')
  assert(value.data_status === 'current' && value.status_reason === 'audited_legacy_control_migration', 'migration status is invalid')
  return descriptor
}

function assertAuditedMigrationRegistry(registry, descriptor) {
  assert(registry.generation === 1, 'migration revocations generation is invalid')
  assert(registry.generated_at === descriptor.registry_generated_at, 'migration revocations timestamp is invalid')
  const actualDatasets = [...registry.revoked_dataset_versions].sort((left, right) => left.dataset_version.localeCompare(right.dataset_version, 'en'))
  const expectedDatasets = [...descriptor.revoked_dataset_versions].sort((left, right) => left.dataset_version.localeCompare(right.dataset_version, 'en'))
  const actualSources = [...registry.revoked_source_dataset_versions].sort((left, right) => left.source_dataset_version.localeCompare(right.source_dataset_version, 'en'))
  const expectedSources = [...descriptor.revoked_source_dataset_versions].sort((left, right) => left.source_dataset_version.localeCompare(right.source_dataset_version, 'en'))
  assert(stableJson(actualDatasets) === stableJson(expectedDatasets), 'migration dataset revocations are incomplete')
  assert(stableJson(actualSources) === stableJson(expectedSources), 'migration source revocations are incomplete')
}

function validateRegistry(registry) {
  exactFields(registry, ['generated_at', 'generation', 'registry_schema_version', 'revoked_dataset_versions', 'revoked_source_dataset_versions'], 'revocations registry')
  assert(registry.registry_schema_version === REGISTRY_SCHEMA_VERSION, 'revocations schema is unsupported')
  assert(Number.isSafeInteger(registry.generation) && registry.generation > 0, 'revocations generation is invalid')
  canonicalIso(registry.generated_at, 'revocations timestamp')
  assert(Array.isArray(registry.revoked_dataset_versions) && Array.isArray(registry.revoked_source_dataset_versions), 'revocations lists are invalid')

  const validateEntries = (entries, fields, versionField, replacementField, label, revisionNullable) => {
    const versions = []
    for (let index = 0; index < entries.length; index += 1) {
      assert(Object.prototype.hasOwnProperty.call(entries, index), `${label} revocations contain a sparse entry`)
      const entry = entries[index]
      exactFields(entry, fields, `${label} revocation`)
      assertDatasetVersion(entry[versionField], `${label} version`)
      canonicalIso(entry.revoked_at, `${label} revoked_at`)
      assertRevisionId(entry.revision_id, `${label} revision_id`, revisionNullable)
      assert(typeof entry.reason === 'string' && entry.reason.trim() === entry.reason && entry.reason.length > 0 && entry.reason.length <= 500, `${label} reason is invalid`)
      if (entry[replacementField] !== null) {
        assertDatasetVersion(entry[replacementField], `${label} replacement`)
        assert(entry[replacementField] !== entry[versionField], `${label} replaces itself`)
      }
      versions.push(entry[versionField])
    }
    assert(new Set(versions).size === versions.length, `${label} revocations contain duplicates`)
    const sorted = [...versions].sort((left, right) => left.localeCompare(right, 'en'))
    assert(versions.every((value, index) => value === sorted[index]), `${label} revocations are not sorted`)
  }

  validateEntries(registry.revoked_dataset_versions, DATASET_REVOCATION_FIELDS, 'dataset_version', 'replacement_dataset_version', 'dataset', true)
  validateEntries(registry.revoked_source_dataset_versions, SOURCE_REVOCATION_FIELDS, 'source_dataset_version', 'replacement_source_dataset_version', 'source', false)
  return registry
}

function assertRegistryProgression(previousRegistry, registry) {
  if (!previousRegistry) return
  validateRegistry(previousRegistry)
  assert(registry.generation >= previousRegistry.generation, 'revocations generation moved backwards')
  if (registry.generation === previousRegistry.generation) {
    assert(stableJson(registry) === stableJson(previousRegistry), 'revocations changed without increasing their generation')
    return
  }
  const assertPreserved = (previousEntries, entries, field, label) => {
    const incoming = new Map(entries.map((entry) => [entry[field], stableJson(entry)]))
    for (const entry of previousEntries) {
      assert(incoming.get(entry[field]) === stableJson(entry), `${label} revocation history was removed or rewritten`)
    }
  }
  assertPreserved(previousRegistry.revoked_dataset_versions, registry.revoked_dataset_versions, 'dataset_version', 'dataset')
  assertPreserved(previousRegistry.revoked_source_dataset_versions, registry.revoked_source_dataset_versions, 'source_dataset_version', 'source')
}

function validateCurrent(value, options = {}) {
  const cloudEnvId = options.cloudEnvId || options.config?.cloudEnvId || DEFAULT_CLOUD_ENV_ID
  const storageBucket = options.storageBucket || options.config?.storageBucket || DEFAULT_STORAGE_BUCKET
  const dataRoot = options.dataRoot || options.config?.remoteDataRoot || 'housing-data'
  assert(ALLOWED_DATA_ROOTS.has(dataRoot), 'data root is invalid')
  const releaseRoot = `cloud://${cloudEnvId}.${storageBucket}/${dataRoot}/releases/`
  const controlRoot = `cloud://${cloudEnvId}.${storageBucket}/${dataRoot}/control/`
  const kind = classifyCurrent(value)

  assertDatasetVersion(value.dataset_version, 'dataset version')
  assertDatasetVersion(value.source_dataset_version, 'source dataset version')
  assert(MONTH_PATTERN.test(value.dataset_as_of || '') && value.dataset_version.startsWith(`${value.dataset_as_of}-`), 'dataset month is invalid')
  assert(/^1\./.test(value.schema_version || ''), 'data schema is unsupported')
  assert(value.manifest_file_id === `${releaseRoot}${value.dataset_version}/manifest.json`, 'manifest file ID is invalid')
  assert(SHA256_PATTERN.test(value.manifest_sha256 || ''), 'manifest hash is invalid')
  canonicalIso(value.next_check_at, 'next check time')
  if (value.published_at !== null) canonicalIso(value.published_at, 'published_at')
  if (value.previous_dataset_version !== null) {
    assertDatasetVersion(value.previous_dataset_version, 'previous dataset version')
    assert(value.previous_dataset_version !== value.dataset_version, 'previous dataset version equals the target')
  }

  if (kind === 'legacy') {
    exactFields(value, LEGACY_FIELDS, 'legacy current pointer')
    assert(options.allowLegacy !== false, 'legacy current pointer is not allowed')
    return value
  }

  const transitionFields = value.transition_type === 'rollback'
    ? ['rollback_from_dataset_version']
    : value.transition_type === 'historical_correction'
      ? ['superseded_dataset_version', 'superseded_source_dataset_version']
      : value.transition_type === 'migration'
        ? ['migration_id', 'migrated_from_current_sha256', 'migrated_from_manifest_sha256', 'superseded_dataset_version', 'superseded_source_dataset_version']
        : []
  exactFields(value, [...CONTROLLED_FIELDS, ...transitionFields], 'controlled current pointer')
  assert(value.control_schema_version === CONTROL_SCHEMA_VERSION, 'control schema is unsupported')
  assert(Number.isSafeInteger(value.control_generation) && value.control_generation > 0, 'control generation is invalid')
  assert(Number.isSafeInteger(value.revocations_generation) && value.revocations_generation > 0, 'revocations generation is invalid')
  assert(SHA256_PATTERN.test(value.revocations_sha256 || ''), 'revocations hash is invalid')
  assert(value.revocations_file_id === `${controlRoot}revocations-${value.revocations_sha256}.json`, 'revocations file ID is invalid')
  assert(['publish', 'historical_correction', 'rollback', 'migration'].includes(value.transition_type), 'transition type is invalid')
  assert(['current', 'updating', 'stale'].includes(value.data_status), 'data status is invalid')
  assert(typeof value.status_reason === 'string' && value.status_reason.trim() === value.status_reason && value.status_reason.length > 0 && value.status_reason.length <= 500, 'status reason is invalid')
  const generatedAt = canonicalIso(value.control_generated_at, 'control_generated_at')
  const validUntil = canonicalIso(value.control_valid_until, 'control_valid_until')
  assert(validUntil > generatedAt && validUntil - generatedAt <= MAX_CONTROL_VALIDITY_MS, 'control validity window is invalid')
  assert(value.published_at !== null, 'published_at is required for a controlled pointer')

  let approvedMigration = null

  if (value.transition_type === 'rollback') {
    assertDatasetVersion(value.rollback_from_dataset_version, 'rollback source')
    assert(value.rollback_from_dataset_version !== value.dataset_version, 'rollback source equals the target')
    assert(value.previous_dataset_version === null, 'rollback pointer exposes an unsafe previous version')
  } else if (value.transition_type === 'historical_correction') {
    assertDatasetVersion(value.superseded_dataset_version, 'superseded dataset version')
    assertDatasetVersion(value.superseded_source_dataset_version, 'superseded source dataset version')
    assert(value.superseded_dataset_version !== value.dataset_version, 'historical correction supersedes its target dataset')
    assert(value.superseded_source_dataset_version !== value.source_dataset_version, 'historical correction supersedes its target source')
  } else if (value.transition_type === 'migration') {
    assert(SHA256_PATTERN.test(value.migrated_from_current_sha256 || ''), 'migration source pointer hash is invalid')
    assert(SHA256_PATTERN.test(value.migrated_from_manifest_sha256 || ''), 'migration source manifest hash is invalid')
    approvedMigration = migrationDescriptor(value, cloudEnvId, storageBucket)
    assert(generatedAt >= Date.parse(value.published_at), 'migration control predates the data publication')
  }

  const manifest = options.manifest
  if (manifest) {
    assert(manifest.dataset_version === value.dataset_version, 'manifest dataset version differs from the pointer')
    assert(manifest.source_dataset_version === value.source_dataset_version, 'manifest source dataset version differs from the pointer')
    assert(manifest.dataset_as_of === value.dataset_as_of, 'manifest month differs from the pointer')
    if (value.transition_type === 'publish') assert(manifest.release_type === 'monthly_update', 'publish transition does not reference a monthly manifest')
    if (value.transition_type === 'historical_correction') {
      assert(manifest.release_type === 'historical_correction', 'historical correction transition does not reference a correction manifest')
      assert(manifest.supersedes_source_dataset_version === value.superseded_source_dataset_version, 'historical correction source chain differs from the pointer')
    }
    if (value.transition_type === 'migration') {
      assert(manifest.release_type === undefined, 'migration must preserve the immutable legacy manifest type')
    }
  } else if (options.requireContext) {
    reject('manifest context is required')
  }

  const registry = options.registry
  if (registry) {
    validateRegistry(registry)
    assert(registry.generation === value.revocations_generation, 'revocations generation differs from the pointer')
    assertRegistryProgression(options.previousRegistry, registry)
    const datasetEntries = new Map(registry.revoked_dataset_versions.map((entry) => [entry.dataset_version, entry]))
    const sourceEntries = new Map(registry.revoked_source_dataset_versions.map((entry) => [entry.source_dataset_version, entry]))
    assert(!datasetEntries.has(value.dataset_version), 'target dataset version is revoked')
    assert(!sourceEntries.has(value.source_dataset_version), 'target source dataset version is revoked')
    if (value.transition_type === 'rollback') {
      const revoked = datasetEntries.get(value.rollback_from_dataset_version)
      assert(revoked?.replacement_dataset_version === value.dataset_version, 'rollback revocation does not identify the exact target')
      const sourceMatches = registry.revoked_source_dataset_versions.filter((entry) => (
        entry.revision_id === revoked.revision_id
        && entry.revoked_at === revoked.revoked_at
        && entry.replacement_source_dataset_version === value.source_dataset_version
      ))
      assert(revoked?.revision_id && sourceMatches.length === 1, 'rollback source revocation is incomplete or ambiguous')
    }
    if (value.transition_type === 'historical_correction') {
      const revisionId = manifest?.revision_id
      assertRevisionId(revisionId, 'historical correction revision ID')
      const datasetRevocation = datasetEntries.get(value.superseded_dataset_version)
      const sourceRevocation = sourceEntries.get(value.superseded_source_dataset_version)
      assert(datasetRevocation?.replacement_dataset_version === value.dataset_version, 'historical correction dataset revocation is incomplete')
      assert(sourceRevocation?.replacement_source_dataset_version === value.source_dataset_version, 'historical correction source revocation is incomplete')
      assert(datasetRevocation?.revision_id === revisionId && sourceRevocation?.revision_id === revisionId, 'historical correction revocations use a different revision ID')
    }
    if (value.transition_type === 'migration') assertAuditedMigrationRegistry(registry, approvedMigration)
  } else if (options.requireContext) {
    reject('revocations context is required')
  }

  if (options.previousPointer) {
    const previous = options.previousPointer
    const previousKind = classifyCurrent(previous)
    assert(previousKind === 'controlled', 'previous pointer is not controlled')
    assert(value.control_generation >= previous.control_generation, 'control generation moved backwards')
    if (value.control_generation === previous.control_generation) {
      assert(stableJson(value) === stableJson(previous), 'control pointer changed without increasing its generation')
    }
    assert(value.revocations_generation >= previous.revocations_generation, 'revocations generation moved backwards')
    if (value.revocations_generation === previous.revocations_generation) {
      assert(value.revocations_sha256 === previous.revocations_sha256
        && value.revocations_file_id === previous.revocations_file_id, 'revocations changed without increasing their generation')
    }
  }
  return value
}

module.exports = {
  AUDITED_LEGACY_MIGRATIONS,
  CONTROL_VALIDATOR_ID,
  CONTROL_SCHEMA_VERSION,
  MAX_CONTROL_VALIDITY_MS,
  MAX_VALIDATION_RECEIPT_MS,
  VALIDATION_RECEIPT_SCHEMA_VERSION,
  classifyCurrent,
  stableJson,
  validateCurrent,
  validateRegistry,
}
