import assert from 'node:assert/strict'
import test from 'node:test'

import { selectMonitorTarget } from './select-monitor-target.mjs'

const ENV_ID = 'cloud1-d3gpdx70w5d05c68c'
const VERSION_A = '2026-06-111111111111'
const VERSION_B = '2026-07-222222222222'
const VERSION_C = '2026-07-333333333333'

function record(fileName, audit) {
  return { fileName, text: `${JSON.stringify(audit, null, 2)}\n` }
}

function published(datasetVersion, sourceDatasetVersion, publishedAt, githubRunId, hashCharacter, extra = {}) {
  return record(`${datasetVersion}.json`, {
    status: 'published',
    cloud_env_id: ENV_ID,
    dataset_version: datasetVersion,
    source_dataset_version: sourceDatasetVersion,
    manifest_sha256: hashCharacter.repeat(64),
    published_at: publishedAt,
    github_run_id: githubRunId,
    commit_sha: hashCharacter.repeat(40),
    ...extra,
  })
}

const releaseA = published(VERSION_A, '2026-06-aaaaaaaaaaaa', '2026-07-15T01:30:00.000Z', '100', 'a')
const releaseB = published(VERSION_B, '2026-07-bbbbbbbbbbbb', '2026-08-01T01:30:00.000Z', '200', 'b', {
  github_run_attempt: '2',
})

test('schedule selects the newest currently active unified publish audit', () => {
  const result = selectMonitorTarget([releaseA, releaseB], {
    eventName: 'schedule',
    now: Date.parse('2026-08-01T02:30:00.000Z'),
  })
  assert.equal(result.active, true)
  assert.equal(result.datasetVersion, VERSION_B)
  assert.equal(result.publishRunId, '200')
  assert.equal(result.controlEventRunId, '200')
  assert.equal(result.controlEventRunAttempt, '2')
  assert.equal(result.controlEventFileName, `${VERSION_B}.json`)
  assert.equal(result.controlEventSha256, result.releaseAuditSha256)
  assert.match(result.releaseAuditSha256, /^[a-f0-9]{64}$/)
})

test('all monthly and correction publishing workflows immediately select only their exact active run', () => {
  for (const triggerWorkflowName of [
    'monthly-data-auto-publish',
    'monthly-data-pending-publish',
    'manual-corrected-data-publish',
    'historical-data-correction',
    'complete-history-data-publish',
  ]) {
    const result = selectMonitorTarget([releaseA, releaseB], {
      eventName: 'workflow_run',
      now: Date.parse('2026-08-01T02:30:00.000Z'),
      defaultBranch: 'main',
      triggerConclusion: 'success',
      triggerHeadBranch: 'main',
      triggerRunId: '200',
      triggerRunAttempt: '2',
      triggerWorkflowName,
    })
    assert.equal(result.active, true, triggerWorkflowName)
    assert.equal(result.datasetVersion, VERSION_B)
  }
})

test('a successful no-publish run cannot reuse a recent release from another run', () => {
  const result = selectMonitorTarget([releaseA, releaseB], {
    eventName: 'workflow_run',
    now: Date.parse('2026-08-01T02:30:00.000Z'),
    defaultBranch: 'main',
    triggerConclusion: 'success',
    triggerHeadBranch: 'main',
    triggerRunId: '999',
    triggerRunAttempt: '2',
    triggerWorkflowName: 'monthly-data-auto-publish',
  })
  assert.equal(result.active, false)
  assert.equal(result.reason, 'workflow_run_does_not_match_active_release')
})

test('workflow_run binds an explicit attempt while legacy audits remain run-id compatible', () => {
  const retry = selectMonitorTarget([releaseA, releaseB], {
    eventName: 'workflow_run',
    now: Date.parse('2026-08-01T02:30:00.000Z'),
    defaultBranch: 'main',
    triggerConclusion: 'success',
    triggerHeadBranch: 'main',
    triggerRunId: '200',
    triggerRunAttempt: '1',
    triggerWorkflowName: 'monthly-data-auto-publish',
  })
  assert.equal(retry.active, false)
  assert.equal(retry.reason, 'workflow_run_does_not_match_active_release')

  const legacyFirstAttempt = selectMonitorTarget([releaseA], {
    eventName: 'workflow_run',
    now: Date.parse('2026-07-15T02:30:00.000Z'),
    defaultBranch: 'main',
    triggerConclusion: 'success',
    triggerHeadBranch: 'main',
    triggerRunId: '100',
    triggerRunAttempt: '1',
    triggerWorkflowName: 'monthly-data-auto-publish',
  })
  assert.equal(legacyFirstAttempt.active, true)
  assert.equal(legacyFirstAttempt.controlEventRunAttempt, '')

  assert.equal(selectMonitorTarget([releaseA], {
    eventName: 'workflow_run',
    now: Date.parse('2026-07-15T02:30:00.000Z'),
    defaultBranch: 'main',
    triggerConclusion: 'success',
    triggerHeadBranch: 'main',
    triggerRunId: '100',
    triggerRunAttempt: '2',
    triggerWorkflowName: 'monthly-data-auto-publish',
  }).active, true)
})

test('historical supersession resolves to its replacement and rejects a missing replacement audit', () => {
  const releaseC = published(VERSION_C, '2026-07-cccccccccccc', '2026-08-01T03:00:00.000Z', '300', 'c', {
    release_type: 'historical_correction',
    revision_id: 'revision-2026-07-official-fix',
  })
  const correction = record(`${VERSION_B}.correction.json`, {
    status: 'superseded_by_audited_historical_correction',
    dataset_version: VERSION_B,
    superseded_by_dataset_version: VERSION_C,
    rollback_allowed: false,
    recorded_at: '2026-08-01T03:00:00.000Z',
  })
  const result = selectMonitorTarget([releaseA, releaseB, correction, releaseC], {
    eventName: 'schedule',
    now: Date.parse('2026-08-01T04:00:00.000Z'),
  })
  assert.equal(result.active, true)
  assert.equal(result.datasetVersion, VERSION_C)
  assert.equal(result.revisionId, 'revision-2026-07-official-fix')

  assert.throws(() => selectMonitorTarget([releaseA, releaseB, correction], {
    eventName: 'schedule',
    now: Date.parse('2026-08-01T04:00:00.000Z'),
  }), /is marked as superseded/)
})

test('a recovered manual rollback starts a fresh 24-hour window bound only to its finalizer run', () => {
  const rollback = record('manual-data-rollback-2026-08-01T02-00-00-000Z.json', {
    audit_schema_version: 'manual-data-rollback-audit-v4',
    status: 'rolled_back',
    rolled_back_at: '2026-08-01T02:00:00.000Z',
    from_dataset_version: VERSION_B,
    to_dataset_version: VERSION_A,
    cloud_env_id: ENV_ID,
    github_run_id: '250',
    commit_sha: 'd'.repeat(40),
    recovered_after_pointer_switch: true,
    finalizer_github_run_id: '251',
    finalizer_github_run_attempt: '2',
    finalizer_commit_sha: 'e'.repeat(40),
  })
  const result = selectMonitorTarget([releaseA, releaseB, rollback], {
    eventName: 'schedule',
    now: Date.parse('2026-08-01T02:30:00.000Z'),
  })
  assert.equal(result.active, true)
  assert.equal(result.datasetVersion, VERSION_A)
  assert.equal(result.controlEventType, 'manual_rollback')
  assert.equal(result.controlEventRunId, '251')
  assert.equal(result.controlEventRunAttempt, '2')
  assert.equal(result.controlEventCommitSha, 'e'.repeat(40))
  assert.equal(result.controlEventAt, '2026-08-01T02:00:00.000Z')

  const immediate = selectMonitorTarget([releaseA, releaseB, rollback], {
    eventName: 'workflow_run',
    now: Date.parse('2026-08-01T02:01:00.000Z'),
    defaultBranch: 'main',
    triggerConclusion: 'success',
    triggerHeadBranch: 'main',
    triggerRunId: '251',
    triggerRunAttempt: '2',
    triggerWorkflowName: 'manual-data-rollback',
  })
  assert.equal(immediate.active, true)
  assert.equal(immediate.controlEventSha256, result.controlEventSha256)

  const differentAttempt = selectMonitorTarget([releaseA, releaseB, rollback], {
    eventName: 'workflow_run',
    now: Date.parse('2026-08-01T02:01:00.000Z'),
    defaultBranch: 'main',
    triggerConclusion: 'success',
    triggerHeadBranch: 'main',
    triggerRunId: '251',
    triggerRunAttempt: '3',
    triggerWorkflowName: 'manual-data-rollback',
  })
  assert.equal(differentAttempt.active, false)
  assert.equal(differentAttempt.reason, 'workflow_run_does_not_match_active_release')

  const originRun = selectMonitorTarget([releaseA, releaseB, rollback], {
    eventName: 'workflow_run',
    now: Date.parse('2026-08-01T02:01:00.000Z'),
    defaultBranch: 'main',
    triggerConclusion: 'success',
    triggerHeadBranch: 'main',
    triggerRunId: '250',
    triggerRunAttempt: '1',
    triggerWorkflowName: 'manual-data-rollback',
  })
  assert.equal(originRun.active, false)
  assert.equal(originRun.reason, 'workflow_run_does_not_match_active_release')
})

test('a successful automatic rollback is selected from its failed publishing workflow run', () => {
  const rollback = record('rollback-2026-08-01T02-00-00-000Z.json', {
    status: 'automatically_rolled_back',
    rolled_back_at: '2026-08-01T02:00:00.000Z',
    from_dataset_version: VERSION_B,
    to_dataset_version: VERSION_A,
    cloud_env_id: ENV_ID,
    current_sha256: 'e'.repeat(64),
    github_run_id: '200',
    commit_sha: 'b'.repeat(40),
  })
  const failure = record('failed-publish-2026-08-01T02-00-00-000Z.json', {
    status: 'post_publish_guard_failed',
    failed_at: '2026-08-01T02:00:00.000Z',
    dataset_version: VERSION_B,
    previous_dataset_version: VERSION_A,
    cloud_env_id: ENV_ID,
    rollback_status: 'succeeded',
    rollback_error: null,
    github_run_id: '200',
    commit_sha: 'b'.repeat(40),
  })
  const records = [releaseA, releaseB, rollback, failure]
  const result = selectMonitorTarget(records, {
    eventName: 'workflow_run',
    now: Date.parse('2026-08-01T02:01:00.000Z'),
    defaultBranch: 'main',
    triggerConclusion: 'failure',
    triggerHeadBranch: 'main',
    triggerRunId: '200',
    triggerRunAttempt: '1',
    triggerWorkflowName: 'monthly-data-auto-publish',
  })
  assert.equal(result.active, true)
  assert.equal(result.datasetVersion, VERSION_A)
  assert.equal(result.controlEventType, 'automatic_rollback')

  assert.equal(selectMonitorTarget(records, {
    eventName: 'workflow_run',
    now: Date.parse('2026-08-01T02:01:00.000Z'),
    defaultBranch: 'main',
    triggerConclusion: 'failure',
    triggerHeadBranch: 'main',
    triggerRunId: '999',
    triggerRunAttempt: '1',
    triggerWorkflowName: 'monthly-data-auto-publish',
  }).active, false)
  assert.throws(() => selectMonitorTarget([releaseA, releaseB, rollback], {
    eventName: 'schedule',
    now: Date.parse('2026-08-01T02:01:00.000Z'),
  }), /failed-publish audit is missing or duplicated/)
})

test('schedule stops after 24 hours while manual dispatch remains bound to the active release', () => {
  assert.equal(selectMonitorTarget([releaseB], {
    eventName: 'schedule',
    now: Date.parse('2026-08-02T01:30:00.001Z'),
  }).active, false)

  assert.equal(selectMonitorTarget([releaseB], {
    eventName: 'workflow_dispatch',
    manualDatasetVersion: VERSION_B,
    now: Date.parse('2026-08-10T01:30:00.000Z'),
  }).active, true)
  assert.throws(() => selectMonitorTarget([releaseA, releaseB], {
    eventName: 'workflow_dispatch',
    manualDatasetVersion: VERSION_A,
    now: Date.parse('2026-08-01T02:30:00.000Z'),
  }), /is not the current active release/)
})

test('future, ambiguous, and malformed active identities fail closed', () => {
  const releaseC = published(VERSION_C, '2026-07-cccccccccccc', '2026-08-01T01:30:00.000Z', '300', 'c')
  assert.throws(() => selectMonitorTarget([releaseB, releaseC], {
    eventName: 'schedule',
    now: Date.parse('2026-08-01T02:30:00.000Z'),
  }), /ambiguous dataset identity/)
  assert.throws(() => selectMonitorTarget([releaseB], {
    eventName: 'schedule',
    now: Date.parse('2026-08-01T01:29:59.999Z'),
  }), /dated in the future/)

  const malformed = record(`${VERSION_B}.json`, {
    status: 'published',
    cloud_env_id: ENV_ID,
    dataset_version: VERSION_A,
    manifest_sha256: 'b'.repeat(64),
    published_at: '2026-08-01T01:30:00.000Z',
  })
  assert.throws(() => selectMonitorTarget([malformed], {
    eventName: 'schedule',
    now: Date.parse('2026-08-01T02:30:00.000Z'),
  }), /dataset identity does not match its filename/)
})
