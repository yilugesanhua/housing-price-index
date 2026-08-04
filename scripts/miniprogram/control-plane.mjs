import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  AUDITED_LEGACY_MIGRATIONS,
  MAX_CONTROL_VALIDITY_MS,
  classifyCurrent: classifyAuthoritativeControlPointer,
  validateCurrent: validateAuthoritativeControlPointer,
} = require('../../apps/miniprogram/cloudfunctions/getHousingDataManifest/validate-current.js')

export { AUDITED_LEGACY_MIGRATIONS }

export const REVOCATION_REGISTRY_SCHEMA_VERSION = '1.0.0'
export const REVOCATION_REGISTRY_KEY_PREFIX = 'housing-data/control/revocations-'

const VERSION_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const REVISION_ID_PATTERN = /^revision-[a-z0-9][a-z0-9-]{5,80}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const REGISTRY_FIELDS = [
  'generated_at',
  'generation',
  'registry_schema_version',
  'revoked_dataset_versions',
  'revoked_source_dataset_versions',
]
const DATASET_REVOCATION_FIELDS = [
  'dataset_version',
  'reason',
  'replacement_dataset_version',
  'revision_id',
  'revoked_at',
]
const SOURCE_REVOCATION_FIELDS = [
  'reason',
  'replacement_source_dataset_version',
  'revision_id',
  'revoked_at',
  'source_dataset_version',
]
const ARTIFACT_FIELDS = ['cloudFileId', 'cosKey', 'currentFields', 'registry', 'sha256', 'text']
const CURRENT_FIELDS = ['revocations_file_id', 'revocations_generation', 'revocations_sha256']
function assert(condition, message) {
  if (!condition) throw new Error(`Control plane rejected: ${message}`)
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertExactFields(value, fields, label) {
  assert(isPlainObject(value), `${label} must be an object`)
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  assert(actual.length === expected.length && actual.every((field, index) => field === expected[index]), `${label} fields are invalid`)
}

function assertIsoTimestamp(value, label) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${label} must be an ISO timestamp`)
  assert(new Date(value).toISOString() === value, `${label} must use canonical ISO format`)
}

function assertVersion(value, label) {
  assert(VERSION_PATTERN.test(value || ''), `${label} is invalid`)
}

function assertRevisionId(value, label, nullable = false) {
  if (nullable && value === null) return
  assert(REVISION_ID_PATTERN.test(value || ''), `${label} is invalid`)
}

function assertReason(value, label) {
  assert(typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 500, `${label} is invalid`)
}

function canonicalize(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    assert(Number.isFinite(value), `${path} contains a non-finite number`)
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`))
  assert(isPlainObject(value), `${path} contains a non-JSON value`)
  return Object.fromEntries(Object.keys(value).sort().map((key) => {
    const item = value[key]
    assert(item !== undefined && !['bigint', 'function', 'symbol'].includes(typeof item), `${path}.${key} contains a non-JSON value`)
    return [key, canonicalize(item, `${path}.${key}`)]
  }))
}

function clone(value) {
  return canonicalize(value)
}

function compareBy(field) {
  return (left, right) => left[field].localeCompare(right[field], 'en')
}

function validateDatasetRevocation(entry, index) {
  const label = `revoked_dataset_versions[${index}]`
  assertExactFields(entry, DATASET_REVOCATION_FIELDS, label)
  assertVersion(entry.dataset_version, `${label}.dataset_version`)
  assertIsoTimestamp(entry.revoked_at, `${label}.revoked_at`)
  assertRevisionId(entry.revision_id, `${label}.revision_id`, true)
  if (entry.replacement_dataset_version !== null) {
    assertVersion(entry.replacement_dataset_version, `${label}.replacement_dataset_version`)
    assert(entry.replacement_dataset_version !== entry.dataset_version, `${label} cannot replace a dataset with itself`)
  }
  assertReason(entry.reason, `${label}.reason`)
}

function validateSourceRevocation(entry, index) {
  const label = `revoked_source_dataset_versions[${index}]`
  assertExactFields(entry, SOURCE_REVOCATION_FIELDS, label)
  assertVersion(entry.source_dataset_version, `${label}.source_dataset_version`)
  assertIsoTimestamp(entry.revoked_at, `${label}.revoked_at`)
  assertRevisionId(entry.revision_id, `${label}.revision_id`)
  if (entry.replacement_source_dataset_version !== null) {
    assertVersion(entry.replacement_source_dataset_version, `${label}.replacement_source_dataset_version`)
    assert(entry.replacement_source_dataset_version !== entry.source_dataset_version, `${label} cannot replace a source dataset with itself`)
  }
  assertReason(entry.reason, `${label}.reason`)
}

function assertUniqueAndSorted(entries, field, label) {
  const values = entries.map((entry) => entry[field])
  assert(new Set(values).size === values.length, `${label} contains duplicate versions`)
  const sorted = [...values].sort((left, right) => left.localeCompare(right, 'en'))
  assert(values.every((value, index) => value === sorted[index]), `${label} must be sorted by version`)
}

function assertDenseArray(entries, label) {
  assert(Array.isArray(entries), `${label} must be an array`)
  for (let index = 0; index < entries.length; index += 1) {
    assert(Object.prototype.hasOwnProperty.call(entries, index), `${label} must not contain sparse entries`)
  }
}

function entriesByVersion(entries, field) {
  return new Map(entries.map((entry) => [entry[field], stableJson(entry)]))
}

function assertPriorEntriesPreserved(previousEntries, nextEntries, field, label) {
  const nextByVersion = entriesByVersion(nextEntries, field)
  for (const previous of previousEntries) {
    const version = previous[field]
    assert(nextByVersion.has(version), `${label} dropped ${version}`)
    assert(nextByVersion.get(version) === stableJson(previous), `${label} changed immutable entry ${version}`)
  }
}

function normalizeDatasetRevocation(entry) {
  const normalized = {
    dataset_version: entry.dataset_version,
    revoked_at: entry.revoked_at,
    revision_id: entry.revision_id ?? null,
    replacement_dataset_version: entry.replacement_dataset_version ?? null,
    reason: entry.reason,
  }
  validateDatasetRevocation(normalized, 0)
  return normalized
}

function normalizeSourceRevocation(entry) {
  const normalized = {
    source_dataset_version: entry.source_dataset_version,
    revoked_at: entry.revoked_at,
    revision_id: entry.revision_id,
    replacement_source_dataset_version: entry.replacement_source_dataset_version ?? null,
    reason: entry.reason,
  }
  validateSourceRevocation(normalized, 0)
  return normalized
}

export function stableJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function validateRevocationRegistry(registry) {
  assertExactFields(registry, REGISTRY_FIELDS, 'revocation registry')
  assert(registry.registry_schema_version === REVOCATION_REGISTRY_SCHEMA_VERSION, 'revocation registry schema version is unsupported')
  assert(Number.isSafeInteger(registry.generation) && registry.generation >= 1, 'revocation registry generation must be a positive safe integer')
  assertIsoTimestamp(registry.generated_at, 'revocation registry generated_at')
  assertDenseArray(registry.revoked_dataset_versions, 'revoked_dataset_versions')
  assertDenseArray(registry.revoked_source_dataset_versions, 'revoked_source_dataset_versions')
  registry.revoked_dataset_versions.forEach(validateDatasetRevocation)
  registry.revoked_source_dataset_versions.forEach(validateSourceRevocation)
  assertUniqueAndSorted(registry.revoked_dataset_versions, 'dataset_version', 'revoked_dataset_versions')
  assertUniqueAndSorted(registry.revoked_source_dataset_versions, 'source_dataset_version', 'revoked_source_dataset_versions')
  return registry
}

export function classifyControlPointer(pointer) {
  try {
    return classifyAuthoritativeControlPointer(pointer)
  } catch (error) {
    throw new Error(`Control plane rejected: ${String(error?.message || error).replace(/^Housing data control pointer rejected:\s*/, '')}`)
  }
}

export function validateControlPointer(pointer, options = {}) {
  try {
    return validateAuthoritativeControlPointer(pointer, options)
  } catch (error) {
    throw new Error(`Control plane rejected: ${String(error?.message || error).replace(/^Housing data control pointer rejected:\s*/, '')}`)
  }
}

export function buildControlValidUntil(generatedAt, validityMs = MAX_CONTROL_VALIDITY_MS) {
  assertIsoTimestamp(generatedAt, 'control generated_at')
  assert(Number.isSafeInteger(validityMs) && validityMs > 0 && validityMs <= MAX_CONTROL_VALIDITY_MS, 'control validity duration is invalid')
  return new Date(Date.parse(generatedAt) + validityMs).toISOString()
}

export function buildRollbackRevisionId(datasetVersion) {
  assertVersion(datasetVersion, 'rollback dataset version')
  const revisionId = `revision-rollback-${datasetVersion}`
  assertRevisionId(revisionId, 'rollback revision ID')
  return revisionId
}

export function createRevocationRegistry({
  generatedAt,
  revokedDatasetVersions = [],
  revokedSourceDatasetVersions = [],
} = {}) {
  const registry = {
    registry_schema_version: REVOCATION_REGISTRY_SCHEMA_VERSION,
    generation: 1,
    generated_at: generatedAt,
    revoked_dataset_versions: revokedDatasetVersions.map(normalizeDatasetRevocation).sort(compareBy('dataset_version')),
    revoked_source_dataset_versions: revokedSourceDatasetVersions.map(normalizeSourceRevocation).sort(compareBy('source_dataset_version')),
  }
  validateRevocationRegistry(registry)
  return registry
}

export function validateRevocationRegistryProgression(previousRegistry, nextRegistry) {
  validateRevocationRegistry(previousRegistry)
  validateRevocationRegistry(nextRegistry)
  assert(nextRegistry.generation === previousRegistry.generation + 1, 'revocation registry generation must increase by exactly one')
  assertPriorEntriesPreserved(previousRegistry.revoked_dataset_versions, nextRegistry.revoked_dataset_versions, 'dataset_version', 'revoked_dataset_versions')
  assertPriorEntriesPreserved(previousRegistry.revoked_source_dataset_versions, nextRegistry.revoked_source_dataset_versions, 'source_dataset_version', 'revoked_source_dataset_versions')
  const priorCount = previousRegistry.revoked_dataset_versions.length + previousRegistry.revoked_source_dataset_versions.length
  const nextCount = nextRegistry.revoked_dataset_versions.length + nextRegistry.revoked_source_dataset_versions.length
  assert(nextCount > priorCount, 'revocation registry generation must add at least one revocation')
  return nextRegistry
}

export function appendRevocations(previousRegistry, {
  generatedAt,
  datasetRevocations = [],
  sourceDatasetRevocations = [],
} = {}) {
  validateRevocationRegistry(previousRegistry)
  assert(Array.isArray(datasetRevocations), 'datasetRevocations must be an array')
  assert(Array.isArray(sourceDatasetRevocations), 'sourceDatasetRevocations must be an array')
  const additions = datasetRevocations.map(normalizeDatasetRevocation)
  const sourceAdditions = sourceDatasetRevocations.map(normalizeSourceRevocation)
  const priorDatasetVersions = new Set(previousRegistry.revoked_dataset_versions.map((entry) => entry.dataset_version))
  const priorSourceVersions = new Set(previousRegistry.revoked_source_dataset_versions.map((entry) => entry.source_dataset_version))
  assert(additions.every((entry) => !priorDatasetVersions.has(entry.dataset_version)), 'dataset revocation is already registered')
  assert(sourceAdditions.every((entry) => !priorSourceVersions.has(entry.source_dataset_version)), 'source dataset revocation is already registered')

  const registry = {
    registry_schema_version: REVOCATION_REGISTRY_SCHEMA_VERSION,
    generation: previousRegistry.generation + 1,
    generated_at: generatedAt,
    revoked_dataset_versions: [
      ...previousRegistry.revoked_dataset_versions.map(clone),
      ...additions,
    ].sort(compareBy('dataset_version')),
    revoked_source_dataset_versions: [
      ...previousRegistry.revoked_source_dataset_versions.map(clone),
      ...sourceAdditions,
    ].sort(compareBy('source_dataset_version')),
  }
  validateRevocationRegistryProgression(previousRegistry, registry)
  return registry
}

export function appendFailedDatasetRevocation(previousRegistry, {
  datasetVersion,
  revokedAt,
  replacementDatasetVersion = null,
  revisionId = null,
  reason,
  generatedAt = revokedAt,
} = {}) {
  return appendRevocations(previousRegistry, {
    generatedAt,
    datasetRevocations: [{
      dataset_version: datasetVersion,
      revoked_at: revokedAt,
      revision_id: revisionId,
      replacement_dataset_version: replacementDatasetVersion,
      reason,
    }],
  })
}

export function appendFailedReleaseRevocations(previousRegistry, {
  datasetVersion,
  sourceDatasetVersion,
  revokedAt,
  replacementDatasetVersion = null,
  replacementSourceDatasetVersion = null,
  revisionId,
  reason,
  generatedAt = revokedAt,
} = {}) {
  assertRevisionId(revisionId, 'revisionId')
  return appendRevocations(previousRegistry, {
    generatedAt,
    datasetRevocations: [{
      dataset_version: datasetVersion,
      revoked_at: revokedAt,
      revision_id: revisionId,
      replacement_dataset_version: replacementDatasetVersion,
      reason,
    }],
    sourceDatasetRevocations: [{
      source_dataset_version: sourceDatasetVersion,
      revoked_at: revokedAt,
      revision_id: revisionId,
      replacement_source_dataset_version: replacementSourceDatasetVersion,
      reason,
    }],
  })
}

export function appendHistoricalSourceRevocation(previousRegistry, {
  sourceDatasetVersion,
  revokedAt,
  revisionId,
  replacementSourceDatasetVersion = null,
  reason,
  generatedAt = revokedAt,
} = {}) {
  return appendRevocations(previousRegistry, {
    generatedAt,
    sourceDatasetRevocations: [{
      source_dataset_version: sourceDatasetVersion,
      revoked_at: revokedAt,
      revision_id: revisionId,
      replacement_source_dataset_version: replacementSourceDatasetVersion,
      reason,
    }],
  })
}

export function appendHistoricalCorrectionRevocations(previousRegistry, {
  datasetVersion,
  sourceDatasetVersion,
  revokedAt,
  revisionId,
  replacementDatasetVersion,
  replacementSourceDatasetVersion,
  reason,
  generatedAt = revokedAt,
} = {}) {
  return appendRevocations(previousRegistry, {
    generatedAt,
    datasetRevocations: [{
      dataset_version: datasetVersion,
      revoked_at: revokedAt,
      revision_id: revisionId,
      replacement_dataset_version: replacementDatasetVersion,
      reason,
    }],
    sourceDatasetRevocations: [{
      source_dataset_version: sourceDatasetVersion,
      revoked_at: revokedAt,
      revision_id: revisionId,
      replacement_source_dataset_version: replacementSourceDatasetVersion,
      reason,
    }],
  })
}

export function assertTargetNotRevoked(registry, { datasetVersion, sourceDatasetVersion } = {}) {
  validateRevocationRegistry(registry)
  assertVersion(datasetVersion, 'target dataset version')
  assertVersion(sourceDatasetVersion, 'target source dataset version')
  assert(!registry.revoked_dataset_versions.some((entry) => entry.dataset_version === datasetVersion), `target dataset version is revoked: ${datasetVersion}`)
  assert(!registry.revoked_source_dataset_versions.some((entry) => entry.source_dataset_version === sourceDatasetVersion), `target source dataset version is revoked: ${sourceDatasetVersion}`)
  return true
}

export function assertRollbackClosure(registry, {
  failedDatasetVersion,
  failedSourceDatasetVersion,
  targetDatasetVersion,
  targetSourceDatasetVersion,
  revisionId,
} = {}) {
  validateRevocationRegistry(registry)
  assertVersion(failedDatasetVersion, 'failed dataset version')
  assertVersion(failedSourceDatasetVersion, 'failed source dataset version')
  assertVersion(targetDatasetVersion, 'rollback target dataset version')
  assertVersion(targetSourceDatasetVersion, 'rollback target source dataset version')
  assertRevisionId(revisionId, 'rollback revision ID')
  const datasetEntry = registry.revoked_dataset_versions.find((entry) => entry.dataset_version === failedDatasetVersion)
  const sourceEntries = registry.revoked_source_dataset_versions.filter((entry) => entry.source_dataset_version === failedSourceDatasetVersion)
  assert(datasetEntry?.replacement_dataset_version === targetDatasetVersion, 'rollback dataset replacement is incomplete')
  assert(datasetEntry.revision_id === revisionId, 'rollback dataset revision is invalid')
  const sourceEntry = sourceEntries.find((entry) => (
    entry.replacement_source_dataset_version === targetSourceDatasetVersion
    && entry.revision_id === revisionId
    && entry.revoked_at === datasetEntry.revoked_at
  ))
  assert(sourceEntries.length === 1 && sourceEntry, 'rollback source replacement is incomplete or ambiguous')
  assertTargetNotRevoked(registry, { datasetVersion: targetDatasetVersion, sourceDatasetVersion: targetSourceDatasetVersion })
  return { datasetEntry, sourceEntry }
}

export function buildRevocationRegistryArtifact(registry, { cloudEnvId, storageBucket, dataRoot = 'housing-data' } = {}) {
  validateRevocationRegistry(registry)
  assert(/^cloud[\w-]+$/.test(cloudEnvId || ''), 'cloud environment ID is invalid')
  assert(/^[a-z0-9](?:[a-z0-9.-]{0,61}[a-z0-9])?$/.test(storageBucket || ''), 'cloud storage bucket is invalid')
  assert(['housing-data', 'housing-data/preview'].includes(dataRoot), 'revocation registry data root is invalid')
  const text = stableJson(registry)
  const digest = sha256(text)
  assert(SHA256_PATTERN.test(digest), 'revocation registry SHA-256 is invalid')
  const cosKey = `${dataRoot}/control/revocations-${digest}.json`
  const cloudFileId = `cloud://${cloudEnvId}.${storageBucket}/${cosKey}`
  const artifact = {
    registry: clone(registry),
    text,
    sha256: digest,
    cosKey,
    cloudFileId,
    currentFields: {
      revocations_file_id: cloudFileId,
      revocations_sha256: digest,
      revocations_generation: registry.generation,
    },
  }
  return validateRevocationRegistryArtifact(artifact)
}

export function validateRevocationRegistryArtifact(artifact) {
  assertExactFields(artifact, ARTIFACT_FIELDS, 'revocation registry artifact')
  validateRevocationRegistry(artifact.registry)
  assert(typeof artifact.text === 'string' && artifact.text === stableJson(artifact.registry), 'revocation registry artifact text is inconsistent')
  const digest = sha256(artifact.text)
  assert(artifact.sha256 === digest, 'revocation registry artifact SHA-256 is inconsistent')
  assert(['housing-data', 'housing-data/preview'].some((dataRoot) => artifact.cosKey === `${dataRoot}/control/revocations-${digest}.json`), 'revocation registry artifact COS key is inconsistent')
  assert(typeof artifact.cloudFileId === 'string' && artifact.cloudFileId.startsWith('cloud://') && artifact.cloudFileId.endsWith(`/${artifact.cosKey}`), 'revocation registry artifact cloud file ID is inconsistent')
  assertExactFields(artifact.currentFields, CURRENT_FIELDS, 'revocation registry current fields')
  assert(artifact.currentFields.revocations_file_id === artifact.cloudFileId, 'revocation registry current file ID is inconsistent')
  assert(artifact.currentFields.revocations_sha256 === digest, 'revocation registry current SHA-256 is inconsistent')
  assert(artifact.currentFields.revocations_generation === artifact.registry.generation, 'revocation registry current generation is inconsistent')
  return artifact
}
