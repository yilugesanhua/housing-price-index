import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildDurableReadyState, candidateSourceEvidencePaths, validateCandidatePaths, validateCandidateRunId, verifyExistingSourceEvidence } from './candidate-persistence.mjs'
import { buildCandidateId, buildReleaseKey, validateStateIdentity } from './auto-update-state.mjs'

const valid = [
  'data/raw/2026-07/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.batch.json',
  'data/raw/2026-07/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html.gz',
  'data/releases/pending-auto-release.json',
  'data/releases/auto-update-state.json',
]

test('allows only raw source evidence and a pending state', () => {
  assert.deepEqual(validateCandidatePaths(valid, '2026-07'), [...valid].sort())
})

for (const path of ['scripts/data/publish.ts', '.github/workflows/ci.yml', 'apps/miniprogram/pages/home/index.js', 'package-lock.json', 'data/raw/2026-07/source.html', 'docs/screenshots/desktop-1440x900.png', 'data/audit-report.json', 'data/normalized/records.json', 'apps/web/public/data/manifest.json', 'apps/miniprogram/data/snapshot.js']) {
  test(`rejects non-generated candidate path ${path}`, () => {
    assert.throws(() => validateCandidatePaths([...valid, path], '2026-07'), /not allowlisted/)
  })
}

test('requires both compressed raw evidence files and durable state for the target month', () => {
  assert.throws(() => validateCandidatePaths(valid.filter((path) => !path.endsWith('.html.gz')), '2026-07'), /required generated artifacts/)
})

test('reuses already-persisted raw evidence only after verifying its exact identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'candidate-persistence-'))
  const month = '2026-07'
  const sourceRawSha256 = 'a'.repeat(64)
  const officialUrl = 'https://www.stats.gov.cn/sj/zxfb/202608/t20260817_1.html'
  const sourceBatchId = 'official-html-2026-07-aaaaaaaaaaaa'
  const [batchPath, archivePath] = candidateSourceEvidencePaths(month, sourceRawSha256)
  try {
    await mkdir(join(root, 'data/raw/2026-07'), { recursive: true })
    const html = Buffer.from('<html>official</html>')
    // The fixture's declared SHA must match the actual archive bytes.
    const actualSha = (await import('node:crypto')).createHash('sha256').update(html).digest('hex')
    const actualPaths = candidateSourceEvidencePaths(month, actualSha)
    await writeFile(join(root, actualPaths[0]), JSON.stringify({ source_batch: {
      stat_month: month, raw_content_sha256: actualSha, source_url: officialUrl, source_batch_id: sourceBatchId,
    } }) + '\n')
    await writeFile(join(root, actualPaths[1]), gzipSync(html))
    assert.deepEqual(await verifyExistingSourceEvidence(root, {
      expectedMonth: month, sourceRawSha256: actualSha, officialUrl, sourceBatchId,
    }), actualPaths)
    assert.deepEqual([batchPath, archivePath], [`data/raw/${month}/${sourceRawSha256}.batch.json`, `data/raw/${month}/${sourceRawSha256}.html.gz`])
    await assert.rejects(() => verifyExistingSourceEvidence(root, {
      expectedMonth: month, sourceRawSha256: actualSha, officialUrl: `${officialUrl}-tampered`, sourceBatchId,
    }), /source batch URL does not match/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('requires an immutable artifact run identifier for later recovery', () => {
  assert.equal(validateCandidateRunId(456), '456')
  for (const value of ['', ' 456', '456\n789', 'run-456', null]) {
    assert.throws(() => validateCandidateRunId(value), /candidate workflow run ID is invalid/)
  }
})

test('writes the durable state format separately from the pending release format', () => {
  const sourceRawSha256 = 'a'.repeat(64)
  const releaseKey = buildReleaseKey('2026-07', sourceRawSha256)
  const candidateCommitSha = 'b'.repeat(40)
  const candidateManifestSha256 = 'c'.repeat(64)
  const pending = {
    format: 'housing-data-pending-auto-release-v1',
    status: 'ready',
    dataset_as_of: '2026-07',
    source_raw_sha256: sourceRawSha256,
    release_key: releaseKey,
    producer_commit_sha: candidateCommitSha,
    candidate_commit_sha: candidateCommitSha,
    candidate_manifest_sha256: candidateManifestSha256,
    candidate_id: buildCandidateId({ releaseKey, commitSha: candidateCommitSha, candidateManifestSha256 }),
    time_seed: '2026-08-25T02:49:00.000Z',
    next_check_at: '2026-08-25T03:00:00.000Z',
    prepared_at: '2026-08-25T02:49:00.000Z',
  }
  const state = buildDurableReadyState(pending)
  assert.equal(state.format, 'housing-data-auto-update-state-v1')
  assert.equal(state.status, 'ready')
  assert.equal(state.time_seed, pending.time_seed)
  assert.equal(state.next_check_at, pending.next_check_at)
  assert.notEqual(state.format, pending.format)
  assert.doesNotThrow(() => validateStateIdentity(state))
})
