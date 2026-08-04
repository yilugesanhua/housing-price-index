import { createHash } from 'node:crypto'
import { appendFile, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { selectAutomaticRollbackRegistration } from './register-monitor-control-event.mjs'

const DATASET_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const RELEASE_FILE_PATTERN = /^(20\d{2}-(?:0[1-9]|1[0-2])-[a-f0-9]{12})\.json$/
const CORRECTION_FILE_PATTERN = /^(20\d{2}-(?:0[1-9]|1[0-2])-[a-f0-9]{12})\.correction\.json$/
const RUN_ATTEMPT_PATTERN = /^[1-9]\d*$/
const MANUAL_ROLLBACK_AUDIT_SCHEMA_VERSION = 'manual-data-rollback-audit-v4'
const MONITORED_WORKFLOWS = new Set([
  'monthly-data-auto-publish',
  'monthly-data-pending-publish',
  'manual-corrected-data-publish',
  'historical-data-correction',
  'complete-history-data-publish',
  'manual-data-rollback',
])
const WINDOW_MS = 24 * 60 * 60 * 1000

function assert(condition, message) {
  if (!condition) throw new Error(`Post-publish monitor target rejected: ${message}`)
}

function canonicalTime(value, label) {
  const time = Date.parse(value || '')
  assert(Number.isFinite(time) && new Date(time).toISOString() === value, `${label} is not a canonical timestamp`)
  return time
}

function parseRecord(record) {
  assert(record && typeof record.fileName === 'string', 'release ledger record is invalid')
  if (record.audit && typeof record.audit === 'object') return record
  assert(typeof record.text === 'string', `${record.fileName} bytes are missing`)
  try {
    const audit = JSON.parse(record.text)
    assert(audit && typeof audit === 'object' && !Array.isArray(audit), `${record.fileName} is not a JSON object`)
    return { ...record, audit }
  } catch (error) {
    if (error?.message?.startsWith('Post-publish monitor target rejected:')) throw error
    throw new Error(`Post-publish monitor target rejected: ${record.fileName} is not valid JSON`)
  }
}

function recordBytes(record) {
  return typeof record.text === 'string' ? record.text : `${JSON.stringify(record.audit, null, 2)}\n`
}

function recordSha256(record) {
  return createHash('sha256').update(recordBytes(record)).digest('hex')
}

function validateRelease(record, datasetVersion, expectedCloudEnvId) {
  const { audit, fileName } = record
  assert(audit.status === 'published', `${fileName} is not a successful publish audit`)
  assert(audit.dataset_version === datasetVersion, `${fileName} dataset identity does not match its filename`)
  assert(audit.cloud_env_id === expectedCloudEnvId, `${fileName} targets a different cloud environment`)
  assert(/^[a-f0-9]{64}$/.test(audit.manifest_sha256 || ''), `${fileName} manifest hash is invalid`)
  if (audit.release_type === 'historical_correction') {
    assert(/^revision-[a-z0-9][a-z0-9-]{5,80}$/.test(audit.revision_id || ''), `${fileName} revision identity is invalid`)
  }
  return {
    audit,
    datasetVersion,
    fileName,
    publishedAt: canonicalTime(audit.published_at, `${fileName} published_at`),
    releaseAuditSha256: recordSha256(record),
  }
}

function rollbackTransition(record, records, releases, expectedCloudEnvId) {
  const { audit, fileName } = record
  if (!['rolled_back', 'automatically_rolled_back'].includes(audit.status)) return null
  assert(DATASET_PATTERN.test(audit.to_dataset_version || ''), `${fileName} rollback target is invalid`)
  assert(DATASET_PATTERN.test(audit.from_dataset_version || ''), `${fileName} rollback source is invalid`)
  assert(audit.from_dataset_version !== audit.to_dataset_version, `${fileName} rollback is self-referential`)
  assert(audit.cloud_env_id === expectedCloudEnvId, `${fileName} targets a different cloud environment`)
  assert(/^\d+$/.test(String(audit.github_run_id || '')), `${fileName} GitHub run identity is invalid`)
  assert(/^[a-f0-9]{40}$/.test(audit.commit_sha || ''), `${fileName} commit identity is invalid`)
  const isManualRollback = audit.status === 'rolled_back'
  if (isManualRollback) {
    assert(audit.audit_schema_version === MANUAL_ROLLBACK_AUDIT_SCHEMA_VERSION,
      `${fileName} manual rollback audit schema is invalid`)
  }
  const controlEventRunId = String(isManualRollback ? audit.finalizer_github_run_id : audit.github_run_id || '')
  const controlEventRunAttempt = String(isManualRollback ? audit.finalizer_github_run_attempt : audit.github_run_attempt || '')
  const controlEventCommitSha = isManualRollback ? audit.finalizer_commit_sha : audit.commit_sha
  assert(/^\d+$/.test(controlEventRunId), `${fileName} finalizer run identity is invalid`)
  assert(!isManualRollback || RUN_ATTEMPT_PATTERN.test(controlEventRunAttempt), `${fileName} finalizer run attempt identity is invalid`)
  assert(isManualRollback || !controlEventRunAttempt || RUN_ATTEMPT_PATTERN.test(controlEventRunAttempt), `${fileName} origin run attempt identity is invalid`)
  assert(/^[a-f0-9]{40}$/.test(controlEventCommitSha || ''), `${fileName} finalizer commit identity is invalid`)
  assert(releases.has(audit.to_dataset_version), `${fileName} rollback target has no immutable publish audit`)
  const occurredAt = canonicalTime(audit.rolled_back_at, `${fileName} rolled_back_at`)
  const canonicalSuffix = audit.rolled_back_at.replace(/[:.]/g, '-')
  const expectedFileName = audit.status === 'rolled_back'
    ? `manual-data-rollback-${canonicalSuffix}.json`
    : `rollback-${canonicalSuffix}.json`
  assert(fileName === expectedFileName, `${fileName} is not the canonical rollback audit filename`)
  if (audit.status === 'automatically_rolled_back') {
    const registration = selectAutomaticRollbackRegistration(records, {
      expectedCommitSha: audit.commit_sha,
      expectedGithubRunId: audit.github_run_id,
      expectedCloudEnvId,
    })
    assert(registration.registered && registration.eventFileName === fileName,
      `${fileName} lacks matching successful automatic rollback proof`)
  }
  return {
    audit,
    controlEventCommitSha,
    controlEventRunId,
    controlEventRunAttempt,
    controlEventSha256: recordSha256(record),
    datasetVersion: audit.to_dataset_version,
    fileName,
    occurredAt,
    type: audit.status === 'rolled_back' ? 'manual_rollback' : 'automatic_rollback',
  }
}

function supersededDataset(record) {
  const match = record.fileName.match(CORRECTION_FILE_PATTERN)
  if (!match) return null
  const { audit, fileName } = record
  assert(audit.dataset_version === match[1], `${fileName} dataset identity does not match its filename`)
  assert(typeof audit.status === 'string' && audit.status.startsWith('superseded_'), `${fileName} supersession status is invalid`)
  assert(audit.rollback_allowed === false, `${fileName} does not fail closed for rollback`)
  return match[1]
}

export function selectMonitorTarget(records, {
  now = Date.now(),
  windowMs = WINDOW_MS,
  eventName = 'schedule',
  manualDatasetVersion = '',
  defaultBranch = '',
  triggerConclusion = '',
  triggerHeadBranch = '',
  triggerRunId = '',
  triggerRunAttempt = '',
  triggerWorkflowName = '',
  expectedCloudEnvId = 'cloud1-d3gpdx70w5d05c68c',
} = {}) {
  assert(Array.isArray(records) && Number.isFinite(now) && Number.isSafeInteger(windowMs) && windowMs > 0,
    'monitor target selection inputs are invalid')
  const parsedRecords = records.map(parseRecord)
  const releases = new Map()
  for (const record of parsedRecords) {
    const match = record.fileName.match(RELEASE_FILE_PATTERN)
    if (!match) continue
    const release = validateRelease(record, match[1], expectedCloudEnvId)
    assert(!releases.has(release.datasetVersion), `duplicate publish audit for ${release.datasetVersion}`)
    releases.set(release.datasetVersion, release)
  }

  const transitions = [...releases.values()].map((release) => ({
    audit: release.audit,
    controlEventRunAttempt: String(release.audit.github_run_attempt || ''),
    controlEventSha256: release.releaseAuditSha256,
    datasetVersion: release.datasetVersion,
    fileName: release.fileName,
    occurredAt: release.publishedAt,
    type: 'publish',
  }))
  for (const record of parsedRecords) {
    const rollback = rollbackTransition(record, parsedRecords, releases, expectedCloudEnvId)
    if (rollback) transitions.push(rollback)
  }
  transitions.sort((left, right) => left.occurredAt - right.occurredAt || left.fileName.localeCompare(right.fileName, 'en'))
  for (let index = 1; index < transitions.length; index += 1) {
    const previous = transitions[index - 1]
    const current = transitions[index]
    assert(previous.occurredAt !== current.occurredAt || previous.datasetVersion === current.datasetVersion,
      `latest monitor events have an ambiguous dataset identity at ${new Date(current.occurredAt).toISOString()}`)
  }

  const latestTransition = transitions.at(-1)
  if (!latestTransition) return { active: false, datasetVersion: '', reason: 'no_publish_audit' }
  assert(latestTransition.occurredAt <= now, `${latestTransition.fileName} is dated in the future`)
  const release = releases.get(latestTransition.datasetVersion)
  assert(release, 'active transition has no immutable publish audit')
  assert(!parsedRecords.map(supersededDataset).includes(release.datasetVersion),
    `current active release ${release.datasetVersion} is marked as superseded`)
  assert(DATASET_PATTERN.test(release.audit.source_dataset_version || ''),
    `${release.fileName} source dataset identity is invalid`)
  assert(/^\d+$/.test(String(latestTransition.controlEventRunId || latestTransition.audit.github_run_id || '')),
    `${latestTransition.fileName} GitHub run identity is invalid`)
  assert(!latestTransition.controlEventRunAttempt || RUN_ATTEMPT_PATTERN.test(latestTransition.controlEventRunAttempt),
    `${latestTransition.fileName} GitHub run attempt identity is invalid`)
  assert(/^[a-f0-9]{40}$/.test(latestTransition.controlEventCommitSha || latestTransition.audit.commit_sha || ''),
    `${latestTransition.fileName} commit identity is invalid`)

  const age = now - latestTransition.occurredAt
  const withinWindow = age >= 0 && age <= windowMs
  let active = false
  let reason = 'outside_24_hour_window'
  if (eventName === 'schedule') {
    active = withinWindow
    if (active) reason = 'scheduled_active_release'
  } else if (eventName === 'workflow_run') {
    const acceptedConclusion = latestTransition.type === 'automatic_rollback'
      ? ['failure', 'success'].includes(triggerConclusion)
      : triggerConclusion === 'success'
    const trustedTrigger = MONITORED_WORKFLOWS.has(triggerWorkflowName)
      && acceptedConclusion
      && Boolean(defaultBranch)
      && triggerHeadBranch === defaultBranch
    const exactRun = String(latestTransition.controlEventRunId || latestTransition.audit.github_run_id || '') === String(triggerRunId || '')
      && (!latestTransition.controlEventRunAttempt || latestTransition.controlEventRunAttempt === String(triggerRunAttempt || ''))
    active = trustedTrigger && exactRun && withinWindow
    reason = active ? 'successful_publish_workflow' : 'workflow_run_does_not_match_active_release'
  } else if (eventName === 'workflow_dispatch') {
    assert(DATASET_PATTERN.test(manualDatasetVersion), 'manual dataset version is invalid')
    assert(manualDatasetVersion === release.datasetVersion, 'manual dataset version is not the current active release')
    active = true
    reason = 'manual_active_release'
  } else {
    throw new Error(`Post-publish monitor target rejected: unsupported event ${eventName || '<empty>'}`)
  }

  return {
    active,
    datasetVersion: release.datasetVersion,
    controlEventCommitSha: latestTransition.controlEventCommitSha || latestTransition.audit.commit_sha,
    controlEventFileName: latestTransition.fileName,
    controlEventRunId: String(latestTransition.controlEventRunId || latestTransition.audit.github_run_id || ''),
    controlEventRunAttempt: latestTransition.controlEventRunAttempt,
    controlEventSha256: latestTransition.controlEventSha256,
    controlEventType: latestTransition.type,
    controlEventAt: new Date(latestTransition.occurredAt).toISOString(),
    publishedAt: release.audit.published_at,
    publishRunId: String(release.audit.github_run_id || ''),
    revisionId: release.audit.revision_id || '',
    releaseAuditSha256: release.releaseAuditSha256,
    reason,
  }
}

export async function readMonitorRecords(root) {
  const releaseRoot = resolve(root, 'data/releases')
  const names = (await readdir(releaseRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'))
  return Promise.all(names.map(async (fileName) => ({
    fileName,
    text: await readFile(resolve(releaseRoot, fileName), 'utf8'),
  })))
}

async function main() {
  const selected = selectMonitorTarget(await readMonitorRecords(process.cwd()), {
    eventName: process.env.GITHUB_EVENT_NAME,
    manualDatasetVersion: String(process.env.MANUAL_DATASET_VERSION || '').trim(),
    defaultBranch: process.env.DEFAULT_BRANCH || '',
    triggerConclusion: process.env.TRIGGER_CONCLUSION || '',
    triggerHeadBranch: process.env.TRIGGER_HEAD_BRANCH || '',
    triggerRunId: process.env.TRIGGER_RUN_ID || '',
    triggerRunAttempt: process.env.TRIGGER_RUN_ATTEMPT || '',
    triggerWorkflowName: process.env.TRIGGER_WORKFLOW_NAME || '',
  })
  assert(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT is required')
  const output = [
    `active=${selected.active}`,
    `dataset_version=${selected.datasetVersion}`,
    `control_event_commit_sha=${selected.controlEventCommitSha || ''}`,
    `control_event_file_name=${selected.controlEventFileName || ''}`,
    `control_event_run_id=${selected.controlEventRunId || ''}`,
    `control_event_run_attempt=${selected.controlEventRunAttempt || ''}`,
    `control_event_sha256=${selected.controlEventSha256 || ''}`,
    `control_event_type=${selected.controlEventType || ''}`,
    `control_event_at=${selected.controlEventAt || ''}`,
    `published_at=${selected.publishedAt || ''}`,
    `publish_run_id=${selected.publishRunId || ''}`,
    `revision_id=${selected.revisionId || ''}`,
    `release_audit_sha256=${selected.releaseAuditSha256 || ''}`,
    `reason=${selected.reason}`,
  ].join('\n')
  await appendFile(process.env.GITHUB_OUTPUT, `${output}\n`, 'utf8')
  console.log(JSON.stringify(selected))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
