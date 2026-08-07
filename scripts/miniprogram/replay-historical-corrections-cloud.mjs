import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { runHistoricalCorrectionReplay } from './replay-historical-corrections.mjs'
import { activatePointerWithRollback, GuardedActivationError } from './guarded-activation.mjs'
import { sha256, stableJson } from './remote-data-lib.mjs'
import { assertRehearsalKey, createTencentCloudClient } from './tencent-cloud-sdk.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const requestedRounds = Number(argument('rounds') ?? '12')
const runId = argument('run-id') ?? process.env.GITHUB_RUN_ID
const cloudEnvId = argument('env') ?? 'cloud1-d3gpdx70w5d05c68c'
const outputRoot = resolve(root, 'work/historical-correction-replay-cloud', runId || 'missing-run-id')

assert(Number.isInteger(requestedRounds) && requestedRounds >= 12 && requestedRounds <= 36, '--rounds must be an integer from 12 to 36')
assert(/^\d+(?:-\d+)?$/.test(runId || ''), 'Use --run-id=<numeric-github-run-id>')

function pointer(datasetVersion, sourceDatasetVersion, manifestSha256) {
  return {
    dataset_version: datasetVersion,
    source_dataset_version: sourceDatasetVersion,
    manifest_sha256: manifestSha256,
    rehearsal_only: true,
  }
}

async function putAndVerify(cloud, key, body) {
  const verifiedKey = assertRehearsalKey(key, runId)
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body)
  await cloud.putObject(verifiedKey, bytes)
  await cloud.headObject(verifiedKey)
  const downloaded = await cloud.getObject(verifiedKey)
  assert.equal(sha256(downloaded), sha256(bytes), `isolated object hash mismatch: ${verifiedKey}`)
  return { key: verifiedKey, bytes: bytes.byteLength, sha256: sha256(bytes), head_verified: true, round_trip_verified: true }
}

async function pointerRehearsal({ cloud, pointerKey, previous, candidate, evidencePrefix }) {
  const readPointerText = async () => (await cloud.getObject(pointerKey)).toString('utf8')
  const guard = async (expected) => assert.equal(await readPointerText(), stableJson(expected), 'isolated pointer guard mismatch')
  const write = async (text) => cloud.putObject(pointerKey, Buffer.from(text))
  const reset = async () => putAndVerify(cloud, pointerKey, stableJson(previous))
  const assertPrevious = async () => assert.equal(await readPointerText(), stableJson(previous), 'isolated rollback did not restore the prior pointer')

  await reset()
  const success = await activatePointerWithRollback({
    candidate,
    candidateText: stableJson(candidate),
    previous,
    rollbackEligible: true,
    writePointer: write,
    readPointerText,
    guardCandidate: guard,
    guardRollback: guard,
    prepareRollback: async () => previous,
    verifyRollbackTarget: guard,
  })
  assert.equal(success.status, 'published')
  await guard(candidate)

  await reset()
  try {
    await activatePointerWithRollback({
      candidate,
      candidateText: stableJson(candidate),
      previous,
      rollbackEligible: true,
      writePointer: async (text, label) => {
        if (label === 'candidate') throw new Error('intentional isolated pre-switch interruption')
        await write(text)
      },
      readPointerText,
      guardCandidate: guard,
      guardRollback: guard,
      prepareRollback: async () => previous,
      verifyRollbackTarget: guard,
      recordRollback: async (event) => putAndVerify(cloud, `${evidencePrefix}/pre-switch-rollback.json`, stableJson({ rollback_status: 'succeeded', failed_at: event.failedAt })),
    })
    assert.fail('pre-switch interruption unexpectedly published')
  } catch (error) {
    assert(error instanceof GuardedActivationError && error.rollbackStatus === 'succeeded')
  }
  await assertPrevious()

  await reset()
  try {
    await activatePointerWithRollback({
      candidate,
      candidateText: stableJson(candidate),
      previous,
      rollbackEligible: true,
      writePointer: write,
      readPointerText,
      guardCandidate: async () => { throw new Error('intentional isolated post-switch guard failure') },
      guardRollback: guard,
      prepareRollback: async () => previous,
      verifyRollbackTarget: guard,
      recordRollback: async (event) => putAndVerify(cloud, `${evidencePrefix}/post-switch-rollback.json`, stableJson({ rollback_status: 'succeeded', failed_at: event.failedAt })),
    })
    assert.fail('post-switch failure unexpectedly published')
  } catch (error) {
    assert(error instanceof GuardedActivationError && error.rollbackStatus === 'succeeded')
  }
  await assertPrevious()

  await reset()
  try {
    await activatePointerWithRollback({
      candidate,
      candidateText: stableJson(candidate),
      previous,
      rollbackEligible: false,
      writePointer: write,
      readPointerText,
      guardCandidate: guard,
    })
    assert.fail('unsafe rollback target unexpectedly activated')
  } catch (error) {
    assert(error instanceof GuardedActivationError && error.rollbackStatus === 'not-available')
  }
  await assertPrevious()

  return {
    key: pointerKey,
    successful_switch_verified: true,
    pre_switch_interruption_rollback_verified: true,
    post_switch_failure_rollback_verified: true,
    unsafe_rollback_rejected: true,
  }
}

async function main() {
  const [{ stdout }, dataText, manifestText, auditText, workflowText] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }),
    readFile(resolve(root, 'apps/web/public/data/data.json'), 'utf8'),
    readFile(resolve(root, 'apps/web/public/data/manifest.json'), 'utf8'),
    readFile(resolve(root, 'data/audit-report.json'), 'utf8'),
    readFile(resolve(root, '.github/workflows/historical-correction-replay.yml'), 'utf8'),
  ])
  const data = JSON.parse(dataText)
  const manifest = JSON.parse(manifestText)
  const audit = JSON.parse(auditText)
  const appVersion = require(resolve(root, 'apps/miniprogram/config/version.js')).version
  const sourceCommitSha = stdout.trim()
  const sourceDatasetVersion = manifest.source_dataset_version
  assert(/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(sourceDatasetVersion || ''), 'manifest source dataset version is invalid')
  assert.equal(manifest.dataset_version, data.dataset_version, 'manifest and web data versions differ')
  const workflowFileSha256 = sha256(workflowText)
  const cloud = createTencentCloudClient({ cloudEnvId })
  const prefix = `housing-data/rehearsals/${runId}/historical-corrections/`
  const startedAt = new Date().toISOString()
  const roundEvidence = []

  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true })
  const semanticReport = await runHistoricalCorrectionReplay({
    records: data.records,
    auditVersion: audit.audit_version,
    commitSha: sourceCommitSha,
    rounds: requestedRounds,
    onRound: async ({ round, request, registry, previous_dataset_version, previous_source_dataset_version, candidate_dataset_version, candidate_source_dataset_version }) => {
      const started = performance.now()
      const roundPrefix = `${prefix}round-${String(round).padStart(2, '0')}`
      const objects = await Promise.all([
        putAndVerify(cloud, `${roundPrefix}/correction-request.json`, stableJson(request)),
        putAndVerify(cloud, `${roundPrefix}/revocation-registry.json`, stableJson(registry)),
        putAndVerify(cloud, `${roundPrefix}/evidence.json`, stableJson({
          round,
          app_version: appVersion,
          source_commit_sha: sourceCommitSha,
          source_dataset_version: sourceDatasetVersion,
          parser_version: data.records[0].parser_version,
          audit_version: audit.audit_version,
          workflow_file_sha256: workflowFileSha256,
          github_run_id: runId,
          cloud_env_id: cloudEnvId,
        })),
      ])
      const pointerKey = assertRehearsalKey(`${roundPrefix}/current.json`, runId)
      const prior = pointer(previous_dataset_version, previous_source_dataset_version, sha256(`prior-${round}`))
      const candidate = pointer(candidate_dataset_version, candidate_source_dataset_version, sha256(`candidate-${round}`))
      const pointerEvidence = await pointerRehearsal({ cloud, pointerKey, previous: prior, candidate, evidencePrefix: roundPrefix })
      const evidence = {
        round,
        objects,
        pointer: pointerEvidence,
        duration_ms: Math.round(performance.now() - started),
      }
      roundEvidence.push(evidence)
      return evidence
    },
  })
  const completedAt = new Date().toISOString()
  const report = {
    format: 'housing-historical-correction-cloud-replay-v1',
    status: 'passed',
    run_id: runId,
    github_run_id: runId,
    cloud_env_id: cloudEnvId,
    prefix,
    app_version: appVersion,
    source_commit_sha: sourceCommitSha,
    source_dataset_version: sourceDatasetVersion,
    parser_version: data.records[0].parser_version,
    audit_version: audit.audit_version,
    workflow_file_sha256: workflowFileSha256,
    automatic_release_enabled: false,
    production_pointer_untouched: true,
    production_release_prefix_untouched: true,
    started_at: startedAt,
    completed_at: completedAt,
    total_duration_ms: Math.round(Date.parse(completedAt) - Date.parse(startedAt)),
    replay_count: semanticReport.replay_count,
    replays: roundEvidence,
  }
  report.report_sha256 = createHash('sha256').update(JSON.stringify(report)).digest('hex')
  await writeFile(resolve(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ status: report.status, replay_count: report.replay_count, report: resolve(outputRoot, 'report.json') }))
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main()
