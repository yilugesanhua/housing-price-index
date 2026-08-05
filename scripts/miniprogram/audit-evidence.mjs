import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const FULL_RECORD_AUDIT_VERSION = 'full-record-audit-v7'
export const FULL_RECORD_AUDIT_METHOD = 'automated-full-record-audit-v7: sha256+official-url+metadata+four-table-whitelist+property-type+size-band+locator+raw-cell+schema+numeric-invariants+record-hash-binding+code-and-report-identity'
export const AUDIT_CODE_PATHS = [
  'packages/core/src/index.ts',
  'scripts/data/audit-batches.ts',
  'scripts/data/audit-report.ts',
  'scripts/data/audit-source-association.ts',
  'scripts/data/official-parser.ts',
  'scripts/data/raw-archive.ts',
  'scripts/data/types.ts',
  'scripts/data/validate.ts',
]

function assert(condition, message) {
  if (!condition) throw new Error(`Full-record audit evidence is invalid: ${message}`)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function nextMonth(month) {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 7)
}

export function auditReportSha256(report) {
  const { report_sha256: _ignored, ...content } = report
  return digest(content)
}

export async function auditCodeSha256(root) {
  const files = []
  for (const path of AUDIT_CODE_PATHS) {
    const content = (await readFile(resolve(root, path), 'utf8')).replace(/\r\n/g, '\n')
    files.push({ path, sha256: createHash('sha256').update(content).digest('hex') })
  }
  return digest(files)
}

export function repositoryCommitSha(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

export async function validateAuditEvidence(audit, {
  root,
  expectedCommitSha = repositoryCommitSha(root),
  expectedParserVersion,
  expectedCoverageStart = '2011-07',
  expectedCoverageEnd,
  expectedBatchCount = 180,
  expectedRecordCount = 100800,
} = {}) {
  assert(audit && typeof audit === 'object' && !Array.isArray(audit), 'report is missing')
  assert(audit.schema_version === 2 && audit.audit_version === FULL_RECORD_AUDIT_VERSION && audit.verification_method === FULL_RECORD_AUDIT_METHOD && audit.result === 'passed', 'report version or result is unsupported')
  assert(Number.isFinite(Date.parse(audit.verified_at || '')), 'verified_at is invalid')
  assert(/^[a-f0-9]{64}$/.test(audit.report_sha256 || '') && audit.report_sha256 === auditReportSha256(audit), 'report SHA-256 is invalid')
  assert(/^[a-f0-9]{40}$/.test(expectedCommitSha || '') && audit.repository_commit_sha === expectedCommitSha, 'repository commit does not match')
  assert(/^[a-f0-9]{64}$/.test(audit.audit_code_sha256 || '') && audit.audit_code_sha256 === await auditCodeSha256(root), 'audit code SHA-256 does not match')
  assert(Array.isArray(audit.parser_versions) && audit.parser_versions.length > 0 && new Set(audit.parser_versions).size === audit.parser_versions.length, 'parser version set is invalid')
  assert(JSON.stringify(audit.parser_versions) === JSON.stringify([...audit.parser_versions].sort()), 'parser version set is not canonical')
  if (expectedParserVersion) assert(audit.parser_versions.length === 1 && audit.parser_versions[0] === expectedParserVersion, 'parser version does not match published data')
  assert(audit.batch_count === expectedBatchCount && audit.record_count === expectedRecordCount, 'record or batch count is incomplete')
  assert(audit.coverage_start === expectedCoverageStart && (!expectedCoverageEnd || audit.coverage_end === expectedCoverageEnd), 'coverage is incomplete')
  assert(/^[a-f0-9]{64}$/.test(audit.records_sha256 || '') && /^[a-f0-9]{64}$/.test(audit.source_index_sha256 || ''), 'source content identity is invalid')
  assert(Array.isArray(audit.batches) && audit.batches.length === expectedBatchCount, 'batch evidence is incomplete')
  const batchIds = new Set()
  const months = []
  let checkedRecords = 0
  for (const batch of audit.batches) {
    assert(!batchIds.has(batch.source_batch_id), `duplicate batch ${batch.source_batch_id}`)
    batchIds.add(batch.source_batch_id)
    assert(/^official-html-20\d{2}-(?:0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(batch.source_batch_id || ''), `batch identity is invalid: ${batch.source_batch_id}`)
    assert(/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(batch.stat_month || '') && batch.source_batch_id.startsWith(`official-html-${batch.stat_month}-`), `batch month is invalid: ${batch.source_batch_id}`)
    assert(batch.result === 'passed' && batch.records_checked === 560 && /^[a-f0-9]{64}$/.test(batch.raw_content_sha256 || '') && /^[a-f0-9]{64}$/.test(batch.records_sha256 || ''), `batch evidence is invalid: ${batch.source_batch_id}`)
    months.push(batch.stat_month)
    checkedRecords += batch.records_checked
  }
  months.sort()
  assert(new Set(months).size === expectedBatchCount && months[0] === expectedCoverageStart && (!expectedCoverageEnd || months.at(-1) === expectedCoverageEnd), 'batch months do not match coverage')
  for (let index = 1; index < months.length; index += 1) assert(months[index] === nextMonth(months[index - 1]), `batch month coverage is not continuous at ${months[index]}`)
  assert(checkedRecords === expectedRecordCount, 'batch record total is incomplete')
  return {
    auditVersion: audit.audit_version,
    auditMethod: audit.verification_method,
    repositoryCommitSha: audit.repository_commit_sha,
    auditCodeSha256: audit.audit_code_sha256,
    reportSha256: audit.report_sha256,
    parserVersions: [...audit.parser_versions],
    recordsSha256: audit.records_sha256,
    sourceIndexSha256: audit.source_index_sha256,
  }
}

export async function loadValidatedAuditEvidence(root, options = {}) {
  const reportPath = resolve(root, 'data/audit-report.json')
  const reportText = await readFile(reportPath, 'utf8')
  const report = JSON.parse(reportText)
  const identity = await validateAuditEvidence(report, { root, ...options })
  return { report, reportText, identity }
}
