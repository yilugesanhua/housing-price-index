import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { sha256 } from './remote-data-lib.mjs'

const execFileAsync = promisify(execFile)
const ALLOWED = [
  /^apps\/web\/public\/data\//,
  /^apps\/miniprogram\/data\/snapshot\.js$/,
  /^data\/raw\/20\d{2}-(0[1-9]|1[0-2])\/[a-f0-9]{64}\.(?:batch\.json|html\.gz)$/,
  /^data\/normalized\/(?:records|revisions)\.json$/,
  /^data\/audit-report\.json$/,
  /^data\/releases\/pending-auto-release\.json$/,
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
    (path) => path === 'apps/web/public/data/manifest.json',
    (path) => path === 'apps/miniprogram/data/snapshot.js',
    (path) => path === 'data/releases/pending-auto-release.json',
  ]
  if (!required.every((matcher) => normalized.some(matcher))) throw new Error('Candidate persistence rejected: required generated artifacts are missing')
  return normalized
}

function parsePorcelain(output) {
  return output.split('\0').filter(Boolean).map((entry) => entry.slice(3))
}

const isMain = process.argv[1]?.endsWith('candidate-persistence.mjs')
if (isMain) {
  const root = resolve(import.meta.dirname, '../..')
  const gatePath = resolve(root, process.argv.find((value) => value.startsWith('--gate='))?.slice(7) || 'work/auto-release/gate-report.json')
  const gateText = await readFile(gatePath, 'utf8')
  const gate = JSON.parse(gateText)
  if (gate.status !== 'passed' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(gate.dataset_as_of || '')) throw new Error('Candidate persistence rejected: production gate has not passed')
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
    discovery_run_id: gate.discovery_run_id,
    idempotency_key: gate.idempotency_key,
    gate_report_sha256: sha256(gateText),
    prepared_at: new Date().toISOString(),
  }
  await writeFile(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, 'utf8')
  const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  const paths = validateCandidatePaths(parsePorcelain(stdout), gate.dataset_as_of)
  await execFileAsync('git', ['add', '--', ...paths], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  console.log(JSON.stringify({ status: 'staged', dataset_version: gate.dataset_version, paths }))
}
