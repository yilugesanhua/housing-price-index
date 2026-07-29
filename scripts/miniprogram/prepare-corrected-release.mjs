import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { sha256 } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const snapshot = require(resolve(root, 'apps/miniprogram/data/snapshot.js'))
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const candidatePath = resolve(root, argument('candidate') || 'work/miniprogram-data/latest-candidate.json')
const outputPath = resolve(root, argument('output') || 'work/corrected-release/gate-report.json')
const commitSha = argument('commit') || process.env.GITHUB_SHA
const runId = argument('run-id') || process.env.GITHUB_RUN_ID
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const expectedSourceVersion = '2026-06-4fd1d1a8ff12'
const expectedCurrentVersion = '2026-06-ec36ff8fb2e5'
const expectedCurrentSourceVersion = '2026-06-679ea146d4e2'

function assert(condition, message) {
  if (!condition) throw new Error(`Corrected release gate failed: ${message}`)
}

assert(/^[a-f0-9]{40}$/.test(commitSha || ''), 'commit SHA is invalid')
assert(/^\d+$/.test(runId || ''), 'GitHub run ID is invalid')
assert(snapshot.datasetVersion === expectedSourceVersion, `bundled source version must be ${expectedSourceVersion}`)
assert(snapshot.datasetAsOf === '2026-06', 'bundled dataset month must be 2026-06')
const candidate = JSON.parse(await readFile(candidatePath, 'utf8'))
assert(candidate.source_dataset_version === expectedSourceVersion, 'candidate source version differs from the corrected snapshot')
assert(/^2026-06-[a-f0-9]{12}$/.test(candidate.dataset_version || ''), 'candidate dataset version is invalid')

const audit = JSON.parse(await readFile(resolve(root, 'data/audit-report.json'), 'utf8'))
assert(audit.result === 'passed', 'full-record audit did not pass')
assert(audit.audit_version === 'full-record-audit-v4', 'full-record audit version is not V4')
assert(audit.verification_method === 'automated-full-record-audit-v4: sha256+official-url+metadata+four-table-whitelist+size-band+locator+raw-cell+schema', 'full-record audit method is unexpected')
assert(audit.batch_count === 126, 'full-record audit must cover 126 batches')
assert(audit.record_count === 70560, 'full-record audit must cover 70,560 records')
assert(audit.coverage_start === '2016-01' && audit.coverage_end === '2026-06', 'full-record audit coverage is incomplete')

const gate = {
  status: 'passed',
  gate_type: 'manual_corrected_release',
  dataset_version: candidate.dataset_version,
  source_dataset_version: expectedSourceVersion,
  expected_current_dataset_version: expectedCurrentVersion,
  expected_current_source_dataset_version: expectedCurrentSourceVersion,
  cloud_env_id: cloudEnvId,
  commit_sha: commitSha,
  github_run_id: String(runId),
  parser_version: 'official-html-v7-product-housing-only',
  audit_version: audit.audit_version,
  audit_sha256: sha256(await readFile(resolve(root, 'data/audit-report.json'))),
  audit_batch_count: audit.batch_count,
  audit_record_count: audit.record_count,
  correction_record_count: 150,
  generated_at: new Date().toISOString(),
}
const text = `${JSON.stringify(gate, null, 2)}\n`
await mkdir(resolve(outputPath, '..'), { recursive: true })
await writeFile(outputPath, text, 'utf8')
console.log(JSON.stringify({ ...gate, gate_report_sha256: sha256(text) }))
