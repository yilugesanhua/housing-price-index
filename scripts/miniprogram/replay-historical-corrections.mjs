import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { actualBusinessChanges, recordKey, validateHistoricalCorrection } from './historical-correction-lib.mjs'
import {
  appendHistoricalCorrectionRevocations,
  assertTargetNotRevoked,
  createRevocationRegistry,
} from './control-plane.mjs'
import { activatePointerWithRollback, GuardedActivationError } from './guarded-activation.mjs'
import { stableJson } from './remote-data-lib.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const requestedRounds = Number(argument('rounds') ?? '12')
const runId = argument('run-id') ?? `local-${Date.now()}`
const outputRoot = resolve(root, 'work/historical-correction-replay', runId)

assert(Number.isInteger(requestedRounds) && requestedRounds >= 12 && requestedRounds <= 36, '--rounds must be an integer from 12 to 36')

function version(number) {
  return `2026-06-${number.toString(16).padStart(12, '0')}`
}

function clone(value) {
  return structuredClone(value)
}

function selectedRecords(records, round) {
  const counts = [1, 3, 6, 12, 24, 48, 75, 100, 125, 150, 4, 18]
  const count = counts[(round - 1) % counts.length]
  const start = (round * 7919) % records.length
  const result = []
  for (let index = 0; index < count; index += 1) result.push(records[(start + index * 173) % records.length])
  return result
}

function correctedData(previousData, recordsToCorrect, round, sourceVersion) {
  const selected = new Set(recordsToCorrect.map(recordKey))
  return {
    dataset_version: sourceVersion,
    records: previousData.records.map((record) => {
      if (!selected.has(recordKey(record))) return record
      return {
        ...record,
        source_record_locator: `${record.source_record_locator} correction-replay-${round}`,
      }
    }),
  }
}

function correctionRequest({ previousData, currentData, recordsToCorrect, round, commitSha, auditVersion }) {
  const changes = actualBusinessChanges(previousData, currentData).map((change) => {
    const record = currentData.records.find((item) => recordKey(item) === change.record_key)
    return { ...change, source_url: record.source_url, source_record_locator: record.source_record_locator }
  })
  const sourceBatchIds = [...new Set(recordsToCorrect.map((record) => record.source_batch_id))].sort()
  return {
    revision_id: `revision-replay-${String(round).padStart(2, '0')}-historical`,
    revision_type: 'historical_data_correction',
    approval_status: 'approved',
    baseline_commit_sha: commitSha,
    dataset_as_of: currentData.records.reduce((latest, record) => record.stat_month > latest ? record.stat_month : latest, ''),
    supersedes_source_dataset_version: previousData.dataset_version,
    source_dataset_version: currentData.dataset_version,
    source_version_chain: [previousData.dataset_version, currentData.dataset_version],
    revoked_source_dataset_versions: [previousData.dataset_version],
    reason: `隔离历史修订回放第${round}轮，验证逐字段批准、撤销和失败关闭。`,
    official_urls: [...new Set(recordsToCorrect.map((record) => record.source_url))].sort(),
    source_batch_ids: sourceBatchIds,
    parser_version: currentData.records[0].parser_version,
    audit_version: auditVersion,
    approved_at: '2026-08-06T00:00:00.000Z',
    approved_by: 'historical-correction-replay',
    changes,
  }
}

function rejected(label, action) {
  try {
    action()
  } catch (error) {
    return { name: label, rejected: true, error: error instanceof Error ? error.message : String(error) }
  }
  throw new Error(`${label}: invalid correction was accepted`)
}

async function verifyGuardedPointer({ previousDatasetVersion, candidateDatasetVersion }) {
  const previous = { dataset_version: previousDatasetVersion, manifest_sha256: 'a'.repeat(64) }
  const candidate = { dataset_version: candidateDatasetVersion, manifest_sha256: 'b'.repeat(64) }
  const activate = async ({ failWrite, failCandidateGuard, rollbackEligible = true } = {}) => {
    let pointerText = stableJson(previous)
    const events = []
    try {
      const result = await activatePointerWithRollback({
        candidate,
        candidateText: stableJson(candidate),
        previous,
        rollbackEligible,
        writePointer: async (text, label) => {
          events.push(`write:${label}`)
          if (failWrite === label) throw new Error(`intentional write interruption: ${label}`)
          pointerText = text
        },
        readPointerText: async (label) => { events.push(`read:${label}`); return pointerText },
        verifyRollbackTarget: async () => { events.push('verify:rollback') },
        guardCandidate: async () => {
          events.push('guard:candidate')
          if (failCandidateGuard) throw new Error('intentional post-switch guard failure')
        },
        guardRollback: async () => { events.push('guard:rollback') },
        prepareRollback: async () => ({ ...previous }),
        recordRollback: async () => { events.push('record:rollback') },
        recordFailure: async ({ rollbackStatus }) => { events.push(`record:failure:${rollbackStatus}`) },
      })
      return { result, pointerText, events }
    } catch (error) {
      return { error, pointerText, events }
    }
  }

  const published = await activate()
  assert.deepEqual(published.result, { status: 'published', rollback_status: 'not-needed' })
  assert.equal(published.pointerText, stableJson(candidate))

  const beforeSwitchInterruption = await activate({ failWrite: 'candidate' })
  assert(beforeSwitchInterruption.error instanceof GuardedActivationError && beforeSwitchInterruption.error.rollbackStatus === 'succeeded')
  assert.equal(beforeSwitchInterruption.pointerText, stableJson(previous))

  const afterSwitchInterruption = await activate({ failCandidateGuard: true })
  assert(afterSwitchInterruption.error instanceof GuardedActivationError && afterSwitchInterruption.error.rollbackStatus === 'succeeded')
  assert.equal(afterSwitchInterruption.pointerText, stableJson(previous))

  const noSafeRollback = await activate({ rollbackEligible: false })
  assert(noSafeRollback.error instanceof GuardedActivationError && noSafeRollback.error.rollbackStatus === 'not-available')
  assert.equal(noSafeRollback.pointerText, stableJson(previous))

  return {
    pointer_switch_verified: true,
    pre_switch_interruption_rollback_verified: true,
    post_switch_failure_rollback_verified: true,
    unsafe_rollback_rejected: true,
    failure_case_count: 3,
    event_count: published.events.length,
  }
}

function verifyRunState(state, request) {
  const active = state.get(request.source_dataset_version)
  if (!active) {
    state.set(request.source_dataset_version, request.revision_id)
    return 'old_active'
  }
  if (active === request.revision_id) return 'candidate_active'
  throw new Error('conflict: candidate source dataset version is already bound to another revision')
}

export async function runHistoricalCorrectionReplay({ records, auditVersion, commitSha, rounds = 12, onRound } = {}) {
  assert(Array.isArray(records) && records.length > 0, 'records are required')
  assert(/^[a-f0-9]{40}$/.test(commitSha || ''), 'commit SHA is invalid')
  assert(typeof auditVersion === 'string' && auditVersion.length > 0, 'audit version is required')
  let previousData = { dataset_version: version(1), records: clone(records) }
  let registry = createRevocationRegistry({ generatedAt: '2026-08-06T00:00:00.000Z' })
  const state = new Map()
  const replays = []

  for (let round = 1; round <= rounds; round += 1) {
    const startedAt = performance.now()
    const targets = selectedRecords(previousData.records, round)
    const candidateSourceVersion = version(round + 1)
    const candidateDatasetVersion = version(100 + round)
    const currentData = correctedData(previousData, targets, round, candidateSourceVersion)
    const request = correctionRequest({ previousData, currentData, recordsToCorrect: targets, round, commitSha, auditVersion })
    const auditReport = { result: 'passed', audit_version: auditVersion, record_count: currentData.records.length }
    const accepted = validateHistoricalCorrection({ request, previousData, currentData, auditReport })
    assert.equal(verifyRunState(state, request), 'old_active')
    assert.equal(verifyRunState(state, request), 'candidate_active')
    const conflict = { ...request, revision_id: `revision-replay-${String(round).padStart(2, '0')}-conflict` }
    const failures = [
      rejected('unapproved_difference', () => validateHistoricalCorrection({ request: { ...request, approval_status: 'pending' }, previousData, currentData, auditReport })),
      rejected('missing_approved_change', () => validateHistoricalCorrection({ request: { ...request, changes: request.changes.slice(1) }, previousData, currentData, auditReport })),
      rejected('wrong_old_value', () => validateHistoricalCorrection({ request: { ...request, changes: request.changes.map((item, index) => index === 0 ? { ...item, old_value: '__wrong__' } : item) }, previousData, currentData, auditReport })),
      rejected('source_locator_mismatch', () => validateHistoricalCorrection({ request: { ...request, changes: request.changes.map((item, index) => index === 0 ? { ...item, source_record_locator: 'wrong-locator' } : item) }, previousData, currentData, auditReport })),
      rejected('revision_chain_break', () => validateHistoricalCorrection({ request: { ...request, source_version_chain: [previousData.dataset_version, previousData.dataset_version, currentData.dataset_version] }, previousData, currentData, auditReport })),
      rejected('conflict', () => verifyRunState(state, conflict)),
    ]
    assert(failures.every((item) => item.rejected), `round ${round}: every invalid correction must fail closed`)
    registry = appendHistoricalCorrectionRevocations(registry, {
      datasetVersion: version(100 + round - 1),
      sourceDatasetVersion: previousData.dataset_version,
      revokedAt: '2026-08-06T00:00:00.000Z',
      revisionId: accepted.revision_id,
      replacementDatasetVersion: candidateDatasetVersion,
      replacementSourceDatasetVersion: candidateSourceVersion,
      reason: 'isolated historical correction replay',
    })
    assertTargetNotRevoked(registry, { datasetVersion: candidateDatasetVersion, sourceDatasetVersion: candidateSourceVersion })
    const revokedPrevious = rejected('revoked_version_cannot_restore', () => assertTargetNotRevoked(registry, { datasetVersion: version(100 + round - 1), sourceDatasetVersion: previousData.dataset_version }))
    const pointer = await verifyGuardedPointer({ previousDatasetVersion: version(100 + round - 1), candidateDatasetVersion })
    const cloudEvidence = onRound ? await onRound({
      round,
      request: clone(request),
      registry: clone(registry),
      previous_dataset_version: version(100 + round - 1),
      previous_source_dataset_version: previousData.dataset_version,
      candidate_dataset_version: candidateDatasetVersion,
      candidate_source_dataset_version: candidateSourceVersion,
      pointer: clone(pointer),
    }) : null
    replays.push({
      round,
      status: 'passed',
      revision_id: accepted.revision_id,
      changed_record_count: accepted.changed_record_count,
      changed_field_count: accepted.changed_field_count,
      changed_month_count: new Set(targets.map((record) => record.stat_month)).size,
      failure_case_count: failures.length + 1 + pointer.failure_case_count,
      failures: [...failures, revokedPrevious],
      registry_generation: registry.generation,
      pointer,
      cloud_evidence: cloudEvidence,
      duration_ms: Math.round(performance.now() - startedAt),
    })
    previousData = currentData
  }
  return {
    format: 'housing-historical-correction-replay-v1',
    status: 'passed',
    replay_count: replays.length,
    source_commit_sha: commitSha,
    source_dataset_version: previousData.dataset_version,
    audit_version: auditVersion,
    replay_environment: 'local-in-memory',
    github_run_id: null,
    workflow_file_sha256: null,
    automatic_release_enabled: false,
    production_pointer_untouched: true,
    production_release_prefix_untouched: true,
    replays,
  }
}

async function main() {
  const [{ stdout }, dataText, auditText] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }),
    readFile(resolve(root, 'apps/web/public/data/data.json'), 'utf8'),
    readFile(resolve(root, 'data/audit-report.json'), 'utf8'),
  ])
  const data = JSON.parse(dataText)
  const audit = JSON.parse(auditText)
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true })
  const startedAt = new Date().toISOString()
  const report = await runHistoricalCorrectionReplay({ records: data.records, auditVersion: audit.audit_version, commitSha: stdout.trim(), rounds: requestedRounds })
  report.run_id = runId
  report.app_version = require(resolve(root, 'apps/miniprogram/config/version.js')).version
  report.started_at = startedAt
  report.completed_at = new Date().toISOString()
  report.report_sha256 = createHash('sha256').update(JSON.stringify(report)).digest('hex')
  await writeFile(resolve(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ status: report.status, replay_count: report.replay_count, report: resolve(outputRoot, 'report.json') }))
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main()
