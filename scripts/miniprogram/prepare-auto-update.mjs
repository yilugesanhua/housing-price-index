import { execFile } from 'node:child_process'
import { glob, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { validateCandidateData } from './candidate-data-gate.mjs'
import { sha256 } from './remote-data-lib.mjs'
import { buildReleaseKey, readState, transitionState, writeState } from './auto-update-state.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const discoveryGatePath = resolve(argument('discovery-gate') || 'work/auto-release/discovery-gate.json')
const calendarPath = resolve(argument('calendar') || 'work/monthly-data-check/release-calendar.json')
const outputRoot = resolve(root, 'work/auto-release')
const candidateRoot = resolve(outputRoot, 'candidate')
const candidateDataRoot = resolve(candidateRoot, 'web-data')
const candidateNormalizedRoot = resolve(candidateRoot, 'normalized')
const candidateAuditPath = resolve(candidateRoot, 'audit-report.json')
const candidateSnapshotPath = resolve(candidateRoot, 'snapshot.cjs')
const snapshotCodecPath = resolve(root, 'apps/miniprogram/utils/snapshot-codec.js')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

async function run(args, envPatch = {}) {
  const result = await execFileAsync(npm, args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: { ...process.env, ...envPatch } })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
}

async function matchingBatch(month, officialUrl) {
  const matches = []
  for await (const path of await glob(`data/raw/${month}/*.batch.json`)) {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (parsed.source_batch.source_url === officialUrl || parsed.source_batch.final_url === officialUrl) matches.push({ path, parsed })
  }
  if (matches.length !== 1) throw new Error(`Expected one fetched source batch for ${month}; got ${matches.length}`)
  return matches[0]
}

async function readExistingIdentity(expectedMonth) {
  const state = await readState(resolve(root, 'data/releases/auto-update-state.json'))
  if (!state) return null
  if (state.dataset_as_of !== expectedMonth) throw new Error('Existing auto-update state belongs to another statistical month')
  if (!state.time_seed || !Number.isFinite(Date.parse(state.time_seed))) throw new Error('Existing auto-update state has no valid time seed')
  return state
}

async function prepareIdentity(discoveryGate, fetched, calendar) {
  const statePath = resolve(root, 'data/releases/auto-update-state.json')
  const existing = await readState(statePath)
  const source = fetched.parsed.source_batch
  const releaseKey = buildReleaseKey(discoveryGate.expected_stat_month, source.raw_content_sha256)
  if (existing && existing.release_key !== releaseKey) throw new Error('Existing auto-update state belongs to another official source')
  const timeSeed = existing?.time_seed || source.fetched_at
  const entry = calendar.entries?.find((item) => item.expected_stat_month === discoveryGate.expected_stat_month)
  const nextCheckAt = existing?.next_check_at || (entry ? new Date(Date.parse(entry.scheduled_at) + 10 * 60 * 1000).toISOString() : null)
  if (!nextCheckAt) throw new Error('Cannot derive stable next_check_at for automatic candidate')
  process.env.AUTO_RELEASE_TIME_SEED = timeSeed
  process.env.AUTO_RELEASE_NEXT_CHECK_AT = nextCheckAt
  await writeState(statePath, existing
    ? transitionState(existing, 'preparing', {
      official_url: discoveryGate.official_url,
      discovery_run_id: existing.discovery_run_id || discoveryGate.discovery_run_id,
      idempotency_key: existing.idempotency_key || discoveryGate.idempotency_key,
      time_seed: timeSeed,
      next_check_at: nextCheckAt,
      release_key: releaseKey,
      updated_at: timeSeed,
    })
    : {
      status: 'preparing',
      format: 'housing-data-auto-update-state-v1',
      official_url: discoveryGate.official_url,
      discovery_run_id: discoveryGate.discovery_run_id,
      idempotency_key: discoveryGate.idempotency_key,
      release_key: releaseKey,
      dataset_as_of: discoveryGate.expected_stat_month,
      source_raw_sha256: source.raw_content_sha256,
      time_seed: timeSeed,
      next_check_at: nextCheckAt,
      updated_at: timeSeed,
    })
  return { releaseKey, timeSeed, nextCheckAt, discoveryRunId: existing?.discovery_run_id || discoveryGate.discovery_run_id, idempotencyKey: existing?.idempotency_key || discoveryGate.idempotency_key }
}

await mkdir(outputRoot, { recursive: true })
await rm(candidateRoot, { recursive: true, force: true })
await mkdir(candidateRoot, { recursive: true })
const startedAt = new Date().toISOString()
try {
  const discoveryGate = JSON.parse(await readFile(discoveryGatePath, 'utf8'))
  if (discoveryGate.status !== 'passed') throw new Error('Discovery gate has not passed')
  if (!/^cloud[\w-]+$/.test(cloudEnvId)) throw new Error('Cloud environment ID is invalid')
  // The source batch records fetched_at. Set the persisted seed before the
  // download, otherwise a retry would still produce different raw evidence.
  const existingIdentity = await readExistingIdentity(discoveryGate.expected_stat_month)
  if (existingIdentity) process.env.AUTO_RELEASE_TIME_SEED = new Date(existingIdentity.time_seed).toISOString()
  const previousPayload = JSON.parse(await readFile(resolve(root, 'apps/web/public/data/data.json'), 'utf8'))
  await run(['run', 'data:fetch', '--', discoveryGate.official_url])
  const fetched = await matchingBatch(discoveryGate.expected_stat_month, discoveryGate.official_url)
  const calendar = JSON.parse(await readFile(calendarPath, 'utf8'))
  const identity = await prepareIdentity(discoveryGate, fetched, calendar)
  const candidateEnv = {
    AUTO_RELEASE_OUTPUT_ROOT: candidateDataRoot,
    AUTO_RELEASE_PREVIOUS_OUTPUT_ROOT: resolve(root, 'apps/web/public/data'),
    AUTO_RELEASE_NORMALIZED_ROOT: candidateNormalizedRoot,
    AUTO_RELEASE_PREVIOUS_NORMALIZED_ROOT: resolve(root, 'data/normalized'),
    AUTO_RELEASE_AUDIT_REPORT_PATH: candidateAuditPath,
  }
  await run(['run', 'data:audit', '--', fetched.path], { AUTO_RELEASE_AUDIT_REPORT_PATH: candidateAuditPath })
  await run(['run', 'data:audit', '--', '--report-only'], { AUTO_RELEASE_AUDIT_REPORT_PATH: candidateAuditPath })
  const verifiedBatch = JSON.parse(await readFile(fetched.path, 'utf8'))
  await run(['run', 'data:publish'], candidateEnv)
  const candidatePayload = JSON.parse(await readFile(resolve(candidateDataRoot, 'data.json'), 'utf8'))
  const dataGate = validateCandidateData({ previousPayload, candidatePayload, expectedMonth: discoveryGate.expected_stat_month, sourceBatch: verifiedBatch.source_batch })
  await writeFile(resolve(outputRoot, 'data-gate.json'), `${JSON.stringify(dataGate, null, 2)}\n`, 'utf8')
  await run(['run', 'miniprogram:data', '--', `--data-root=${candidateDataRoot}`, `--output=${candidateSnapshotPath}`, `--codec=${snapshotCodecPath}`])
  await run(['run', 'miniprogram:data:stage', '--', `--calendar=${calendarPath}`, `--next-check-at=${identity.nextCheckAt}`, `--env=${cloudEnvId}`, `--data-root=${candidateDataRoot}`, `--snapshot=${candidateSnapshotPath}`, `--audit-root=${candidateRoot}`, `--output-root=${candidateRoot}/remote-data`, `--latest-candidate=${candidateRoot}/latest-candidate.json`])
  const latestCandidate = JSON.parse(await readFile(resolve(candidateRoot, 'latest-candidate.json'), 'utf8'))
  const remoteCandidateRoot = resolve(candidateRoot, 'remote-data', latestCandidate.dataset_version)
  await run(['run', 'miniprogram:data:verify-remote', '--', `--dir=${remoteCandidateRoot}`, `--snapshot=${candidateSnapshotPath}`])
  await run(['run', 'check'])
  await run(['run', 'test:e2e'])
  const latest = latestCandidate
  const releaseReportPath = resolve(remoteCandidateRoot, 'release-report.json')
  const releaseReportText = await readFile(releaseReportPath, 'utf8')
  const releaseReport = JSON.parse(releaseReportText)
  if (releaseReport.dataset_as_of !== discoveryGate.expected_stat_month || releaseReport.cloud_env_id !== cloudEnvId) throw new Error('Staged release does not match the discovery gate')
  const gateReport = {
    format: 'housing-data-production-gate-v1',
    status: 'passed',
    cloud_env_id: cloudEnvId,
    dataset_version: latest.dataset_version,
    source_dataset_version: latest.source_dataset_version,
    dataset_as_of: releaseReport.dataset_as_of,
    official_url: discoveryGate.official_url,
    discovery_run_id: identity.discoveryRunId,
    discovery_commit_sha: discoveryGate.discovery_commit_sha,
    producer_commit_sha: process.env.GITHUB_SHA || discoveryGate.discovery_commit_sha,
    commit_sha: process.env.GITHUB_SHA || discoveryGate.discovery_commit_sha,
    candidate_run_id: process.env.GITHUB_RUN_ID || null,
    idempotency_key: identity.idempotencyKey,
    release_key: identity.releaseKey,
    time_seed: identity.timeSeed,
    next_check_at: identity.nextCheckAt,
    source_batch_id: dataGate.source_batch_id,
    source_raw_sha256: dataGate.source_raw_sha256,
    historical_revision_count: 0,
    added_record_count: dataGate.added_record_count,
    manifest_sha256: releaseReport.manifest_sha256,
    release_report_sha256: sha256(releaseReportText),
    checks: ['official-source-refetch', 'full-record-audit', 'zero-historical-mutation', '70-city-completeness', 'validate:data', 'check', 'test:e2e', 'test:miniprogram', 'remote-snapshot-reconstruction'],
    started_at: identity.timeSeed,
    passed_at: identity.timeSeed,
  }
  await writeFile(resolve(outputRoot, 'gate-report.json'), `${JSON.stringify(gateReport, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(gateReport))
} catch (error) {
  const failure = { format: 'housing-data-production-gate-v1', status: 'failed', cloud_env_id: cloudEnvId, started_at: startedAt, failed_at: new Date().toISOString(), error: String(error?.message || error).slice(0, 1000) }
  await writeFile(resolve(outputRoot, 'gate-report.json'), `${JSON.stringify(failure, null, 2)}\n`, 'utf8')
  const statePath = resolve(root, 'data/releases/auto-update-state.json')
  const existing = await readState(statePath)
  if (existing) await writeState(statePath, transitionState(existing, 'failed', { error: failure.error, updated_at: failure.failed_at }))
  throw error
}
