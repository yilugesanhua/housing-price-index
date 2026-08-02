import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createDeterministicZip, inventoryDigest, normalizeArchiveEntries, readZipInventory } from './deterministic-candidate.mjs'

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
  const directory = await mkdtemp(`${tmpdir()}\\candidate-`)
  await rm(directory, { recursive: true, force: true })
})
