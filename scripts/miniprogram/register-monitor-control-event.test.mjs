import assert from 'node:assert/strict'
import test from 'node:test'

import { selectAutomaticRollbackRegistration } from './register-monitor-control-event.mjs'

const FROM = '2026-07-222222222222'
const TO = '2026-06-111111111111'
const RUN_ID = '200'
const RUN_ATTEMPT = '1'
const COMMIT_SHA = 'b'.repeat(40)
const ENV_ID = 'cloud1-d3gpdx70w5d05c68c'
const STORAGE_BUCKET = '636c-cloud1-d3gpdx70w5d05c68c-1456861154'
const ROLLED_BACK_AT = '2026-08-01T02:00:00.000Z'

function record(fileName, audit) {
  return { fileName, text: `${JSON.stringify(audit, null, 2)}\n` }
}

function validRecords() {
  return [
    record(`${TO}.json`, {
      status: 'published', cloud_env_id: ENV_ID, storage_bucket: STORAGE_BUCKET,
      dataset_version: TO, source_dataset_version: '2026-06-000000000000',
      manifest_sha256: 'a'.repeat(64), published_at: '2026-08-01T01:30:00.000Z',
      github_run_id: '100', github_run_attempt: RUN_ATTEMPT, commit_sha: 'a'.repeat(40),
    }),
    record('rollback-2026-08-01T02-00-00-000Z.json', {
      status: 'automatically_rolled_back', rolled_back_at: ROLLED_BACK_AT,
      from_dataset_version: FROM, to_dataset_version: TO, cloud_env_id: ENV_ID, storage_bucket: STORAGE_BUCKET,
      current_sha256: 'e'.repeat(64), github_run_id: RUN_ID, github_run_attempt: RUN_ATTEMPT, commit_sha: COMMIT_SHA,
    }),
    record('failed-publish-2026-08-01T02-00-00-000Z.json', {
      status: 'post_publish_guard_failed', failed_at: ROLLED_BACK_AT,
      dataset_version: FROM, previous_dataset_version: TO, cloud_env_id: ENV_ID, storage_bucket: STORAGE_BUCKET,
      rollback_status: 'succeeded', rollback_error: null,
      github_run_id: RUN_ID, github_run_attempt: RUN_ATTEMPT, commit_sha: COMMIT_SHA,
    }),
  ]
}

test('registers one exact successful automatic rollback and its matching failure audit', () => {
  const result = selectAutomaticRollbackRegistration(validRecords(), {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
    expectedGithubRunAttempt: RUN_ATTEMPT,
  })
  assert.equal(result.registered, true)
  assert.equal(result.datasetVersion, TO)
  assert.equal(result.eventFileName, 'rollback-2026-08-01T02-00-00-000Z.json')
  assert.equal(result.failureFileName, 'failed-publish-2026-08-01T02-00-00-000Z.json')
  assert.match(result.eventSha256, /^[a-f0-9]{64}$/)
  assert.match(result.failureSha256, /^[a-f0-9]{64}$/)
})

test('normal failures without a successful automatic rollback do not create a monitor event', () => {
  const result = selectAutomaticRollbackRegistration(validRecords().filter(({ fileName }) => !fileName.startsWith('rollback-')), {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
    expectedGithubRunAttempt: RUN_ATTEMPT,
  })
  assert.deepEqual(result, { registered: false })
})

test('missing failure proof, wrong commit, and a disabled target fail closed', () => {
  assert.throws(() => selectAutomaticRollbackRegistration(validRecords().filter(({ fileName }) => !fileName.startsWith('failed-publish-')), {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
    expectedGithubRunAttempt: RUN_ATTEMPT,
  }), /failed-publish audit is missing or duplicated/)

  assert.throws(() => selectAutomaticRollbackRegistration(validRecords(), {
    expectedCommitSha: 'c'.repeat(40),
    expectedGithubRunId: RUN_ID,
    expectedGithubRunAttempt: RUN_ATTEMPT,
  }), /commit identity is invalid/)

  const disabled = [...validRecords(), record(`${TO}.correction.json`, {
    status: 'superseded_invalid_pointer', dataset_version: TO, rollback_allowed: false,
  })]
  assert.throws(() => selectAutomaticRollbackRegistration(disabled, {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
    expectedGithubRunAttempt: RUN_ATTEMPT,
  }), /disabled by a correction audit/)
})

test('rollback status and run identity cannot be borrowed from another failure', () => {
  const records = validRecords()
  const failure = JSON.parse(records[2].text)
  failure.rollback_status = 'failed'
  records[2] = record(records[2].fileName, failure)
  assert.throws(() => selectAutomaticRollbackRegistration(records, {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
    expectedGithubRunAttempt: RUN_ATTEMPT,
  }), /does not prove a successful rollback/)

  assert.deepEqual(selectAutomaticRollbackRegistration(validRecords(), {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: '999',
    expectedGithubRunAttempt: RUN_ATTEMPT,
  }), { registered: false })
})

test('automatic rollback registration binds the exact attempt and storage bucket', () => {
  assert.deepEqual(selectAutomaticRollbackRegistration(validRecords(), {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
    expectedGithubRunAttempt: '2',
  }), { registered: false })

  const wrongFailureAttempt = validRecords()
  const failure = JSON.parse(wrongFailureAttempt[2].text)
  failure.github_run_attempt = '2'
  wrongFailureAttempt[2] = record(wrongFailureAttempt[2].fileName, failure)
  assert.throws(() => selectAutomaticRollbackRegistration(wrongFailureAttempt, {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
    expectedGithubRunAttempt: RUN_ATTEMPT,
  }), /failure GitHub run attempt is invalid/)

  const wrongRollbackBucket = validRecords()
  const rollback = JSON.parse(wrongRollbackBucket[1].text)
  rollback.storage_bucket = 'other-bucket'
  wrongRollbackBucket[1] = record(wrongRollbackBucket[1].fileName, rollback)
  assert.throws(() => selectAutomaticRollbackRegistration(wrongRollbackBucket, {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
    expectedGithubRunAttempt: RUN_ATTEMPT,
  }), /automatic rollback storage bucket is invalid/)

  assert.throws(() => selectAutomaticRollbackRegistration(validRecords(), {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
    expectedGithubRunAttempt: '',
  }), /expected GitHub run attempt is invalid/)
})
