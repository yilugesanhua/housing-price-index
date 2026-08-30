import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { sha256 } from './remote-data-lib.mjs'
import { loadAndValidateHistoricalCorrection } from './historical-correction-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const requestArgument = argument('request')
const commitSha = argument('commit')
const runId = argument('run-id')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
if (!requestArgument || !/^data[\\/]corrections[\\/][a-z0-9-]+\.json$/.test(requestArgument)) throw new Error('Use --request=data/corrections/<revision-id>.json')
if (!/^[a-f0-9]{40}$/.test(commitSha || '') || !/^\d+$/.test(runId || '')) throw new Error('Valid --commit and --run-id are required')
const requestPath = resolve(root, requestArgument)
if (!relative(resolve(root, 'data/corrections'), requestPath) || relative(resolve(root, 'data/corrections'), requestPath).startsWith('..')) throw new Error('Correction request path is unsafe')
const correction = await loadAndValidateHistoricalCorrection({
  root,
  requestPath,
  candidateCommitSha: commitSha,
  githubRunId: runId,
})
const latest = JSON.parse(await readFile(resolve(root, 'work/miniprogram-data/latest-candidate.json'), 'utf8'))
const report = JSON.parse(await readFile(resolve(root, 'work/miniprogram-data', latest.dataset_version, 'release-report.json'), 'utf8'))
if (report.release_type !== 'historical_correction'
  || report.revision_id !== correction.revision_id
  || report.source_dataset_version !== correction.source_dataset_version
  || report.commit_sha !== undefined && report.commit_sha !== correction.commit_sha) throw new Error('Staged package does not match the approved correction request')
for (const field of [
  'candidate_records_sha256', 'audit_records_sha256', 'source_index_sha256',
  'audit_report_sha256', 'audit_commit_sha', 'audit_code_sha256',
]) {
  if (report[field] !== correction[field]) throw new Error(`Staged package correction identity mismatch: ${field}`)
}
if (JSON.stringify(report.latest_source_batch_ids) !== JSON.stringify(correction.latest_source_batch_ids)
  || JSON.stringify(report.revision_source_batch_ids) !== JSON.stringify(correction.revision_source_batch_ids)) throw new Error('Staged package source batch sets do not match the approved correction request')
const gate = {
  status: 'passed', gate_type: 'historical_data_correction', revision_id: correction.revision_id,
  dataset_version: report.dataset_version, source_dataset_version: correction.source_dataset_version,
  supersedes_source_dataset_version: correction.supersedes_source_dataset_version,
  cloud_env_id: cloudEnvId, commit_sha: commitSha, github_run_id: runId,
  request_path: requestArgument.replaceAll('\\', '/'), request_sha256: sha256(await readFile(requestPath, 'utf8')),
  manifest_sha256: report.manifest_sha256, revision_manifest_sha256: report.revision_manifest_sha256,
  candidate_records_sha256: correction.candidate_records_sha256,
  audit_records_sha256: correction.audit_records_sha256,
  source_index_sha256: correction.source_index_sha256,
  audit_report_sha256: correction.audit_report_sha256,
  audit_commit_sha: correction.audit_commit_sha,
  audit_code_sha256: correction.audit_code_sha256,
  latest_source_batch_ids: correction.latest_source_batch_ids,
  revision_source_batch_ids: correction.revision_source_batch_ids,
  ledger_before_sha256: correction.ledger_before_sha256,
  ledger_after_sha256: correction.ledger_after_sha256,
  ledger_append_start: correction.ledger_append_start,
  ledger_append_count: correction.ledger_append_count,
  ledger_append_sha256: correction.ledger_append_sha256,
  changed_record_count: correction.changed_record_count, changed_field_count: correction.changed_field_count,
  generated_at: new Date().toISOString(),
}
const outputRoot = resolve(root, 'work/historical-correction')
await mkdir(outputRoot, { recursive: true })
const gateText = `${JSON.stringify(gate, null, 2)}\n`
await writeFile(resolve(outputRoot, 'gate-report.json'), gateText, 'utf8')
console.log(JSON.stringify({ dataset_version: gate.dataset_version, revision_id: gate.revision_id, gate_report_sha256: sha256(gateText) }))
