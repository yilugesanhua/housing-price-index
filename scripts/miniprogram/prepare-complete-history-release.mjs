import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256 } from './remote-data-lib.mjs'
import { COMPLETE_REMOTE_SCHEMA_VERSION, COMPLETE_REMOTE_MONTHS, COMPLETE_REMOTE_START } from './complete-remote-data.mjs'

const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const commitSha = argument('commit') || process.env.GITHUB_SHA
const runId = argument('run-id') || process.env.GITHUB_RUN_ID
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const datasetVersion = argument('dataset') || JSON.parse(await readFile(resolve(root, 'work/miniprogram-complete-data/latest-candidate.json'), 'utf8')).dataset_version
const candidateRoot = resolve(root, 'work/miniprogram-complete-data', datasetVersion)
const assert = (condition, message) => { if (!condition) throw new Error(`Complete history release gate failed: ${message}`) }

assert(/^[a-f0-9]{40}$/.test(commitSha || ''), 'commit SHA is invalid')
assert(/^\d+$/.test(runId || ''), 'GitHub run ID is invalid')
const report = JSON.parse(await readFile(resolve(candidateRoot, 'release-report.json'), 'utf8'))
const manifestText = await readFile(resolve(candidateRoot, 'manifest.json'), 'utf8')
const snapshotText = await readFile(resolve(candidateRoot, 'complete-snapshot.json'), 'utf8')
const manifest = JSON.parse(manifestText)
const audit = JSON.parse(await readFile(resolve(root, 'data/audit-report.json'), 'utf8'))
assert(report.status === 'staged_not_uploaded' && report.dataset_version === datasetVersion, 'staged report is invalid')
assert(manifest.remote_schema_version === COMPLETE_REMOTE_SCHEMA_VERSION, 'remote schema is invalid')
assert(manifest.coverage_start === COMPLETE_REMOTE_START && manifest.month_count === COMPLETE_REMOTE_MONTHS, 'coverage is invalid')
assert(report.complete_snapshot_sha256 === sha256(snapshotText) && manifest.complete_snapshot_sha256 === sha256(snapshotText), 'snapshot hash is invalid')
assert(report.manifest_sha256 === sha256(manifestText), 'manifest hash is invalid')
assert(audit.result === 'passed' && audit.audit_version === 'full-record-audit-v6', 'full record audit did not pass')
assert(audit.batch_count === 180 && audit.record_count === 100800 && audit.coverage_start === COMPLETE_REMOTE_START && audit.coverage_end === manifest.dataset_as_of, 'full record audit coverage is incomplete')
const gate = {
  status: 'passed', gate_type: 'complete_history_release', dataset_version: datasetVersion,
  source_dataset_version: manifest.source_dataset_version, cloud_env_id: cloudEnvId,
  commit_sha: commitSha, github_run_id: String(runId), remote_schema_version: COMPLETE_REMOTE_SCHEMA_VERSION,
  coverage_start: COMPLETE_REMOTE_START, month_count: COMPLETE_REMOTE_MONTHS,
  complete_snapshot_sha256: sha256(snapshotText), complete_snapshot_bytes: Buffer.byteLength(snapshotText),
  manifest_sha256: sha256(manifestText), audit_version: audit.audit_version,
  audit_sha256: sha256(await readFile(resolve(root, 'data/audit-report.json'))), generated_at: new Date().toISOString(),
}
const outputRoot = resolve(root, 'work/complete-history-release')
await mkdir(outputRoot, { recursive: true })
const gateText = `${JSON.stringify(gate, null, 2)}\n`
await writeFile(resolve(outputRoot, 'gate-report.json'), gateText, 'utf8')
console.log(JSON.stringify({ dataset_version: datasetVersion, complete_snapshot_sha256: gate.complete_snapshot_sha256, gate_report_sha256: sha256(gateText) }))
