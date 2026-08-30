import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { inventoryDigest, readZipInventory, sha256 } from './deterministic-candidate.mjs'

const SHA256 = /^[a-f0-9]{64}$/
const COMMIT_SHA = /^[a-f0-9]{40}$/
const APP_VERSION = /^v\d+\.\d+\.\d+$/
const REQUIRED_EVIDENCE = Object.freeze([
  'ordinary_ci',
  'devtools',
  'android_device',
  'iphone_device',
  'wechat_platform',
  'online_readback',
])

function fail(message) {
  throw new Error(`Stable candidate promotion rejected: ${message}`)
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function assertIsoTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${label} must be a canonical ISO timestamp`)
  }
}

function assertText(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} is required`)
}

function assertHttpsUrl(value, label) {
  assertText(value, label)
  try {
    if (new URL(value).protocol !== 'https:') throw new Error('not HTTPS')
  } catch {
    fail(`${label} must be an HTTPS URL`)
  }
}

function assertSha256(value, label) {
  if (!SHA256.test(value || '')) fail(`${label} must be a lowercase SHA-256`)
}

function candidateManifestDigest(manifest) {
  const copy = { ...manifest, candidate_manifest_sha256: '' }
  return sha256(Buffer.from(canonicalJson(copy), 'utf8'))
}

export function evidenceIndexDigest(evidence) {
  const entries = [...evidence.entries].map((entry) => ({ ...entry })).sort((left, right) => left.id.localeCompare(right.id))
  return sha256(Buffer.from(canonicalJson({
    candidate_id: evidence.candidate_id,
    candidate_manifest_sha256: evidence.candidate_manifest_sha256,
    source_commit_sha: evidence.source_commit_sha,
    entries,
  }), 'utf8'))
}

export function validateReleaseEvidence(evidence, candidate) {
  if (!evidence || evidence.schema_version !== 1 || !Array.isArray(evidence.entries)) fail('release evidence format is invalid')
  if (evidence.candidate_id !== candidate.candidate_id || evidence.candidate_manifest_sha256 !== candidate.candidate_manifest_sha256) {
    fail('release evidence does not bind the candidate identity')
  }
  if (evidence.source_commit_sha !== candidate.source_commit_sha) fail('release evidence source commit does not match the candidate')
  if (!SHA256.test(evidence.evidence_index_sha256 || '') || evidence.evidence_index_sha256 !== evidenceIndexDigest(evidence)) {
    fail('release evidence index hash is invalid')
  }
  const byId = new Map()
  for (const entry of evidence.entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^[a-z0-9_]+$/.test(entry.id)) fail('release evidence entry ID is invalid')
    if (byId.has(entry.id)) fail(`release evidence entry is duplicated: ${entry.id}`)
    if (entry.status !== 'passed') fail(`release evidence is not passed: ${entry.id}`)
    assertText(entry.identity, `release evidence identity for ${entry.id}`)
    assertText(entry.source, `release evidence source for ${entry.id}`)
    assertIsoTimestamp(entry.checked_at, `release evidence checked_at for ${entry.id}`)
    if (entry.id === 'ordinary_ci') {
      if (entry.provider !== 'github-actions' || entry.workflow !== 'ci.yml' || !/^\d+$/.test(String(entry.run_id || ''))) {
        fail('ordinary_ci evidence is incomplete')
      }
      assertHttpsUrl(entry.run_url, 'ordinary_ci run_url')
      if (entry.tested_commit_sha !== candidate.source_commit_sha) fail('ordinary_ci evidence belongs to another commit')
    }
    if (entry.id === 'devtools') {
      assertText(entry.version, 'devtools version')
      assertText(entry.base_library_version, 'devtools base_library_version')
      assertSha256(entry.compile_evidence_sha256, 'devtools compile_evidence_sha256')
    }
    if (['android_device', 'iphone_device', 'wechat_platform', 'online_readback'].includes(entry.id)) {
      assertSha256(entry.evidence_sha256, `${entry.id} evidence_sha256`)
    }
    byId.set(entry.id, entry)
  }
  for (const id of REQUIRED_EVIDENCE) if (!byId.has(id)) fail(`release evidence is missing: ${id}`)
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export async function readAndValidateCandidate(candidateDir) {
  const manifestPath = resolve(candidateDir, 'candidate-manifest.json')
  let candidate
  try {
    candidate = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    fail(`cannot read candidate manifest: ${error.message}`)
  }
  if (!candidate || candidate.schema_version !== 1 || !APP_VERSION.test(candidate.app_version || '') || !COMMIT_SHA.test(candidate.source_commit_sha || '')) {
    fail('candidate manifest identity is invalid')
  }
  if (!SHA256.test(candidate.candidate_manifest_sha256 || '') || candidate.candidate_manifest_sha256 !== candidateManifestDigest(candidate)) {
    fail('candidate manifest hash is invalid')
  }
  if (candidate.candidate_id !== `${candidate.app_version}+${candidate.source_commit_sha}+${candidate.archive_sha256}`) fail('candidate ID is invalid')
  if (typeof candidate.archive_file !== 'string' || candidate.archive_file !== basename(candidate.archive_file) || !candidate.archive_file.endsWith('.zip')) {
    fail('candidate archive file is invalid')
  }
  if (!SHA256.test(candidate.archive_sha256 || '') || !SHA256.test(candidate.archive_inventory_sha256 || '')) fail('candidate archive identity is invalid')
  assertIsoTimestamp(candidate.source_commit_time, 'candidate source_commit_time')
  const archivePath = resolve(candidateDir, candidate.archive_file)
  let archive
  try {
    archive = await readFile(archivePath)
  } catch (error) {
    fail(`cannot read candidate archive: ${error.message}`)
  }
  if (sha256(archive) !== candidate.archive_sha256) fail('candidate archive bytes do not match the manifest')
  const inventory = readZipInventory(archive)
  if (inventoryDigest(inventory) !== candidate.archive_inventory_sha256) fail('candidate archive inventory does not match the manifest')
  const versionEntry = inventory.find((entry) => entry.path === 'config/version.js')
  if (!versionEntry) fail('candidate archive is missing config/version.js')
  const archiveVersion = versionEntry.data.toString('utf8').match(/version:\s*['"](v\d+\.\d+\.\d+)['"]/u)?.[1]
  if (archiveVersion !== candidate.app_version) fail('candidate archive version differs from the candidate manifest')
  const checksum = await readFile(resolve(candidateDir, 'SHA256.txt'), 'utf8').catch(() => '')
  if (checksum !== `${candidate.archive_file}  ${candidate.archive_sha256}\n`) fail('candidate SHA256.txt does not match the manifest')
  return { candidate, archive, archivePath }
}

function releaseManifestDigest(manifest) {
  return sha256(Buffer.from(canonicalJson({ ...manifest, release_manifest_sha256: '' }), 'utf8'))
}

export function buildReleaseManifest({ candidate, evidence, promotedAt }) {
  assertIsoTimestamp(promotedAt, 'created_at')
  const entries = validateReleaseEvidence(evidence, candidate)
  const ordinaryCi = entries.find((entry) => entry.id === 'ordinary_ci')
  const devtools = entries.find((entry) => entry.id === 'devtools')
  const manifest = {
    schema_version: 1,
    release_manifest_sha256: '',
    app_version: candidate.app_version,
    candidate_id: candidate.candidate_id,
    candidate_manifest_sha256: candidate.candidate_manifest_sha256,
    source_commit_sha: candidate.source_commit_sha,
    source_commit_time: candidate.source_commit_time,
    dataset_as_of: candidate.dataset_as_of,
    source_dataset_version: candidate.source_dataset_version,
    bundled_snapshot_sha256: candidate.bundled_snapshot_sha256,
    parser_version: candidate.parser_version,
    audit_version: candidate.audit_version,
    archive_file: candidate.archive_file,
    archive_sha256: candidate.archive_sha256,
    archive_inventory_sha256: candidate.archive_inventory_sha256,
    evidence_index_sha256: evidence.evidence_index_sha256,
    ci: {
      provider: ordinaryCi.provider,
      workflow: ordinaryCi.workflow,
      run_id: String(ordinaryCi.run_id),
      run_url: ordinaryCi.run_url,
      tested_commit_sha: ordinaryCi.tested_commit_sha,
      result: ordinaryCi.status,
    },
    devtools: {
      version: devtools.version,
      base_library_version: devtools.base_library_version,
      compile_evidence_sha256: devtools.compile_evidence_sha256,
    },
    created_at: promotedAt,
  }
  manifest.release_manifest_sha256 = releaseManifestDigest(manifest)
  return manifest
}

function buildVersionNotes({ candidate, releaseManifest }) {
  return [
    `版本：${candidate.app_version}`,
    `候选身份：${candidate.candidate_id}`,
    `源码提交：${candidate.source_commit_sha}`,
    `数据截至：${candidate.dataset_as_of}`,
    `源数据版本：${candidate.source_dataset_version}`,
    `源码包：${candidate.archive_file}`,
    `源码包SHA-256：${candidate.archive_sha256}`,
    `CI：${releaseManifest.ci.workflow} #${releaseManifest.ci.run_id}（${releaseManifest.ci.result}）`,
    `微信开发者工具：${releaseManifest.devtools.version}；基础库 ${releaseManifest.devtools.base_library_version}`,
    `归档时间：${releaseManifest.created_at}`,
    '',
  ].join('\n')
}

export async function readAndValidateStableArchive(outputDir) {
  const { candidate, archive } = await readAndValidateCandidate(outputDir)
  let evidence
  let releaseManifest
  try {
    evidence = JSON.parse(await readFile(resolve(outputDir, 'evidence-index.json'), 'utf8'))
    releaseManifest = JSON.parse(await readFile(resolve(outputDir, 'release-manifest.json'), 'utf8'))
  } catch (error) {
    fail(`cannot read stable archive identity files: ${error.message}`)
  }
  validateReleaseEvidence(evidence, candidate)
  if (!releaseManifest || releaseManifest.schema_version !== 1 || releaseManifest.release_manifest_sha256 !== releaseManifestDigest(releaseManifest)) {
    fail('release manifest hash is invalid')
  }
  const identityFields = [
    'app_version', 'candidate_id', 'candidate_manifest_sha256', 'source_commit_sha', 'source_commit_time',
    'dataset_as_of', 'source_dataset_version', 'bundled_snapshot_sha256', 'parser_version', 'audit_version',
    'archive_file', 'archive_sha256', 'archive_inventory_sha256',
  ]
  for (const field of identityFields) if (releaseManifest[field] !== candidate[field]) fail(`release manifest differs from candidate field ${field}`)
  if (releaseManifest.evidence_index_sha256 !== evidence.evidence_index_sha256) fail('release manifest evidence index differs from evidence')
  if (releaseManifest.ci?.tested_commit_sha !== candidate.source_commit_sha || releaseManifest.ci?.result !== 'passed') fail('release manifest CI identity is invalid')
  if (!releaseManifest.devtools?.version || !releaseManifest.devtools?.base_library_version || !SHA256.test(releaseManifest.devtools?.compile_evidence_sha256 || '')) {
    fail('release manifest developer tools identity is invalid')
  }
  assertIsoTimestamp(releaseManifest.created_at, 'release manifest created_at')
  const notes = await readFile(resolve(outputDir, '版本说明.txt'), 'utf8').catch((error) => fail(`cannot read version notes: ${error.message}`))
  if (notes !== buildVersionNotes({ candidate, releaseManifest })) fail('version notes differ from the release manifest')
  const checksum = await readFile(resolve(outputDir, 'SHA256.txt'), 'utf8').catch(() => '')
  if (checksum !== `${candidate.archive_file}  ${sha256(archive)}\n`) fail('stable archive SHA256.txt is invalid')
  return { candidate, evidence, releaseManifest }
}

export async function promoteStableCandidate({ candidateDir, evidencePath, outputDir, promotedAt = new Date().toISOString() }) {
  if (!candidateDir || !evidencePath || !outputDir) fail('candidateDir, evidencePath, and outputDir are required')
  const { candidate, archive } = await readAndValidateCandidate(candidateDir)
  let evidence
  try {
    evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
  } catch (error) {
    fail(`cannot read release evidence: ${error.message}`)
  }
  const entries = validateReleaseEvidence(evidence, candidate)
  try {
    await stat(outputDir)
    fail(`stable archive already exists: ${outputDir}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const normalizedEvidence = { ...evidence, entries }
  const releaseManifest = buildReleaseManifest({ candidate, evidence: normalizedEvidence, promotedAt })
  await mkdir(dirname(outputDir), { recursive: true })
  const temporaryDir = await mkdtemp(resolve(dirname(outputDir), `.${basename(outputDir)}.tmp-`))
  try {
    await Promise.all([
      writeFile(resolve(temporaryDir, candidate.archive_file), archive),
      writeFile(resolve(temporaryDir, 'candidate-manifest.json'), canonicalJson(candidate)),
      writeFile(resolve(temporaryDir, 'evidence-index.json'), canonicalJson(normalizedEvidence)),
      writeFile(resolve(temporaryDir, 'release-manifest.json'), canonicalJson(releaseManifest)),
      writeFile(resolve(temporaryDir, '版本说明.txt'), buildVersionNotes({ candidate, releaseManifest }), 'utf8'),
      writeFile(resolve(temporaryDir, 'SHA256.txt'), `${candidate.archive_file}  ${candidate.archive_sha256}\n`, 'utf8'),
    ])
    await readAndValidateStableArchive(temporaryDir)
    await rename(temporaryDir, outputDir)
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true })
    throw error
  }
  await readAndValidateStableArchive(outputDir)
  return { output_dir: outputDir, app_version: candidate.app_version, release_manifest_sha256: releaseManifest.release_manifest_sha256 }
}

function argument(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}

if (process.argv[1]?.endsWith('promote-stable-candidate.mjs')) {
  const result = await promoteStableCandidate({
    candidateDir: argument('candidate'),
    evidencePath: argument('evidence'),
    outputDir: argument('output'),
    promotedAt: argument('promoted-at') || new Date().toISOString(),
  })
  console.log(JSON.stringify(result))
}
