import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildCandidateManifest, compareDevtools, createDeterministicZip, inventoryDigest, normalizeArchiveEntries, readZipInventory, assertCandidatePaths } from './deterministic-candidate.mjs'

const files = [
  { path: 'pages/index.js', data: Buffer.from('console.log("index")\n') },
  { path: '配置/数据.json', data: Buffer.from('{"ok":true}\n') },
  { path: 'assets/empty.txt', data: Buffer.alloc(0) },
]

test('same entries and timestamp produce byte-identical ZIPs', () => {
  const a = createDeterministicZip(files, { timestamp: '2026-08-03T01:02:03.000Z' })
  const b = createDeterministicZip([...files].reverse(), { timestamp: '2026-08-03T01:02:03.000Z' })
  assert.deepEqual(a, b)
  const inventory = readZipInventory(a)
  assert.equal(inventory.length, 3)
  assert.equal(inventoryDigest(inventory), inventoryDigest(readZipInventory(b)))
})

test('candidate manifest is stable when it uses the source commit time', () => {
  const input = {
    appVersion: 'v2.4.2',
    sourceCommitSha: 'a'.repeat(40),
    sourceCommitTime: '2026-08-03T01:02:03.000Z',
    archiveFile: '小程序源码-v2.4.2.zip',
    archiveSha256: 'b'.repeat(64),
    archiveInventorySha256: 'c'.repeat(64),
    snapshot: { datasetAsOf: '2026-06', datasetVersion: '2026-06-example', rawText: '{"records":[]}' },
    parserVersion: 'parser-test',
    auditVersion: 'audit-test',
    createdAt: '2026-08-03T01:02:03.000Z',
  }
  assert.deepEqual(buildCandidateManifest(input), buildCandidateManifest(input))
})

test('excluded files do not enter the archive', () => {
  const entries = normalizeArchiveEntries([
    ...files,
    { path: 'node_modules/unsafe.js', data: Buffer.from('secret') },
    { path: 'project.private.config.json', data: Buffer.from('{}') },
    { path: 'screenshots/debug.png', data: Buffer.from('debug') },
  ])
  assert.deepEqual(entries.map((entry) => entry.path), ['assets/empty.txt', 'pages/index.js', '配置/数据.json'])
})

test('rejects duplicate or unsafe paths', () => {
  assert.throws(() => normalizeArchiveEntries([{ path: 'a.js', data: Buffer.from('a') }, { path: 'a.js', data: Buffer.from('b') }]), /duplicate archive path/)
  assert.throws(() => normalizeArchiveEntries([{ path: '../secret', data: Buffer.from('x') }]), /invalid archive path/)
})

test('rejects candidate source files outside the explicit mini-program whitelist', () => {
  assert.throws(() => assertCandidatePaths([{ path: 'debug/output.txt', data: Buffer.from('x') }]), /source whitelist/)
  assert.doesNotThrow(() => assertCandidatePaths([
    { path: 'app.js', data: Buffer.from('') },
    { path: 'pages/index/index.js', data: Buffer.from('') },
  ]))
})

test('developer tools comparison allows only declared local extras', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'candidate-devtools-'))
  try {
    await mkdir(join(directory, 'pages'), { recursive: true })
    await Promise.all([
      writeFile(join(directory, 'pages/index.js'), 'console.log("index")\n'),
      writeFile(join(directory, 'project.private.config.json'), '{}\n'),
      writeFile(join(directory, 'package-lock.json'), '{}\n'),
    ])
    await compareDevtools(directory, [{ path: 'pages/index.js', data: Buffer.from('console.log("index")\n') }], '.')
    await writeFile(join(directory, 'stale.js'), 'stale\n')
    await assert.rejects(() => compareDevtools(directory, [{ path: 'pages/index.js', data: Buffer.from('console.log("index")\n') }], '.'), /unexpected files: stale\.js/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects a damaged ZIP and verifies entry checksums', () => {
  const zip = createDeterministicZip(files, { timestamp: '2026-08-03T01:02:03.000Z' })
  const damaged = zip.subarray(0, zip.length - 1)
  assert.throws(() => readZipInventory(damaged), /ZIP end record is missing|ZIP central directory/)
  const payloadCorrupted = Buffer.from(zip)
  const centralOffset = zip.readUInt32LE(zip.length - 22 + 16)
  payloadCorrupted[centralOffset + 16] ^= 0xff
  assert.throws(() => readZipInventory(payloadCorrupted), /checksum mismatch|invalid|truncated/)
})

test('temporary directory support is available for CLI integration tests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'candidate-'))
  await rm(directory, { recursive: true, force: true })
})
