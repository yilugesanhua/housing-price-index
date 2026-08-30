import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  loadHistoricalRevisionManifest,
  parseHistoricalRevisionManifest,
} from './revision-manifest-context.mjs'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function historicalManifest(revisionText) {
  return {
    release_type: 'historical_correction',
    revision_manifest_sha256: sha256(revisionText),
    revision_manifest_bytes: Buffer.byteLength(revisionText),
  }
}

test('loads a historical revision manifest only from the canonical release path', async () => {
  const revisionText = '{"revision_id":"revision-2026-06-official-fix"}\n'
  const manifest = historicalManifest(revisionText)
  const requested = []
  const revision = await loadHistoricalRevisionManifest(manifest, {
    releaseRoot: 'housing-data/releases/2026-06-aaaaaaaaaaaa',
    readText: async (key) => {
      requested.push(key)
      return revisionText
    },
  })
  assert.deepEqual(revision, { revision_id: 'revision-2026-06-official-fix' })
  assert.deepEqual(requested, ['housing-data/releases/2026-06-aaaaaaaaaaaa/revision-manifest.json'])
})

test('rejects a missing, altered, malformed, or wrong-length historical revision manifest', () => {
  const revisionText = '{"revision_id":"revision-2026-06-official-fix"}\n'
  const manifest = historicalManifest(revisionText)
  assert.throws(() => parseHistoricalRevisionManifest(manifest, ''), /unavailable/)
  assert.throws(() => parseHistoricalRevisionManifest(manifest, `${revisionText} `), /SHA-256 mismatch/)
  assert.throws(() => parseHistoricalRevisionManifest({ ...manifest, revision_manifest_sha256: sha256('{') }, '{'), /byte length mismatch/)
  const malformed = '{'
  assert.throws(() => parseHistoricalRevisionManifest({
    ...manifest,
    revision_manifest_sha256: sha256(malformed),
    revision_manifest_bytes: Buffer.byteLength(malformed),
  }, malformed), /not valid JSON/)
})

test('monthly releases do not request a revision manifest', async () => {
  const result = await loadHistoricalRevisionManifest({ release_type: 'monthly_update' }, {
    releaseRoot: 'housing-data/releases/2026-06-aaaaaaaaaaaa',
    readText: async () => {
      throw new Error('monthly release must not read a revision manifest')
    },
  })
  assert.equal(result, undefined)
})
