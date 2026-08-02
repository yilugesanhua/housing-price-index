import { createHash } from 'node:crypto'
import { appendFile, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DATASET_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/

function assert(condition, message) {
  if (!condition) throw new Error(`Monitor control event registration rejected: ${message}`)
}

function parseRecord(record) {
  assert(record && typeof record.fileName === 'string' && typeof record.text === 'string', 'audit record is invalid')
  try {
    const audit = JSON.parse(record.text)
    assert(audit && typeof audit === 'object' && !Array.isArray(audit), `${record.fileName} is not a JSON object`)
    return { ...record, audit }
  } catch (error) {
    if (error?.message?.startsWith('Monitor control event registration rejected:')) throw error
    throw new Error(`Monitor control event registration rejected: ${record.fileName} is not valid JSON`)
  }
}

function canonicalTime(value, label) {
  const timestamp = Date.parse(value || '')
  assert(Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value, `${label} is not canonical`)
  return timestamp
}

export function selectAutomaticRollbackRegistration(records, {
  expectedCommitSha,
  expectedGithubRunId,
  expectedCloudEnvId = 'cloud1-d3gpdx70w5d05c68c',
} = {}) {
  assert(Array.isArray(records), 'audit record list is invalid')
  assert(/^[a-f0-9]{40}$/.test(expectedCommitSha || ''), 'expected commit identity is invalid')
  assert(/^\d+$/.test(String(expectedGithubRunId || '')), 'expected GitHub run identity is invalid')
  const parsed = records.map(parseRecord)
  const matchingEvents = parsed.filter(({ fileName, audit }) => (
    fileName.startsWith('rollback-')
    && fileName.endsWith('.json')
    && audit.status === 'automatically_rolled_back'
    && String(audit.github_run_id || '') === String(expectedGithubRunId)
  ))
  if (!matchingEvents.length) return { registered: false }
  assert(matchingEvents.length === 1, 'publishing run produced multiple automatic rollback events')

  const event = matchingEvents[0]
  const { audit } = event
  canonicalTime(audit.rolled_back_at, `${event.fileName} rolled_back_at`)
  assert(event.fileName === `rollback-${audit.rolled_back_at.replace(/[:.]/g, '-')}.json`, 'automatic rollback filename is not canonical')
  assert(audit.cloud_env_id === expectedCloudEnvId, 'automatic rollback cloud environment is invalid')
  assert(audit.commit_sha === expectedCommitSha, 'automatic rollback commit identity is invalid')
  assert(DATASET_PATTERN.test(audit.from_dataset_version || ''), 'automatic rollback source dataset is invalid')
  assert(DATASET_PATTERN.test(audit.to_dataset_version || ''), 'automatic rollback target dataset is invalid')
  assert(audit.from_dataset_version !== audit.to_dataset_version, 'automatic rollback is self-referential')
  assert(/^[a-f0-9]{64}$/.test(audit.current_sha256 || ''), 'automatic rollback pointer hash is invalid')

  const failureFileName = `failed-publish-${audit.rolled_back_at.replace(/[:.]/g, '-')}.json`
  const failures = parsed.filter((record) => record.fileName === failureFileName)
  assert(failures.length === 1, 'matching failed-publish audit is missing or duplicated')
  const failure = failures[0].audit
  assert(failure.status === 'post_publish_guard_failed', 'matching failure status is invalid')
  assert(failure.failed_at === audit.rolled_back_at, 'failure and rollback timestamps differ')
  assert(failure.dataset_version === audit.from_dataset_version, 'failure and rollback source datasets differ')
  assert(failure.previous_dataset_version === audit.to_dataset_version, 'failure and rollback target datasets differ')
  assert(failure.cloud_env_id === expectedCloudEnvId, 'failure cloud environment is invalid')
  assert(String(failure.github_run_id || '') === String(expectedGithubRunId), 'failure GitHub run identity is invalid')
  assert(failure.commit_sha === expectedCommitSha, 'failure commit identity is invalid')
  assert(failure.rollback_status === 'succeeded' && failure.rollback_error === null, 'failure audit does not prove a successful rollback')

  const releaseFileName = `${audit.to_dataset_version}.json`
  const releases = parsed.filter((record) => record.fileName === releaseFileName)
  assert(releases.length === 1, 'rollback target immutable publish audit is missing or duplicated')
  assert(releases[0].audit.status === 'published'
    && releases[0].audit.dataset_version === audit.to_dataset_version
    && releases[0].audit.cloud_env_id === expectedCloudEnvId,
  'rollback target immutable publish audit is invalid')
  assert(!parsed.some((record) => record.fileName === `${audit.to_dataset_version}.correction.json`),
    'rollback target is disabled by a correction audit')

  return {
    registered: true,
    datasetVersion: audit.to_dataset_version,
    eventFileName: event.fileName,
    eventSha256: createHash('sha256').update(event.text).digest('hex'),
    failureFileName,
    failureSha256: createHash('sha256').update(failures[0].text).digest('hex'),
  }
}

async function readRecords(directory) {
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'))
  return Promise.all(names.map(async (fileName) => ({
    fileName,
    text: await readFile(resolve(directory, fileName), 'utf8'),
  })))
}

async function main() {
  const directory = resolve(process.cwd(), 'data/releases')
  const result = selectAutomaticRollbackRegistration(await readRecords(directory), {
    expectedCommitSha: process.env.EXPECTED_COMMIT_SHA,
    expectedGithubRunId: process.env.EXPECTED_GITHUB_RUN_ID,
  })
  assert(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT is required')
  const output = [
    `registered=${result.registered}`,
    `dataset_version=${result.datasetVersion || ''}`,
    `event_path=${result.eventFileName ? `data/releases/${result.eventFileName}` : ''}`,
    `event_sha256=${result.eventSha256 || ''}`,
    `failure_path=${result.failureFileName ? `data/releases/${result.failureFileName}` : ''}`,
    `failure_sha256=${result.failureSha256 || ''}`,
  ].join('\n')
  await appendFile(process.env.GITHUB_OUTPUT, `${output}\n`, 'utf8')
  console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
