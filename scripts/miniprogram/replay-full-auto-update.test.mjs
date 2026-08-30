import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const execFileAsync = promisify(execFile)

test('full automatic update replay binds every historical candidate to its scoped publication identity', { timeout: 180_000 }, async () => {
  const runId = `test-full-auto-update-${process.pid}-${Date.now()}`
  const outputRoot = resolve(root, 'work/full-auto-update-replay', runId)
  const auditReportPath = resolve(root, 'work/full-auto-update-replay', `audit-report-${runId}.json`)
  const environment = { ...process.env, AUTO_RELEASE_AUDIT_REPORT_PATH: auditReportPath }

  try {
    await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'scripts/data/audit-batches.ts',
      '--report-only',
    ], { cwd: root, env: environment })

    await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'scripts/miniprogram/replay-full-auto-update.ts',
      '--months=2',
      `--run-id=${runId}`,
    ], { cwd: root, env: environment })

    const report = JSON.parse(await readFile(resolve(outputRoot, 'report.json'), 'utf8'))
    const fullAuditReport = JSON.parse(await readFile(auditReportPath, 'utf8'))
    assert.equal(report.status, 'passed')
    assert.equal(report.replay_count, 2)
    assert.equal(report.production_pointer_untouched, true)
    assert.equal(report.production_release_prefix_untouched, true)

    const packageStages = report.replays.map((replay) => replay.stages.find((stage) => stage.name === 'candidate_package'))
    assert.equal(packageStages.length, 2)
    assert(packageStages.every((stage) => stage?.evidence?.publication_identity_verified === true))
    assert(packageStages.every((stage) => /^[a-f0-9]{64}$/.test(stage.evidence.publication_audit_report_sha256)))
    assert(packageStages[0].evidence.publication_audit_batch_count < fullAuditReport.batch_count)
    assert(packageStages[0].evidence.publication_audit_record_count < fullAuditReport.record_count)
  } finally {
    await Promise.all([
      rm(outputRoot, { recursive: true, force: true }),
      rm(auditReportPath, { force: true }),
    ])
  }
})
