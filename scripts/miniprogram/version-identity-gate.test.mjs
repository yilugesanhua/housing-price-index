import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertClientChangeHasVersionBump, validateCandidateIdentity, validateCurrentSnapshotText, validateVersionIdentity } from './version-identity-gate.mjs'

const sourceVersion = 'v2.5.25'
const sourceCommit = 'a'.repeat(40)
const archiveSha = 'b'.repeat(64)

function currentDocuments(version = sourceVersion) {
  return {
    'docs/DOCUMENT_INDEX.md': `截至本次整理其值为 \`${version}\`。\n当前 \`${version}\` 是包含月度严格只读发现器\n`,
    'docs/IMPLEMENTATION_STATUS.md': `唯一源码版本为 \`${version}\`。\n`,
  }
}

function candidate(version = sourceVersion) {
  return {
    schema_version: 1,
    app_version: version,
    source_commit_sha: sourceCommit,
    archive_sha256: archiveSha,
    candidate_manifest_sha256: 'c'.repeat(64),
    candidate_id: `${version}+${sourceCommit}+${archiveSha}`,
    archive_file: `小程序源码-${version}.zip`,
  }
}

test('current documentation snapshots and candidate identities must match version.js', () => {
  validateCurrentSnapshotText({ sourceVersion, documents: currentDocuments() })
  validateCandidateIdentity({ candidate: candidate(), sourceVersion })
  assert.throws(() => validateCurrentSnapshotText({ sourceVersion, documents: currentDocuments('v2.5.24') }), /differs from apps\/miniprogram\/config\/version\.js/)
  assert.throws(() => validateCandidateIdentity({ candidate: candidate('v2.5.24'), sourceVersion }), /app_version differs/)
})

test('stable archive names and release identity cannot drift from the candidate version', () => {
  const item = candidate()
  const release = {
    schema_version: 1,
    app_version: sourceVersion,
    candidate_id: item.candidate_id,
    candidate_manifest_sha256: item.candidate_manifest_sha256,
    source_commit_sha: item.source_commit_sha,
    archive_file: item.archive_file,
    archive_sha256: item.archive_sha256,
  }
  validateCandidateIdentity({ candidate: item, sourceVersion, releaseManifest: release, directoryName: 'v2.5.25_2026-08-30' })
  assert.throws(() => validateCandidateIdentity({ candidate: item, sourceVersion, releaseManifest: release, directoryName: 'v2.5.24_2026-08-30' }), /directory does not start/)
  assert.throws(() => validateCandidateIdentity({ candidate: item, sourceVersion, releaseManifest: { ...release, archive_file: '小程序源码-v2.5.24.zip' }, directoryName: 'v2.5.25_2026-08-30' }), /release manifest differs/)
})

test('client source changes require a semantic version increase', () => {
  assert.doesNotThrow(() => assertClientChangeHasVersionBump({
    baseVersion: 'v2.5.24', sourceVersion, changedPaths: ['apps/miniprogram/pages/index/index.js', 'apps/miniprogram/config/version.js'],
  }))
  assert.throws(() => assertClientChangeHasVersionBump({
    baseVersion: sourceVersion, sourceVersion, changedPaths: ['apps/miniprogram/pages/index/index.js'],
  }), /without a version increase/)
})

test('the repository current snapshots pass the executable version identity gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'version-identity-'))
  await Promise.all([
    mkdir(join(root, 'apps/miniprogram/config'), { recursive: true }),
    mkdir(join(root, 'docs'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(root, 'apps/miniprogram/config/version.js'), "module.exports = { version: 'v2.5.25' }\n"),
    writeFile(join(root, 'docs/DOCUMENT_INDEX.md'), currentDocuments()['docs/DOCUMENT_INDEX.md']),
    writeFile(join(root, 'docs/IMPLEMENTATION_STATUS.md'), currentDocuments()['docs/IMPLEMENTATION_STATUS.md']),
  ])
  assert.deepEqual(await validateVersionIdentity({ root }), { source_version: sourceVersion, candidate_checked: false, base_checked: false })
})
