import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildCandidateManifest, createDeterministicZip, inventoryDigest, readZipInventory, sha256 } from './deterministic-candidate.mjs'
import { canonicalJson, evidenceIndexDigest, promoteStableCandidate, readAndValidateCandidate, readAndValidateStableArchive } from './promote-stable-candidate.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'housing-stable-candidate-'))
  const candidateDir = join(root, 'candidate')
  const outputDir = join(root, 'stable')
  const archiveFile = '小程序源码-v2.5.25.zip'
  const archive = createDeterministicZip([
    { path: 'app.js', data: Buffer.from('App({})\n') },
    { path: 'config/version.js', data: Buffer.from("module.exports = { version: 'v2.5.25' }\n") },
  ], { timestamp: '2026-08-30T00:00:00.000Z' })
  const candidate = buildCandidateManifest({
    appVersion: 'v2.5.25',
    sourceCommitSha: 'a'.repeat(40),
    sourceCommitTime: '2026-08-30T00:00:00.000Z',
    archiveFile,
    archiveSha256: sha256(archive),
    archiveInventorySha256: inventoryDigest(readZipInventory(archive)),
    snapshot: { datasetAsOf: '2026-06', datasetVersion: '2026-06-f80465ae29a5', rawText: 'module.exports={}' },
    parserVersion: 'parser-v1',
    auditVersion: 'full-record-audit-v7',
  })
  await mkdir(candidateDir, { recursive: true })
  await writeFile(join(candidateDir, archiveFile), archive)
  await writeFile(join(candidateDir, 'candidate-manifest.json'), canonicalJson(candidate))
  await writeFile(join(candidateDir, 'SHA256.txt'), `${archiveFile}  ${candidate.archive_sha256}\n`)
  const entries = ['ordinary_ci', 'devtools', 'android_device', 'iphone_device', 'wechat_platform', 'online_readback'].map((id) => ({
    id, status: 'passed', identity: `${id}-identity`, source: `evidence://${id}`, checked_at: '2026-08-30T00:00:00.000Z',
    ...(id === 'ordinary_ci' ? {
      provider: 'github-actions', workflow: 'ci.yml', run_id: '123', run_url: 'https://github.com/example/repo/actions/runs/123', tested_commit_sha: 'a'.repeat(40),
    } : {}),
    ...(id === 'devtools' ? {
      version: '2.01.2510290', base_library_version: '3.17.0', compile_evidence_sha256: 'b'.repeat(64),
    } : {}),
    ...(['android_device', 'iphone_device', 'wechat_platform', 'online_readback'].includes(id) ? { evidence_sha256: 'c'.repeat(64) } : {}),
  }))
  const evidence = {
    schema_version: 1,
    candidate_id: candidate.candidate_id,
    candidate_manifest_sha256: candidate.candidate_manifest_sha256,
    source_commit_sha: candidate.source_commit_sha,
    evidence_index_sha256: '',
    entries,
  }
  evidence.evidence_index_sha256 = evidenceIndexDigest(evidence)
  const evidencePath = join(root, 'evidence.json')
  await writeFile(evidencePath, canonicalJson(evidence))
  return { candidateDir, evidencePath, outputDir, archive, archiveFile, evidence }
}

test('promotes the exact verified candidate bytes only after every required evidence entry passes', async () => {
  const input = await fixture()
  const result = await promoteStableCandidate({ ...input, promotedAt: '2026-08-30T00:00:00.000Z' })
  assert.equal(result.app_version, 'v2.5.25')
  assert.deepEqual(await readFile(join(input.outputDir, input.archiveFile)), input.archive)
  const release = JSON.parse(await readFile(join(input.outputDir, 'release-manifest.json'), 'utf8'))
  assert.equal(release.candidate_manifest_sha256, (await readAndValidateCandidate(input.candidateDir)).candidate.candidate_manifest_sha256)
  assert.equal(release.evidence_index_sha256, input.evidence.evidence_index_sha256)
  assert.equal(release.ci.tested_commit_sha, 'a'.repeat(40))
  assert.match(await readFile(join(input.outputDir, '版本说明.txt'), 'utf8'), /版本：v2\.5\.25/)
  await readAndValidateStableArchive(input.outputDir)
})

test('rejects incomplete external evidence and altered candidate bytes', async () => {
  const input = await fixture()
  input.evidence.entries.pop()
  input.evidence.evidence_index_sha256 = evidenceIndexDigest(input.evidence)
  await writeFile(input.evidencePath, canonicalJson(input.evidence))
  await assert.rejects(promoteStableCandidate({ ...input, promotedAt: '2026-08-30T00:00:00.000Z' }), /release evidence is missing/)
  const second = await fixture()
  await writeFile(join(second.candidateDir, second.archiveFile), Buffer.from('changed'))
  await assert.rejects(readAndValidateCandidate(second.candidateDir), /candidate archive bytes do not match/)
})

test('rejects candidate evidence for another commit and cleans up a failed atomic promotion', async () => {
  const input = await fixture()
  input.evidence.entries.find((entry) => entry.id === 'ordinary_ci').tested_commit_sha = 'd'.repeat(40)
  input.evidence.evidence_index_sha256 = evidenceIndexDigest(input.evidence)
  await writeFile(input.evidencePath, canonicalJson(input.evidence))
  await assert.rejects(promoteStableCandidate({ ...input, promotedAt: '2026-08-30T00:00:00.000Z' }), /ordinary_ci evidence belongs to another commit/)
  await assert.rejects(access(input.outputDir))
})
