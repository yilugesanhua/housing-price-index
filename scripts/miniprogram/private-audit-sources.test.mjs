import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { sha256 } from './remote-data-lib.mjs'
import { collectPrivateAuditSources } from './private-audit-sources.mjs'

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'housing-private-audit-'))
  const outputRoot = resolve(root, 'output')
  const batchId = 'official-html-2026-06-aaaaaaaaaaaa'
  const raw = Buffer.from('<html>official source</html>', 'utf8')
  const rawSha = sha256(raw)
  const rawRoot = resolve(root, 'data/raw/2026-06')
  await mkdir(rawRoot, { recursive: true })
  await writeFile(resolve(rawRoot, `${rawSha}.html.gz`), gzipSync(raw))
  await writeFile(resolve(rawRoot, `${rawSha}.batch.json`), `${JSON.stringify({
    source_batch: {
      source_batch_id: batchId, source_url: 'https://www.stats.gov.cn/sj/zxfb/example.html',
      final_url: 'https://www.stats.gov.cn/sj/zxfb/example.html', stat_month: '2026-06',
      raw_content_sha256: rawSha, raw_archive_uri: `data/raw/2026-06/${rawSha}.html`,
    },
  }, null, 2)}\n`, 'utf8')
  return { root, outputRoot, batchId, rawSha }
}

test('private audit collects every requested source batch and verifies restored official bytes', async () => {
  const item = await fixture()
  try {
    const evidence = await collectPrivateAuditSources({ root: item.root, outputRoot: item.outputRoot, sourceBatchIds: [item.batchId] })
    assert.equal(evidence.length, 1)
    assert.equal(evidence[0].restored_raw_sha256, item.rawSha)
    const recovery = JSON.parse(await readFile(resolve(item.outputRoot, `source/${item.batchId}.recovery.json`), 'utf8'))
    assert.equal(recovery.restore_status, 'passed')
  } finally {
    await rm(item.root, { recursive: true, force: true })
  }
})

test('private audit refuses a missing, extra, or corrupt source archive', async () => {
  const item = await fixture()
  try {
    await assert.rejects(collectPrivateAuditSources({ root: item.root, outputRoot: item.outputRoot, sourceBatchIds: ['official-html-2026-06-bbbbbbbbbbbb'] }), /expected exactly one/)
    await assert.rejects(collectPrivateAuditSources({ root: item.root, outputRoot: item.outputRoot, sourceBatchIds: [item.batchId, item.batchId] }), /sorted and unique/)
    await writeFile(resolve(item.root, `data/raw/2026-06/${item.rawSha}.html.gz`), 'corrupt')
    await assert.rejects(collectPrivateAuditSources({ root: item.root, outputRoot: item.outputRoot, sourceBatchIds: [item.batchId] }), /cannot be restored/)
  } finally {
    await rm(item.root, { recursive: true, force: true })
  }
})
