import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { promisify } from 'node:util'
import { sha256 } from './remote-data-lib.mjs'
import { buildCandidateId, buildReleaseKey, readState, transitionState, writeState } from './auto-update-state.mjs'

const execFileAsync = promisify(execFile)
const ALLOWED = [
  /^data\/raw\/20\d{2}-(0[1-9]|1[0-2])\/[a-f0-9]{64}\.(?:batch\.json|html\.gz)$/,
  /^data\/releases\/pending-auto-release\.json$/,
  /^data\/releases\/auto-update-state\.json$/,
]

export function validateCandidatePaths(paths, expectedMonth) {
  const normalized = [...new Set(paths.map((path) => path.replaceAll('\\', '/')))].sort()
  if (normalized.length === 0) throw new Error('Candidate persistence rejected: no generated changes found')
  for (const path of normalized) {
    if (path.includes(' -> ') || !ALLOWED.some((pattern) => pattern.test(path))) throw new Error(`Candidate persistence rejected: path is not allowlisted: ${path}`)
  }
  const required = [
    (path) => path.startsWith(`data/raw/${expectedMonth}/`) && path.endsWith('.batch.json'),
    (path) => path.startsWith(`data/raw/${expectedMonth}/`) && path.endsWith('.html.gz'),
    (path) => path === 'data/releases/pending-auto-release.json',
    (path) => path === 'data/releases/auto-update-state.json',
  ]
  if (!required.every((matcher) => normalized.some(matcher))) throw new Error('Candidate persistence rejected: required generated artifacts are missing')
  return normalized
}

export function candidateSourceEvidencePaths(expectedMonth, sourceRawSha256) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(expectedMonth || '') || !/^[a-f0-9]{64}$/.test(sourceRawSha256 || '')) {
    throw new Error('Candidate persistence rejected: source identity is invalid')
  }
  const prefix = `data/raw/${expectedMonth}/${sourceRawSha256}`
  return [`${prefix}.batch.json`, `${prefix}.html.gz`]
}

export async function verifyExistingSourceEvidence(root, {
  expectedMonth,
  sourceRawSha256,
  officialUrl,
  sourceBatchId,
}) {
  const [batchRelativePath, archiveRelativePath] = candidateSourceEvidencePaths(expectedMonth, sourceRawSha256)
  let batch
  try {
    batch = JSON.parse(await readFile(resolve(root, batchRelativePath), 'utf8'))
  } catch (error) {
    throw new Error(`Candidate persistence rejected: source batch evidence is unavailable (${error.message})`)
  }
  const source = batch.source_batch
  if (source?.stat_month !== expectedMonth || source.raw_content_sha256 !== sourceRawSha256) {
    throw new Error('Candidate persistence rejected: source batch identity does not match the gate')
  }
  if (officialUrl && source.source_url !== officialUrl) {
    throw new Error('Candidate persistence rejected: source batch URL does not match the gate')
  }
  if (sourceBatchId && source.source_batch_id !== sourceBatchId) {
    throw new Error('Candidate persistence rejected: source batch ID does not match the gate')
  }
  try {
    const html = gunzipSync(await readFile(resolve(root, archiveRelativePath)))
    if (sha256(html) !== sourceRawSha256) throw new Error('decompressed bytes have a different SHA-256')
  } catch (error) {
    throw new Error(`Candidate persistence rejected: compressed source evidence is invalid (${error.message})`)
  }
  return [batchRelativePath, archiveRelativePath]
}

export function validateCandidateRunId(value) {
  if (!/^\d+$/.test(String(value || ''))) throw new Error('Candidate persistence rejected: candidate workflow run ID is invalid')
  return String(value)
}

export function buildDurableReadyState(pending) {
  if (!pending || pending.status !== 'ready') throw new Error('Candidate persistence rejected: pending candidate is not ready')
  const timeSeed = pending.time_seed || pending.prepared_at
  if (!timeSeed || !Number.isFinite(Date.parse(timeSeed))) throw new Error('Candidate persistence rejected: stable time seed is invalid')
  if (!pending.next_check_at || !Number.isFinite(Date.parse(pending.next_check_at))) throw new Error('Candidate persistence rejected: stable next check time is invalid')
  return {
    ...pending,
    // The pending record and the durable state have different machine
    // formats. Do not let the pending format leak into auto-update-state.json.
    format: 'housing-data-auto-update-state-v1',
    status: 'ready',
    time_seed: timeSeed,
    next_check_at: pending.next_check_at,
    updated_at: pending.prepared_at || timeSeed,
  }
}

function parsePorcelain(output) {
  return output.split('\0').filter(Boolean).map((entry) => entry.slice(3))
}

const GENERATED_CLIENT_PATHS = new Set(['apps/miniprogram/data/snapshot.js', 'data/audit-report.json', 'data/normalized/records.json', 'data/normalized/revisions.json'])
const GENERATED_CLIENT_PREFIXES = ['apps/web/public/data/', 'data/normalized/']

async function discardGeneratedOutputs(root, entries) {
  for (const entry of entries) {
    const path = entry.path.replaceAll('\\', '/')
    if (!GENERATED_CLIENT_PATHS.has(path) && !GENERATED_CLIENT_PREFIXES.some((prefix) => path.startsWith(prefix))) continue
    if (entry.status !== '??') throw new Error(`Candidate persistence requires generated client outputs to be restored before persistence: ${path}`)
    await rm(resolve(root, path), { force: true, recursive: true })
  }
}

const isMain = process.argv[1]?.endsWith('candidate-persistence.mjs')
if (isMain) {
  const root = resolve(import.meta.dirname, '../..')
  const gatePath = resolve(root, process.argv.find((value) => value.startsWith('--gate='))?.slice(7) || 'work/auto-release/gate-report.json')
  const gateText = await readFile(gatePath, 'utf8')
  const gate = JSON.parse(gateText)
  if (gate.status !== 'passed' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(gate.dataset_as_of || '')) throw new Error('Candidate persistence rejected: production gate has not passed')
  const candidateRunId = validateCandidateRunId(gate.candidate_run_id)
  const pendingPath = resolve(root, 'data/releases/pending-auto-release.json')
  await mkdir(resolve(root, 'data/releases'), { recursive: true })
  const pending = {
    format: 'housing-data-pending-auto-release-v1',
    status: 'ready',
    dataset_version: gate.dataset_version,
    source_dataset_version: gate.source_dataset_version,
    dataset_as_of: gate.dataset_as_of,
    cloud_env_id: gate.cloud_env_id,
    official_url: gate.official_url,
    source_raw_sha256: gate.source_raw_sha256,
    candidate_run_id: candidateRunId,
    discovery_run_id: gate.discovery_run_id,
    idempotency_key: gate.idempotency_key,
    release_key: gate.release_key || buildReleaseKey(gate.dataset_as_of, gate.source_raw_sha256),
    // Exact source/code commit that produced the candidate. The later
    // durable-state commit remains separately recorded as gate.commit_sha.
    producer_commit_sha: gate.producer_commit_sha || gate.candidate_commit_sha || gate.commit_sha || gate.discovery_commit_sha,
    candidate_commit_sha: gate.producer_commit_sha || gate.candidate_commit_sha || gate.commit_sha || gate.discovery_commit_sha,
    candidate_manifest_sha256: gate.candidate_manifest_sha256 || gate.manifest_sha256,
    candidate_id: gate.candidate_id || buildCandidateId({
      releaseKey: gate.release_key || buildReleaseKey(gate.dataset_as_of, gate.source_raw_sha256),
      commitSha: gate.producer_commit_sha || gate.candidate_commit_sha || gate.commit_sha || gate.discovery_commit_sha,
      candidateManifestSha256: gate.candidate_manifest_sha256 || gate.manifest_sha256,
    }),
    state_version: 'housing-data-auto-update-state-v1',
    gate_report_sha256: sha256(gateText),
    time_seed: gate.time_seed || gate.started_at,
    next_check_at: gate.next_check_at,
    prepared_at: gate.time_seed || gate.started_at || new Date().toISOString(),
  }
  const statePath = resolve(root, 'data/releases/auto-update-state.json')
  const existing = await readState(statePath)
  if (existing?.status === 'ready' && existing.candidate_id !== pending.candidate_id) throw new Error('Existing ready candidate identity differs from regenerated candidate')
  const nextState = existing
    ? transitionState(existing, 'ready', buildDurableReadyState(pending))
    : buildDurableReadyState(pending)
  await writeState(statePath, nextState)
  await writeFile(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, 'utf8')
  const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  const rawEntries = stdout.split('\0').filter(Boolean).map((entry) => ({ status: entry.slice(0, 2).trim() || '??', path: entry.slice(3) }))
  await discardGeneratedOutputs(root, rawEntries)
  const { stdout: cleanStatus } = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  const changedPaths = parsePorcelain(cleanStatus)
  // A retry may reuse raw evidence persisted by an earlier failed run. It is
  // still required to prove the exact batch/archive identity before allowing
  // the unchanged files to satisfy the persistence contract.
  const sourcePaths = await verifyExistingSourceEvidence(root, {
    expectedMonth: gate.dataset_as_of,
    sourceRawSha256: gate.source_raw_sha256,
    officialUrl: gate.official_url,
    sourceBatchId: gate.source_batch_id,
  })
  const paths = validateCandidatePaths([...changedPaths, ...sourcePaths], gate.dataset_as_of)
  await execFileAsync('git', ['add', '--', ...paths], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  console.log(JSON.stringify({ status: 'staged', dataset_version: gate.dataset_version, paths }))
}
