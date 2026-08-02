import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REVOCATION_REGISTRY_SCHEMA_VERSION,
  appendFailedDatasetRevocation,
  appendFailedReleaseRevocations,
  appendHistoricalCorrectionRevocations,
  appendHistoricalSourceRevocation,
  appendRevocations,
  assertRollbackClosure,
  assertTargetNotRevoked,
  buildRevocationRegistryArtifact,
  buildRollbackRevisionId,
  classifyControlPointer,
  createRevocationRegistry,
  sha256,
  stableJson,
  validateRevocationRegistry,
  validateRevocationRegistryArtifact,
  validateRevocationRegistryProgression,
} from './control-plane.mjs'

const versions = {
  safeDataset: '2026-05-111111111111',
  failedDataset: '2026-06-222222222222',
  olderSource: '2026-05-333333333333',
  correctedSource: '2026-06-444444444444',
  otherDataset: '2026-07-555555555555',
  otherSource: '2026-07-666666666666',
}
const firstAt = '2026-07-29T01:00:00.000Z'
const secondAt = '2026-07-29T01:01:00.000Z'
const thirdAt = '2026-07-29T01:02:00.000Z'

function emptyRegistry() {
  return createRevocationRegistry({ generatedAt: firstAt })
}

test('creates strict schema-v1 registries without mutating caller arrays', () => {
  const datasetEntries = Object.freeze([Object.freeze({
    dataset_version: versions.failedDataset,
    revoked_at: firstAt,
    revision_id: null,
    replacement_dataset_version: versions.safeDataset,
    reason: 'post_publish_guard_failed',
  })])
  const registry = createRevocationRegistry({ generatedAt: firstAt, revokedDatasetVersions: datasetEntries })
  assert.equal(registry.registry_schema_version, REVOCATION_REGISTRY_SCHEMA_VERSION)
  assert.equal(registry.generation, 1)
  assert.equal(registry.revoked_dataset_versions.length, 1)
  assert.deepEqual(datasetEntries[0], {
    dataset_version: versions.failedDataset,
    revoked_at: firstAt,
    revision_id: null,
    replacement_dataset_version: versions.safeDataset,
    reason: 'post_publish_guard_failed',
  })
  assert.equal(validateRevocationRegistry(registry), registry)
})

test('stable JSON and SHA-256 do not depend on object insertion order', () => {
  const left = { z: 1, nested: { b: 2, a: 1 }, a: ['x', { y: true, x: false }] }
  const right = { a: ['x', { x: false, y: true }], nested: { a: 1, b: 2 }, z: 1 }
  assert.equal(stableJson(left), stableJson(right))
  assert.equal(sha256(stableJson(left)), sha256(stableJson(right)))
  assert.equal(stableJson(left).endsWith('\n'), true)
  assert.throws(() => stableJson({ invalid: undefined }), /non-JSON value/)
})

test('control pointers distinguish a true legacy pointer from partial or unsupported control state', () => {
  assert.equal(classifyControlPointer({ dataset_version: versions.safeDataset }), 'legacy')
  assert.throws(() => classifyControlPointer({ control_schema_version: '1.0.0' }), /fields are incomplete/)
  const controlled = {
    control_schema_version: '1.0.0',
    control_generation: 1,
    source_dataset_version: versions.otherSource,
    revocations_file_id: 'cloud://test/control.json',
    revocations_sha256: 'a'.repeat(64),
    revocations_generation: 1,
    transition_type: 'publish',
    data_status: 'current',
    status_reason: 'test',
    control_generated_at: firstAt,
    control_valid_until: '2026-07-30T01:00:00.000Z',
  }
  assert.equal(classifyControlPointer(controlled), 'controlled')
  assert.throws(() => classifyControlPointer({ ...controlled, control_schema_version: '2.0.0' }), /schema is unsupported/)
  assert.throws(() => classifyControlPointer({ ...controlled, rollback_from_dataset_version: versions.failedDataset }), /non-rollback/)
})

test('builds a content-addressed COS key, complete cloud file ID, and current pointer fields', () => {
  const registry = emptyRegistry()
  const artifact = buildRevocationRegistryArtifact(registry, {
    cloudEnvId: 'cloud1-d3gpdx70w5d05c68c',
    storageBucket: '636c-cloud1-d3gpdx70w5d05c68c-1456861154',
  })
  assert.equal(artifact.sha256, sha256(artifact.text))
  assert.equal(artifact.cosKey, `housing-data/control/revocations-${artifact.sha256}.json`)
  assert.equal(artifact.cloudFileId, `cloud://cloud1-d3gpdx70w5d05c68c.636c-cloud1-d3gpdx70w5d05c68c-1456861154/${artifact.cosKey}`)
  assert.deepEqual(artifact.currentFields, {
    revocations_file_id: artifact.cloudFileId,
    revocations_sha256: artifact.sha256,
    revocations_generation: 1,
  })
  assert.notEqual(artifact.registry, registry)
  assert.equal(validateRevocationRegistryArtifact(artifact), artifact)
  assert.throws(() => validateRevocationRegistryArtifact({
    ...artifact,
    currentFields: { ...artifact.currentFields, revocations_generation: 2 },
  }), /current generation is inconsistent/)
  assert.throws(() => validateRevocationRegistryArtifact({ ...artifact, text: `${artifact.text} ` }), /text is inconsistent/)
})

test('rejects malformed, non-canonical, duplicate, and self-replacing registry entries', () => {
  const registry = emptyRegistry()
  assert.throws(() => validateRevocationRegistry({ ...registry, extra: true }), /fields are invalid/)
  assert.throws(() => validateRevocationRegistry({ ...registry, generation: 0 }), /positive safe integer/)
  assert.throws(() => validateRevocationRegistry({ ...registry, generated_at: '2026-07-29' }), /canonical ISO/)

  const entry = {
    dataset_version: versions.failedDataset,
    revoked_at: firstAt,
    revision_id: null,
    replacement_dataset_version: versions.safeDataset,
    reason: 'failed',
  }
  const duplicate = createRevocationRegistry({ generatedAt: firstAt, revokedDatasetVersions: [entry] })
  assert.throws(() => validateRevocationRegistry({ ...duplicate, revoked_dataset_versions: [entry, entry] }), /duplicate versions/)
  const sparse = []
  sparse.length = 1
  assert.throws(() => validateRevocationRegistry({ ...registry, revoked_dataset_versions: sparse }), /sparse entries/)
  assert.throws(() => createRevocationRegistry({
    generatedAt: firstAt,
    revokedDatasetVersions: [{ ...entry, replacement_dataset_version: versions.failedDataset }],
  }), /replace a dataset with itself/)
})

test('failed package revocation changes only the dataset namespace and preserves the prior registry', () => {
  const initial = Object.freeze(emptyRegistry())
  const next = appendFailedDatasetRevocation(initial, {
    datasetVersion: versions.failedDataset,
    revokedAt: secondAt,
    replacementDatasetVersion: versions.safeDataset,
    reason: 'post_publish_guard_failed',
  })
  assert.equal(next.generation, 2)
  assert.equal(next.revoked_dataset_versions[0].dataset_version, versions.failedDataset)
  assert.equal(next.revoked_source_dataset_versions.length, 0)
  assert.equal(initial.revoked_dataset_versions.length, 0)
  assert.throws(() => assertTargetNotRevoked(next, {
    datasetVersion: versions.failedDataset,
    sourceDatasetVersion: versions.otherSource,
  }), /target dataset version is revoked/)
  assert.equal(assertTargetNotRevoked(next, {
    datasetVersion: versions.safeDataset,
    sourceDatasetVersion: versions.otherSource,
  }), true)
})

test('failed release revocation closes dataset and source replacement in one generation', () => {
  const revisionId = buildRollbackRevisionId(versions.failedDataset)
  const next = appendFailedReleaseRevocations(emptyRegistry(), {
    datasetVersion: versions.failedDataset,
    sourceDatasetVersion: versions.otherSource,
    revokedAt: secondAt,
    replacementDatasetVersion: versions.safeDataset,
    replacementSourceDatasetVersion: versions.correctedSource,
    revisionId,
    reason: 'unsafe release rollback',
  })
  assert.equal(next.generation, 2)
  assert.equal(next.revoked_dataset_versions[0].revision_id, revisionId)
  assert.equal(next.revoked_source_dataset_versions[0].revision_id, revisionId)
  assert.equal(next.revoked_dataset_versions[0].revoked_at, next.revoked_source_dataset_versions[0].revoked_at)
  assert.equal(next.revoked_dataset_versions[0].replacement_dataset_version, versions.safeDataset)
  assert.equal(next.revoked_source_dataset_versions[0].replacement_source_dataset_version, versions.correctedSource)
  assert.equal(assertRollbackClosure(next, {
    failedDatasetVersion: versions.failedDataset,
    failedSourceDatasetVersion: versions.otherSource,
    targetDatasetVersion: versions.safeDataset,
    targetSourceDatasetVersion: versions.correctedSource,
    revisionId,
  }).sourceEntry.source_dataset_version, versions.otherSource)
  assert.throws(() => assertRollbackClosure(next, {
    failedDatasetVersion: versions.failedDataset,
    failedSourceDatasetVersion: versions.otherSource,
    targetDatasetVersion: versions.safeDataset,
    targetSourceDatasetVersion: versions.olderSource,
    revisionId,
  }), /source replacement is incomplete/)
  assert.throws(() => appendFailedReleaseRevocations(emptyRegistry(), {
    datasetVersion: versions.failedDataset,
    sourceDatasetVersion: versions.otherSource,
    revokedAt: secondAt,
    replacementDatasetVersion: versions.safeDataset,
    replacementSourceDatasetVersion: versions.correctedSource,
    revisionId: 'invalid',
    reason: 'unsafe release rollback',
  }), /revisionId is invalid/)
})

test('historical correction revokes only the source namespace and requires a revision ID', () => {
  const initial = emptyRegistry()
  const next = appendHistoricalSourceRevocation(initial, {
    sourceDatasetVersion: versions.olderSource,
    revokedAt: secondAt,
    revisionId: 'revision-2026-05-official-fix',
    replacementSourceDatasetVersion: versions.correctedSource,
    reason: 'official_historical_correction',
  })
  assert.equal(next.revoked_dataset_versions.length, 0)
  assert.equal(next.revoked_source_dataset_versions[0].source_dataset_version, versions.olderSource)
  assert.throws(() => assertTargetNotRevoked(next, {
    datasetVersion: versions.otherDataset,
    sourceDatasetVersion: versions.olderSource,
  }), /target source dataset version is revoked/)
  assert.throws(() => appendHistoricalSourceRevocation(initial, {
    sourceDatasetVersion: versions.olderSource,
    revokedAt: secondAt,
    replacementSourceDatasetVersion: versions.correctedSource,
    reason: 'official_historical_correction',
  }), /revision_id is invalid/)
})

test('historical correction transition revokes both the replaced package and source in one generation', () => {
  const next = appendHistoricalCorrectionRevocations(emptyRegistry(), {
    datasetVersion: versions.failedDataset,
    sourceDatasetVersion: versions.olderSource,
    revokedAt: secondAt,
    revisionId: 'revision-2026-05-official-fix',
    replacementDatasetVersion: versions.safeDataset,
    replacementSourceDatasetVersion: versions.correctedSource,
    reason: 'official_historical_correction',
  })
  assert.equal(next.generation, 2)
  assert.equal(next.revoked_dataset_versions[0].dataset_version, versions.failedDataset)
  assert.equal(next.revoked_source_dataset_versions[0].source_dataset_version, versions.olderSource)
  assert.equal(assertTargetNotRevoked(next, {
    datasetVersion: versions.safeDataset,
    sourceDatasetVersion: versions.correctedSource,
  }), true)
})

test('successive generations are cumulative across both revocation namespaces', () => {
  const second = appendFailedDatasetRevocation(emptyRegistry(), {
    datasetVersion: versions.failedDataset,
    revokedAt: secondAt,
    replacementDatasetVersion: versions.safeDataset,
    reason: 'post_publish_guard_failed',
  })
  const third = appendHistoricalSourceRevocation(second, {
    sourceDatasetVersion: versions.olderSource,
    revokedAt: thirdAt,
    revisionId: 'revision-2026-05-official-fix',
    replacementSourceDatasetVersion: versions.correctedSource,
    reason: 'official_historical_correction',
  })
  assert.equal(third.generation, 3)
  assert.equal(third.revoked_dataset_versions[0].dataset_version, versions.failedDataset)
  assert.equal(third.revoked_source_dataset_versions[0].source_dataset_version, versions.olderSource)
  assert.equal(validateRevocationRegistryProgression(second, third), third)
})

test('progression rejects repeated or skipped generations, dropped entries, and rewritten history', () => {
  const second = appendFailedDatasetRevocation(emptyRegistry(), {
    datasetVersion: versions.failedDataset,
    revokedAt: secondAt,
    replacementDatasetVersion: versions.safeDataset,
    reason: 'post_publish_guard_failed',
  })
  const validThird = appendHistoricalSourceRevocation(second, {
    sourceDatasetVersion: versions.olderSource,
    revokedAt: thirdAt,
    revisionId: 'revision-2026-05-official-fix',
    replacementSourceDatasetVersion: versions.correctedSource,
    reason: 'official_historical_correction',
  })
  assert.throws(() => validateRevocationRegistryProgression(second, { ...validThird, generation: 2 }), /increase by exactly one/)
  assert.throws(() => validateRevocationRegistryProgression(second, { ...validThird, generation: 4 }), /increase by exactly one/)
  assert.throws(() => validateRevocationRegistryProgression(second, {
    ...validThird,
    revoked_dataset_versions: [],
  }), /dropped/)
  assert.throws(() => validateRevocationRegistryProgression(second, {
    ...validThird,
    revoked_dataset_versions: validThird.revoked_dataset_versions.map((entry) => ({ ...entry, reason: 'rewritten' })),
  }), /changed immutable entry/)
})

test('append rejects no-op generations and duplicate revocations', () => {
  const initial = emptyRegistry()
  assert.throws(() => appendRevocations(initial, { generatedAt: secondAt }), /add at least one revocation/)
  const second = appendFailedDatasetRevocation(initial, {
    datasetVersion: versions.failedDataset,
    revokedAt: secondAt,
    replacementDatasetVersion: versions.safeDataset,
    reason: 'post_publish_guard_failed',
  })
  assert.throws(() => appendFailedDatasetRevocation(second, {
    datasetVersion: versions.failedDataset,
    revokedAt: thirdAt,
    replacementDatasetVersion: versions.safeDataset,
    reason: 'duplicate_attempt',
  }), /already registered/)
})
