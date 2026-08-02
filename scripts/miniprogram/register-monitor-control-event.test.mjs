import assert from 'node:assert/strict'
import test from 'node:test'

import { selectAutomaticRollbackRegistration } from './register-monitor-control-event.mjs'

const FROM = '2026-07-222222222222'
const TO = '2026-06-111111111111'
const RUN_ID = '200'
const COMMIT_SHA = 'b'.repeat(40)
const ENV_ID = 'cloud1-d3gpdx70w5d05c68c'
const ROLLED_BACK_AT = '2026-08-01T02:00:00.000Z'

function record(fileName, audit) {
  return { fileName, text: `${JSON.stringify(audit, null, 2)}\n` }
}

function validRecords() {
  return [
    record(`${TO}.json`, {
      status: 'published', cloud_env_id: ENV_ID, dataset_version: TO,
    }),
    record('rollback-2026-08-01T02-00-00-000Z.json', {
      status: 'automatically_rolled_back', rolled_back_at: ROLLED_BACK_AT,
      from_dataset_version: FROM, to_dataset_version: TO, cloud_env_id: ENV_ID,
      current_sha256: 'e'.repeat(64), github_run_id: RUN_ID, commit_sha: COMMIT_SHA,
    }),
    record('failed-publish-2026-08-01T02-00-00-000Z.json', {
      status: 'post_publish_guard_failed', failed_at: ROLLED_BACK_AT,
      dataset_version: FROM, previous_dataset_version: TO, cloud_env_id: ENV_ID,
      rollback_status: 'succeeded', rollback_error: null,
      github_run_id: RUN_ID, commit_sha: COMMIT_SHA,
    }),
  ]
}

test('registers one exact successful automatic rollback and its matching failure audit', () => {
  const result = selectAutomaticRollbackRegistration(validRecords(), {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
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
  })
  assert.deepEqual(result, { registered: false })
})

test('missing failure proof, wrong commit, and a disabled target fail closed', () => {
  assert.throws(() => selectAutomaticRollbackRegistration(validRecords().filter(({ fileName }) => !fileName.startsWith('failed-publish-')), {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
  }), /failed-publish audit is missing or duplicated/)

  assert.throws(() => selectAutomaticRollbackRegistration(validRecords(), {
    expectedCommitSha: 'c'.repeat(40),
    expectedGithubRunId: RUN_ID,
  }), /commit identity is invalid/)

  const disabled = [...validRecords(), record(`${TO}.correction.json`, {
    status: 'superseded_invalid_pointer', dataset_version: TO, rollback_allowed: false,
  })]
  assert.throws(() => selectAutomaticRollbackRegistration(disabled, {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: RUN_ID,
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
  }), /does not prove a successful rollback/)

  assert.deepEqual(selectAutomaticRollbackRegistration(validRecords(), {
    expectedCommitSha: COMMIT_SHA,
    expectedGithubRunId: '999',
  }), { registered: false })
})
