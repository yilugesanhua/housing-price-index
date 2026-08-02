import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertPointerBaseline,
  assertProductionPointerBaseline,
  classifyHistoricalCorrectionPublishState,
  validateHistoricalCorrectionPublishState,
} from './publish-remote-data-guards.mjs'
import {
  appendHistoricalCorrectionRevocations,
  buildRevocationRegistryArtifact,
  createRevocationRegistry,
} from './control-plane.mjs'

const oldDatasetVersion = '2026-06-111111111111'
const candidateDatasetVersion = '2026-06-222222222222'
const oldSourceDatasetVersion = '2026-06-333333333333'
const candidateSourceDatasetVersion = '2026-06-444444444444'
const gate = {
  revision_id: 'revision-2026-06-official-fix',
  source_dataset_version: candidateSourceDatasetVersion,
  supersedes_source_dataset_version: oldSourceDatasetVersion,
}
const candidateManifest = {
  dataset_version: candidateDatasetVersion,
  dataset_as_of: '2026-06',
  release_type: 'historical_correction',
  revision_id: gate.revision_id,
  source_dataset_version: candidateSourceDatasetVersion,
  supersedes_source_dataset_version: oldSourceDatasetVersion,
}
const candidateRevisionManifest = {
  revision_id: gate.revision_id,
  source_dataset_version: candidateSourceDatasetVersion,
  supersedes_source_dataset_version: oldSourceDatasetVersion,
  source_version_chain: [oldSourceDatasetVersion, candidateSourceDatasetVersion],
  revoked_source_dataset_versions: [oldSourceDatasetVersion],
}
const registry = appendHistoricalCorrectionRevocations(
  createRevocationRegistry({ generatedAt: '2026-07-30T00:00:00.000Z' }),
  {
    datasetVersion: oldDatasetVersion,
    sourceDatasetVersion: oldSourceDatasetVersion,
    revokedAt: '2026-07-30T00:01:00.000Z',
    revisionId: gate.revision_id,
    replacementDatasetVersion: candidateDatasetVersion,
    replacementSourceDatasetVersion: candidateSourceDatasetVersion,
    reason: 'approved historical correction',
  },
)
const artifact = buildRevocationRegistryArtifact(registry, { cloudEnvId: 'cloudtest', storageBucket: 'bucket-test' })
const candidatePointer = {
  dataset_version: candidateDatasetVersion,
  source_dataset_version: candidateSourceDatasetVersion,
  dataset_as_of: '2026-06',
  schema_version: '1.3.0',
  manifest_file_id: `cloud://cloudtest.bucket-test/housing-data/releases/${candidateDatasetVersion}/manifest.json`,
  manifest_sha256: 'a'.repeat(64),
  published_at: '2026-07-30T00:02:00.000Z',
  previous_dataset_version: null,
  next_check_at: '2026-08-17T01:40:00.000Z',
  control_schema_version: '1.0.0',
  control_generation: 2,
  ...artifact.currentFields,
  transition_type: 'historical_correction',
  data_status: 'current',
  status_reason: 'audited_historical_correction',
  control_generated_at: '2026-07-30T00:02:00.000Z',
  control_valid_until: '2026-07-31T00:02:00.000Z',
  superseded_dataset_version: oldDatasetVersion,
  superseded_source_dataset_version: oldSourceDatasetVersion,
}

test('historical correction distinguishes and validates old_active state', () => {
  const state = validateHistoricalCorrectionPublishState({
    previous: { dataset_version: oldDatasetVersion, dataset_as_of: '2026-06' },
    previousManifest: { dataset_version: oldDatasetVersion, source_dataset_version: oldSourceDatasetVersion },
    candidateManifest,
    candidateRevisionManifest,
    gate,
    datasetVersion: candidateDatasetVersion,
  })
  assert.equal(state, 'old_active')
})

test('historical correction validates candidate_active metadata without comparing the new source to the old source', () => {
  const state = validateHistoricalCorrectionPublishState({
    previous: candidatePointer,
    previousManifest: candidateManifest,
    candidateManifest,
    candidateRevisionManifest,
    registry,
    gate,
    datasetVersion: candidateDatasetVersion,
    cloudEnvId: 'cloudtest',
    storageBucket: 'bucket-test',
  })
  assert.equal(state, 'candidate_active')
})

test('historical correction rejects conflicting active and candidate identities', () => {
  assert.throws(() => validateHistoricalCorrectionPublishState({
    previous: { dataset_version: oldDatasetVersion, dataset_as_of: '2026-06' },
    previousManifest: { dataset_version: oldDatasetVersion, source_dataset_version: candidateSourceDatasetVersion },
    candidateManifest,
    candidateRevisionManifest,
    gate,
    datasetVersion: candidateDatasetVersion,
  }), /old active source/)
  assert.throws(() => validateHistoricalCorrectionPublishState({
    previous: candidatePointer,
    previousManifest: candidateManifest,
    candidateManifest: { ...candidateManifest, revision_id: 'revision-2026-06-other-fix' },
    candidateRevisionManifest,
    registry,
    gate,
    datasetVersion: candidateDatasetVersion,
    cloudEnvId: 'cloudtest',
    storageBucket: 'bucket-test',
  }), /revision ID/)
})

test('historical correction classifier returns conflict for every incomplete candidate-active identity', () => {
  const base = {
    previous: candidatePointer,
    previousManifest: candidateManifest,
    candidateManifest,
    candidateRevisionManifest,
    registry,
    gate,
    datasetVersion: candidateDatasetVersion,
    cloudEnvId: 'cloudtest',
    storageBucket: 'bucket-test',
  }
  assert.equal(classifyHistoricalCorrectionPublishState(base), 'candidate_active')
  assert.equal(classifyHistoricalCorrectionPublishState({ ...base, registry: {
    ...registry,
    revoked_dataset_versions: [],
  } }), 'conflict')
  assert.equal(classifyHistoricalCorrectionPublishState({ ...base, registry: {
    ...registry,
    revoked_source_dataset_versions: [],
  } }), 'conflict')
  assert.equal(classifyHistoricalCorrectionPublishState({
    ...base,
    registry: {
      ...registry,
      revoked_dataset_versions: registry.revoked_dataset_versions.map((entry) => ({
        ...entry,
        replacement_dataset_version: '2026-06-555555555555',
      })),
    },
  }), 'conflict')
  assert.equal(classifyHistoricalCorrectionPublishState({
    ...base,
    registry: {
      ...registry,
      revoked_source_dataset_versions: registry.revoked_source_dataset_versions.map((entry) => ({
        ...entry,
        revision_id: 'revision-2026-06-other-fix',
      })),
    },
  }), 'conflict')
  const legacyCandidate = Object.fromEntries(Object.entries(candidatePointer).filter(([key]) => ![
    'control_schema_version', 'control_generation', 'revocations_file_id', 'revocations_sha256',
    'revocations_generation', 'transition_type', 'data_status', 'status_reason', 'control_generated_at',
    'control_valid_until', 'superseded_dataset_version', 'superseded_source_dataset_version',
  ].includes(key)))
  assert.equal(classifyHistoricalCorrectionPublishState({ ...base, previous: legacyCandidate }), 'conflict')
})

test('pointer baseline checks compare exact bytes and distinguish a missing pointer', () => {
  assert.equal(assertPointerBaseline('{"version":1}\n', '{"version":1}\n', 'candidate activation'), true)
  assert.equal(assertPointerBaseline(null, null, 'first activation'), true)
  assert.throws(() => assertPointerBaseline('{"version":2}\n', '{"version":1}\n', 'candidate activation'), /changed before candidate activation/)
  assert.throws(() => assertPointerBaseline('{"version":1}\n', null, 'first activation'), /changed before first activation/)
})

test('production publishing and rollback require migration before consuming a legacy pointer', () => {
  assert.equal(assertProductionPointerBaseline(null), 'absent')
  assert.equal(assertProductionPointerBaseline(candidatePointer), 'controlled')
  assert.throws(() => assertProductionPointerBaseline({
    dataset_version: oldDatasetVersion,
    dataset_as_of: '2026-06',
  }), /run the approved one-time legacy migration first/)
})
