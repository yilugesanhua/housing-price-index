import { copyFile, glob, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { createTencentCloudClient } from './tencent-cloud-sdk.mjs'
import { byteLength, sha256 } from './remote-data-lib.mjs'
import { collectPrivateAuditSources } from './private-audit-sources.mjs'

const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const datasetVersion = argument('dataset')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const candidateRootInput = argument('candidate-root') ?? 'work/miniprogram-data'
const dryRun = process.argv.includes('--dry-run')
if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || '')) throw new Error('Use --dataset=<published-version>')
if (!/^cloud[\w-]+$/.test(cloudEnvId)) throw new Error('Invalid cloud environment ID')
if (!candidateRootInput || isAbsolute(candidateRootInput)) throw new Error('Candidate root must be a repository-relative path')
const candidateRoot = resolve(root, candidateRootInput)
const candidateRootRelative = relative(root, candidateRoot)
if (!candidateRootRelative || candidateRootRelative.startsWith('..') || isAbsolute(candidateRootRelative)) throw new Error('Candidate root must stay inside the repository')
const candidateDirectory = resolve(candidateRoot, datasetVersion)
const releaseManifest = JSON.parse(await readFile(resolve(candidateDirectory, 'manifest.json'), 'utf8'))
if (releaseManifest.dataset_version !== datasetVersion) throw new Error('Candidate manifest dataset version differs from private audit target')
let revisionManifest = null
let sourceBatchIds = releaseManifest.latest_source_batch_ids ?? releaseManifest.source_batch_ids
if (releaseManifest.release_type === 'historical_correction') {
  revisionManifest = JSON.parse(await readFile(resolve(candidateDirectory, 'revision-manifest.json'), 'utf8'))
  if (revisionManifest.revision_id !== releaseManifest.revision_id
    || JSON.stringify(revisionManifest.revision_source_batch_ids) !== JSON.stringify(releaseManifest.revision_source_batch_ids)
    || JSON.stringify(revisionManifest.latest_source_batch_ids) !== JSON.stringify(releaseManifest.latest_source_batch_ids)) {
    throw new Error('Correction revision manifest source identity differs from the release manifest')
  }
  sourceBatchIds = revisionManifest.revision_source_batch_ids
}
if (!Array.isArray(sourceBatchIds) || sourceBatchIds.length === 0) throw new Error('Candidate has no exact source batch set for private audit')
const outputRoot = resolve(root, 'work/private-audit', datasetVersion)
await rm(outputRoot, { recursive: true, force: true })
await mkdir(resolve(outputRoot, 'source'), { recursive: true })
await mkdir(resolve(outputRoot, 'reports'), { recursive: true })

const requiredCopies = [
  [resolve(root, 'work/auto-release/gate-report.json'), resolve(outputRoot, 'reports/production-gate.json')],
  [resolve(root, 'work/auto-release/discovery-gate.json'), resolve(outputRoot, 'reports/discovery-gate.json')],
  [resolve(root, 'work/monthly-data-check/release-calendar.json'), resolve(outputRoot, 'reports/release-calendar.json')],
  [resolve(root, 'data/releases', `${datasetVersion}.json`), resolve(outputRoot, 'reports/publish-audit.json')],
  [resolve(candidateDirectory, 'release-report.json'), resolve(outputRoot, 'reports/release-report.json')],
]
if (revisionManifest) requiredCopies.push([resolve(candidateDirectory, 'revision-manifest.json'), resolve(outputRoot, 'reports/revision-manifest.json')])
for (const [source, destination] of requiredCopies) await copyFile(source, destination)

const sourceEvidence = await collectPrivateAuditSources({ root, outputRoot, sourceBatchIds })

const files = []
for await (const path of await glob('**/*', { cwd: outputRoot })) {
  const absolute = resolve(outputRoot, path)
  try {
    const content = await readFile(absolute)
    files.push({ path: path.replaceAll('\\', '/'), sha256: sha256(content), bytes: content.byteLength })
  } catch (_) {}
}
files.sort((a, b) => a.path.localeCompare(b.path))
const publishAudit = JSON.parse(await readFile(resolve(root, 'data/releases', `${datasetVersion}.json`), 'utf8'))
const manifest = {
  format: 'housing-data-private-audit-v1',
  dataset_version: datasetVersion,
  release_type: releaseManifest.release_type || 'monthly_update',
  revision_id: revisionManifest?.revision_id ?? null,
  source_batch_ids: sourceBatchIds,
  source_evidence: sourceEvidence.map((item) => ({
    source_batch_id: item.source_batch_id,
    source_url: item.source_url,
    raw_content_sha256: item.raw_content_sha256,
    restored_raw_sha256: item.restored_raw_sha256,
    restore_status: item.restore_status,
  })),
  cloud_env_id: cloudEnvId,
  github_run_id: process.env.GITHUB_RUN_ID || null,
  commit_sha: process.env.CI_COMMIT_SHA || null,
  created_at: publishAudit.published_at,
  files,
  total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
}
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
const manifestPath = resolve(outputRoot, 'audit-manifest.json')
await writeFile(manifestPath, manifestText, 'utf8')
const referencePath = resolve(root, 'work/auto-release/private-audit-reference.json')
async function writePublicReference(status) {
  await mkdir(dirname(referencePath), { recursive: true })
  const reference = {
    format: 'housing-data-private-audit-reference-v1',
    status,
    dataset_version: datasetVersion,
    cloud_env_id: cloudEnvId,
    github_run_id: process.env.GITHUB_RUN_ID || null,
    commit_sha: process.env.CI_COMMIT_SHA || null,
    private_manifest_sha256: sha256(manifestText),
    evidence_file_count: files.length,
    total_bytes: manifest.total_bytes,
    recorded_at: publishAudit.published_at,
  }
  await writeFile(referencePath, `${JSON.stringify(reference, null, 2)}\n`, 'utf8')
}
if (dryRun) {
  await writePublicReference('staged_private_only')
  console.log(`Staged private audit ${datasetVersion}: ${files.length} evidence files, ${byteLength(manifestText) + manifest.total_bytes} bytes`)
  process.exit(0)
}
if (releaseManifest.release_type === 'historical_correction' && (!process.env.CI_CORRECTION_REQUEST_SHA256 || !process.env.CI_GATE_REPORT_SHA256)) {
  throw new Error('Historical correction private audit requires the attested correction request and gate identities')
}
const cloudRoot = `housing-data-audit/releases/${datasetVersion}`
const cloud = createTencentCloudClient({ cloudEnvId })
const existing = await cloud.objectExists(`${cloudRoot}/audit-manifest.json`)
if (existing) {
  const roundTrip = resolve(outputRoot, 'existing-audit-manifest.json')
  await cloud.downloadObject(`${cloudRoot}/audit-manifest.json`, roundTrip)
  const existingManifest = JSON.parse(await readFile(roundTrip, 'utf8'))
  if (existingManifest.format !== 'housing-data-private-audit-v1' || existingManifest.dataset_version !== datasetVersion || existingManifest.cloud_env_id !== cloudEnvId || !Array.isArray(existingManifest.files)) throw new Error('Existing private audit manifest is invalid')
  if (existingManifest.release_type !== manifest.release_type || existingManifest.revision_id !== manifest.revision_id || JSON.stringify(existingManifest.source_batch_ids) !== JSON.stringify(sourceBatchIds)) throw new Error('Existing private audit source identity differs from the candidate')
  const existingPaths = new Set(existingManifest.files.map((file) => file.path))
  for (const required of ['reports/production-gate.json', 'reports/publish-audit.json', 'reports/release-report.json']) if (!existingPaths.has(required)) throw new Error(`Existing private audit is missing ${required}`)
  for (const batchId of sourceBatchIds) {
    for (const suffix of ['.batch.json', '.html.gz', '.recovery.json']) {
      if (!existingPaths.has(`source/${batchId}${suffix}`)) throw new Error(`Existing private audit is missing source evidence for ${batchId}`)
    }
  }
  const verifyRoot = resolve(outputRoot, 'existing-audit-verify')
  for (const file of existingManifest.files) {
    if (!/^[a-zA-Z0-9._/-]+$/.test(file.path || '') || file.path.includes('..') || !/^[a-f0-9]{64}$/.test(file.sha256 || '') || !Number.isInteger(file.bytes)) throw new Error('Existing private audit contains unsafe file metadata')
    const destination = resolve(verifyRoot, file.path)
    await mkdir(dirname(destination), { recursive: true })
    await cloud.downloadObject(`${cloudRoot}/${file.path}`, destination)
    const content = await readFile(destination)
    if (content.byteLength !== file.bytes || sha256(content) !== file.sha256) throw new Error(`Existing private audit file verification failed: ${file.path}`)
  }
  await writePublicReference('verified_existing_private_copy')
  console.log(`Private audit ${datasetVersion} already exists and all ${existingManifest.files.length} files passed verification`)
  process.exit(0)
}
await cloud.uploadDirectory(outputRoot, cloudRoot)
const roundTrip = resolve(outputRoot, 'audit-manifest.roundtrip.json')
await cloud.downloadObject(`${cloudRoot}/audit-manifest.json`, roundTrip)
if (sha256(await readFile(roundTrip)) !== sha256(manifestText)) throw new Error('Private audit manifest round-trip verification failed')
await writePublicReference('published_private_copy')
console.log(`Published private audit ${datasetVersion}: ${files.length} evidence files, ${byteLength(manifestText) + manifest.total_bytes} bytes`)
