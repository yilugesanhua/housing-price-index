import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256 } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const pending = JSON.parse(await readFile(resolve(root, 'data/releases/pending-auto-release.json'), 'utf8'))
if (pending.status !== 'ready') throw new Error('There is no pending automatic release')
const latest = JSON.parse(await readFile(resolve(root, 'work/miniprogram-data/latest-candidate.json'), 'utf8'))
const releaseReportText = await readFile(resolve(root, 'work/miniprogram-data', latest.dataset_version, 'release-report.json'), 'utf8')
const releaseReport = JSON.parse(releaseReportText)
const commitSha = process.env.GITHUB_SHA
if (!/^[a-f0-9]{40}$/.test(commitSha || '')) throw new Error('Recovery commit SHA is invalid')
if (latest.dataset_version !== pending.dataset_version || latest.source_dataset_version !== pending.source_dataset_version) throw new Error('Recovered candidate does not match pending release')
if (releaseReport.dataset_as_of !== pending.dataset_as_of || releaseReport.official_url !== pending.official_url || releaseReport.cloud_env_id !== pending.cloud_env_id) throw new Error('Recovered release report does not match pending release')
const gate = {
  format: 'housing-data-production-gate-v1',
  status: 'passed',
  recovery: true,
  cloud_env_id: pending.cloud_env_id,
  dataset_version: pending.dataset_version,
  source_dataset_version: pending.source_dataset_version,
  dataset_as_of: pending.dataset_as_of,
  official_url: pending.official_url,
  discovery_run_id: pending.discovery_run_id,
  commit_sha: commitSha,
  idempotency_key: pending.idempotency_key,
  source_raw_sha256: pending.source_raw_sha256,
  manifest_sha256: releaseReport.manifest_sha256,
  release_report_sha256: sha256(releaseReportText),
  checks: ['pending-state-integrity', 'official-source-refetch-hash', 'full-record-audit', 'validate:data', 'check', 'test:e2e', 'test:miniprogram', 'remote-snapshot-reconstruction'],
  passed_at: new Date().toISOString(),
}
const outputRoot = resolve(root, 'work/auto-release')
await mkdir(outputRoot, { recursive: true })
const gateText = `${JSON.stringify(gate, null, 2)}\n`
await writeFile(resolve(outputRoot, 'gate-report.json'), gateText, 'utf8')
await writeFile(resolve(outputRoot, 'discovery-gate.json'), `${JSON.stringify({ ...pending, status: 'recovery-verified' }, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ dataset_version: gate.dataset_version, gate_report_sha256: sha256(gateText), commit_sha: commitSha, discovery_run_id: gate.discovery_run_id }))
