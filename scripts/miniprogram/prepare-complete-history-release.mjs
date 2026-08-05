import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { loadValidatedAuditEvidence } from './audit-evidence.mjs'
import { sha256, stableJson } from './remote-data-lib.mjs'
import { COMPLETE_REMOTE_SCHEMA_VERSION, COMPLETE_REMOTE_MONTHS, completeCoverageStart } from './complete-remote-data.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const versionConfig = require(resolve(root, 'apps/miniprogram/config/version.js'))
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
const sourceSnapshot = JSON.parse(await readFile(resolve(root, 'work/miniprogram-data-input/complete-snapshot.json'), 'utf8'))
const manifest = JSON.parse(manifestText)
const publishedManifest = JSON.parse(await readFile(resolve(root, 'apps/web/public/data/manifest.json'), 'utf8'))
const { report: audit, reportText: auditText, identity: auditIdentity } = await loadValidatedAuditEvidence(root, {
  expectedCommitSha: commitSha,
  expectedParserVersion: publishedManifest.parser_version,
  expectedCoverageEnd: manifest.dataset_as_of,
})
assert(report.status === 'staged_not_uploaded' && report.dataset_version === datasetVersion, 'staged report is invalid')
assert(manifest.remote_schema_version === COMPLETE_REMOTE_SCHEMA_VERSION, 'remote schema is invalid')
const expectedCoverageStart = completeCoverageStart(manifest.dataset_as_of)
assert(manifest.coverage_start === expectedCoverageStart && manifest.month_count === COMPLETE_REMOTE_MONTHS, 'coverage is invalid')
assert(report.app_version === versionConfig.version && manifest.minimum_app_version === versionConfig.version, 'candidate minimum app version is stale')
assert(Array.isArray(manifest.source_batch_ids) && manifest.source_batch_ids.length === COMPLETE_REMOTE_MONTHS && new Set(manifest.source_batch_ids).size === COMPLETE_REMOTE_MONTHS, 'candidate source batches are incomplete')
assert(manifest.snapshot_content_sha256 === sha256(stableJson(sourceSnapshot)), 'source snapshot identity is invalid')
assert(report.complete_snapshot_sha256 === sha256(snapshotText) && manifest.complete_snapshot_sha256 === sha256(snapshotText), 'snapshot hash is invalid')
assert(report.manifest_sha256 === sha256(manifestText), 'manifest hash is invalid')
assert(audit.batch_count === COMPLETE_REMOTE_MONTHS && audit.record_count === COMPLETE_REMOTE_MONTHS * 70 * 2 * 4 && audit.coverage_start === expectedCoverageStart && audit.coverage_end === manifest.dataset_as_of, 'full record audit coverage is incomplete')
assert(manifest.audit_version === auditIdentity.auditVersion && manifest.audit_method === auditIdentity.auditMethod && manifest.audit_repository_commit_sha === auditIdentity.repositoryCommitSha && manifest.audit_code_sha256 === auditIdentity.auditCodeSha256 && manifest.audit_report_sha256 === auditIdentity.reportSha256, 'candidate audit identity differs from the verified report')
assert(JSON.stringify(manifest.parser_versions) === JSON.stringify(auditIdentity.parserVersions) && manifest.source_records_sha256 === auditIdentity.recordsSha256 && manifest.source_index_sha256 === auditIdentity.sourceIndexSha256, 'candidate source identity differs from the verified report')
const gate = {
  status: 'passed', gate_type: 'complete_history_release', dataset_version: datasetVersion,
  source_dataset_version: manifest.source_dataset_version, cloud_env_id: cloudEnvId,
  commit_sha: commitSha, github_run_id: String(runId), remote_schema_version: COMPLETE_REMOTE_SCHEMA_VERSION,
  coverage_start: expectedCoverageStart, month_count: COMPLETE_REMOTE_MONTHS,
  dataset_as_of: manifest.dataset_as_of,
  complete_snapshot_sha256: sha256(snapshotText), complete_snapshot_bytes: Buffer.byteLength(snapshotText),
  manifest_sha256: sha256(manifestText), audit_version: audit.audit_version,
  audit_sha256: sha256(auditText), generated_at: new Date().toISOString(),
}
const outputRoot = resolve(root, 'work/complete-history-release')
await mkdir(outputRoot, { recursive: true })
const gateText = `${JSON.stringify(gate, null, 2)}\n`
await writeFile(resolve(outputRoot, 'gate-report.json'), gateText, 'utf8')
console.log(JSON.stringify({ dataset_version: datasetVersion, complete_snapshot_sha256: gate.complete_snapshot_sha256, gate_report_sha256: sha256(gateText) }))
