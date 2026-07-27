import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAutomaticRollbackPointer, validateManifestFunctionOutput } from './post-publish-guard.mjs'

const current = {
  dataset_version: '2026-07-0123456789ab',
  dataset_as_of: '2026-07',
  schema_version: '1.3.0',
  manifest_file_id: 'cloud://env.bucket/housing-data/releases/2026-07-0123456789ab/manifest.json',
  manifest_sha256: 'a'.repeat(64),
  next_check_at: '2026-09-15T01:40:00.000Z',
}

test('accepts direct and nested-string cloud function results', () => {
  assert.equal(validateManifestFunctionOutput(JSON.stringify({ result: { current } }), current).dataset_version, current.dataset_version)
  assert.equal(validateManifestFunctionOutput(JSON.stringify({ Result: JSON.stringify({ current }) }), current).manifest_sha256, current.manifest_sha256)
})

test('rejects malformed or mismatched cloud function results', () => {
  assert.throws(() => validateManifestFunctionOutput('not-json', current), /not JSON/)
  assert.throws(() => validateManifestFunctionOutput(JSON.stringify({ current: { ...current, manifest_sha256: 'b'.repeat(64) } }), current), /manifest_sha256 mismatch/)
})

test('builds a rollback pointer without mutating the prior pointer', () => {
  const previous = { ...current, dataset_version: '2026-06-abcdefabcdef', dataset_as_of: '2026-06', published_at: 'old', previous_dataset_version: null }
  const rollback = buildAutomaticRollbackPointer(previous, current.dataset_version, '2026-08-17T02:00:00.000Z')
  assert.equal(rollback.dataset_version, previous.dataset_version)
  assert.equal(rollback.previous_dataset_version, current.dataset_version)
  assert.equal(rollback.published_at, '2026-08-17T02:00:00.000Z')
  assert.equal(previous.published_at, 'old')
})

test('rejects an invalid or self-referential rollback target', () => {
  assert.throws(() => buildAutomaticRollbackPointer(current, current.dataset_version), /equals failed/)
  assert.throws(() => buildAutomaticRollbackPointer({ ...current, manifest_sha256: 'bad' }, '2026-08-abcdefabcdef'), /manifest hash/)
})
