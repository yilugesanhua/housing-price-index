import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAutomaticRollbackPointer, validateManifestFunctionOutput } from './post-publish-guard.mjs'
import {
  appendFailedReleaseRevocations,
  buildRevocationRegistryArtifact,
  buildRollbackRevisionId,
  createRevocationRegistry,
} from './control-plane.mjs'

const current = {
  dataset_version: '2026-07-0123456789ab',
  source_dataset_version: '2026-07-0123456789ab',
  dataset_as_of: '2026-07',
  schema_version: '1.3.0',
  manifest_file_id: 'cloud://cloudtest.bucket-test/housing-data/releases/2026-07-0123456789ab/manifest.json',
  manifest_sha256: 'a'.repeat(64),
  published_at: '2026-08-17T02:00:00.000Z',
  previous_dataset_version: null,
  next_check_at: '2026-09-15T01:40:00.000Z',
  control_schema_version: '1.0.0',
  control_generation: 1,
  revocations_file_id: 'cloud://cloudtest.bucket-test/housing-data/control/revocations-' + 'c'.repeat(64) + '.json',
  revocations_sha256: 'c'.repeat(64),
  revocations_generation: 1,
  transition_type: 'publish',
  data_status: 'current',
  status_reason: 'monthly_publish',
  control_generated_at: '2026-08-17T02:00:00.000Z',
  control_valid_until: '2026-08-18T02:00:00.000Z',
}

function invocation(payload, overrides = {}) {
  return JSON.stringify({
    Result: {
      InvokeResult: 0,
      ErrMsg: '',
      RetMsg: JSON.stringify(payload),
      ...overrides,
    },
    RequestId: 'request-id',
  })
}

test('accepts the authoritative current from a successful Tencent SCF SDK response', () => {
  assert.equal(validateManifestFunctionOutput(invocation({ current }), current).dataset_version, current.dataset_version)
})

test('rejects malformed or mismatched cloud function results', () => {
  assert.throws(() => validateManifestFunctionOutput('not-json', current), /not JSON/)
  assert.throws(() => validateManifestFunctionOutput(JSON.stringify({ current }), current), /SDK result is missing/)
  assert.throws(() => validateManifestFunctionOutput(invocation({ current: { ...current, manifest_sha256: 'b'.repeat(64) } }), current), /manifest_sha256 mismatch/)
  assert.throws(() => validateManifestFunctionOutput(invocation({ current: { ...current, unexpected: true } }), current), /fields mismatch/)
  assert.throws(() => validateManifestFunctionOutput(JSON.stringify({ Result: { InvokeResult: 0, RetMsg: 'not-json' } }), current), /RetMsg is not JSON/)
})

test('rejects failed SCF responses even when another field carries a matching current', () => {
  const failed = {
    Result: {
      InvokeResult: 1,
      ErrMsg: 'function failed',
      RetMsg: JSON.stringify({ current }),
      Log: JSON.stringify({ current }),
    },
    untrusted: { current },
  }
  assert.throws(() => validateManifestFunctionOutput(JSON.stringify(failed), current), /invocation failed: function failed/)
})

test('builds a rollback pointer without mutating the prior pointer', () => {
  const previousDatasetVersion = '2026-06-abcdefabcdef'
  const previous = {
    ...current,
    source_dataset_version: '2026-06-111111111111',
    dataset_version: previousDatasetVersion,
    dataset_as_of: '2026-06',
    manifest_file_id: `cloud://cloudtest.bucket-test/housing-data/releases/${previousDatasetVersion}/manifest.json`,
    published_at: 'old',
    previous_dataset_version: null,
    control_generation: 1,
  }
  const rollbackRevisionId = buildRollbackRevisionId(current.dataset_version)
  const registry = appendFailedReleaseRevocations(createRevocationRegistry({ generatedAt: '2026-08-17T01:59:00.000Z' }), {
    datasetVersion: current.dataset_version,
    sourceDatasetVersion: current.source_dataset_version,
    revokedAt: '2026-08-17T02:00:00.000Z',
    replacementDatasetVersion: previous.dataset_version,
    replacementSourceDatasetVersion: previous.source_dataset_version,
    revisionId: rollbackRevisionId,
    reason: 'post-publish full guard rejected the candidate package',
  })
  const registryArtifact = buildRevocationRegistryArtifact(registry, { cloudEnvId: 'cloudtest', storageBucket: 'bucket-test' })
  const rollback = buildAutomaticRollbackPointer(previous, current.dataset_version, {
    rolledBackAt: '2026-08-17T02:00:00.000Z', controlGeneration: 2, registryArtifact,
    failedSourceDatasetVersion: current.source_dataset_version,
    rollbackRevisionId,
    targetSourceDatasetVersion: previous.source_dataset_version,
  })
  assert.equal(rollback.dataset_version, previous.dataset_version)
  assert.equal(rollback.previous_dataset_version, null)
  assert.equal(rollback.rollback_from_dataset_version, current.dataset_version)
  assert.equal(rollback.revocations_sha256, registryArtifact.sha256)
  assert.equal(rollback.control_generation, 2)
  assert.equal(rollback.published_at, '2026-08-17T02:00:00.000Z')
  assert.equal(rollback.control_valid_until, '2026-08-18T02:00:00.000Z')
  assert.equal(previous.published_at, 'old')
})

test('rejects an invalid or self-referential rollback target', () => {
  assert.throws(() => buildAutomaticRollbackPointer(current, current.dataset_version), /equals failed/)
  assert.throws(() => buildAutomaticRollbackPointer({ ...current, manifest_sha256: 'bad' }, '2026-08-abcdefabcdef'), /manifest hash/)
  const previous = { ...current, source_dataset_version: '2026-06-111111111111', dataset_version: '2026-06-abcdefabcdef', dataset_as_of: '2026-06', control_generation: 1 }
  const rollbackRevisionId = buildRollbackRevisionId(current.dataset_version)
  const mismatched = appendFailedReleaseRevocations(createRevocationRegistry({ generatedAt: '2026-08-17T01:59:00.000Z' }), {
    datasetVersion: current.dataset_version,
    sourceDatasetVersion: current.source_dataset_version,
    revokedAt: '2026-08-17T02:00:00.000Z',
    replacementDatasetVersion: '2026-05-111111111111',
    replacementSourceDatasetVersion: previous.source_dataset_version,
    revisionId: rollbackRevisionId,
    reason: 'wrong rollback binding',
  })
  const artifact = buildRevocationRegistryArtifact(mismatched, { cloudEnvId: 'cloudtest', storageBucket: 'bucket-test' })
  assert.throws(() => buildAutomaticRollbackPointer(previous, current.dataset_version, {
    controlGeneration: 2,
    registryArtifact: artifact,
    failedSourceDatasetVersion: current.source_dataset_version,
    rollbackRevisionId,
    targetSourceDatasetVersion: previous.source_dataset_version,
  }), /rollback dataset replacement is incomplete/)
})
