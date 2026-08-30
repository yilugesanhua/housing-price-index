import { createHash } from 'node:crypto'

function assert(condition, message) {
  if (!condition) throw new Error(`Historical revision context rejected: ${message}`)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function parseHistoricalRevisionManifest(manifest, text, label = 'historical correction revision manifest') {
  if (manifest?.release_type !== 'historical_correction') return undefined
  assert(typeof text === 'string' && text.length > 0, `${label} is unavailable`)
  assert(sha256(text) === manifest.revision_manifest_sha256, `${label} SHA-256 mismatch`)
  assert(Buffer.byteLength(text) === manifest.revision_manifest_bytes, `${label} byte length mismatch`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Historical revision context rejected: ${label} is not valid JSON`)
  }
}

export async function loadHistoricalRevisionManifest(manifest, {
  releaseRoot,
  readText,
  label,
} = {}) {
  if (manifest?.release_type !== 'historical_correction') return undefined
  assert(typeof releaseRoot === 'string' && releaseRoot.length > 0, 'release root is unavailable')
  assert(typeof readText === 'function', 'revision manifest reader is unavailable')
  const text = await readText(`${releaseRoot}/revision-manifest.json`)
  return parseHistoricalRevisionManifest(manifest, text, label)
}
