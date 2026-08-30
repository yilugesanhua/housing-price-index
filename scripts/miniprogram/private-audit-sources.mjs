import { copyFile, glob, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { sha256 } from './remote-data-lib.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(`Private audit source verification failed: ${message}`)
}

function safeBatchId(value) {
  return typeof value === 'string' && /^official-html-20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(value)
}

function sourcePath(batchId, suffix) {
  return `source/${batchId}${suffix}`
}

export async function collectPrivateAuditSources({ root, outputRoot, sourceBatchIds }) {
  assert(Array.isArray(sourceBatchIds) && sourceBatchIds.length > 0, 'source batch IDs are missing')
  assert(sourceBatchIds.every(safeBatchId), 'source batch ID is invalid')
  const expected = [...sourceBatchIds].sort()
  assert(new Set(expected).size === expected.length && JSON.stringify(expected) === JSON.stringify(sourceBatchIds), 'source batch IDs must be sorted and unique')
  const matchesById = new Map()
  for await (const path of await glob('data/raw/**/*.batch.json', { cwd: root })) {
    const absolute = resolve(root, path)
    const batch = JSON.parse(await readFile(absolute, 'utf8'))
    const batchId = batch?.source_batch?.source_batch_id
    if (!expected.includes(batchId)) continue
    const matches = matchesById.get(batchId) ?? []
    matches.push({ absolute, relativePath: path.replaceAll('\\', '/'), batch })
    matchesById.set(batchId, matches)
  }
  await mkdir(resolve(outputRoot, 'source'), { recursive: true })
  const results = []
  for (const batchId of expected) {
    const matches = matchesById.get(batchId) ?? []
    assert(matches.length === 1, `${batchId}: expected exactly one archived batch, got ${matches.length}`)
    const { absolute: batchPath, relativePath: batchRelativePath, batch } = matches[0]
    const source = batch.source_batch
    assert(source?.source_batch_id === batchId, `${batchId}: source batch identity differs`)
    assert(/^https:\/\/(?:www\.)?stats\.gov\.cn\//.test(source.source_url || ''), `${batchId}: official source URL is invalid`)
    assert(/^[a-f0-9]{64}$/.test(source.raw_content_sha256 || ''), `${batchId}: raw content SHA-256 is invalid`)
    const archivePath = resolve(dirname(batchPath), `${source.raw_content_sha256}.html.gz`)
    const archiveRelativePath = relative(root, archivePath).replaceAll('\\', '/')
    assert(archiveRelativePath.startsWith('data/raw/') && !archiveRelativePath.includes('..'), `${batchId}: archive path is unsafe`)
    const compressed = await readFile(archivePath)
    let raw
    try {
      raw = gunzipSync(compressed)
    } catch (_) {
      throw new Error(`${batchId}: compressed source archive cannot be restored`)
    }
    assert(sha256(raw) === source.raw_content_sha256, `${batchId}: restored source SHA-256 differs`)
    const batchDestination = resolve(outputRoot, sourcePath(batchId, '.batch.json'))
    const archiveDestination = resolve(outputRoot, sourcePath(batchId, '.html.gz'))
    const recoveryDestination = resolve(outputRoot, sourcePath(batchId, '.recovery.json'))
    await copyFile(batchPath, batchDestination)
    await copyFile(archivePath, archiveDestination)
    const recovery = {
      source_batch_id: batchId,
      source_url: source.source_url,
      final_url: source.final_url,
      stat_month: source.stat_month,
      raw_content_sha256: source.raw_content_sha256,
      raw_archive_uri: source.raw_archive_uri,
      public_batch_path: batchRelativePath,
      public_compressed_archive_path: archiveRelativePath,
      compressed_archive_sha256: sha256(compressed),
      compressed_archive_bytes: compressed.byteLength,
      restored_raw_sha256: sha256(raw),
      restored_raw_bytes: raw.byteLength,
      restore_status: 'passed',
    }
    await writeFile(recoveryDestination, `${JSON.stringify(recovery, null, 2)}\n`, 'utf8')
    results.push(recovery)
  }
  return results
}
