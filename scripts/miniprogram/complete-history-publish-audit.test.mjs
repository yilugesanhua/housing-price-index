import assert from 'node:assert/strict'
import test from 'node:test'

import { assertCompleteHistoryPublishAuditIdentity, buildCompleteHistoryPublishAudit } from './complete-history-publish-audit.mjs'

const cloudEnvId = 'cloud1-d3gpdx70w5d05c68c'
const storageBucket = '636c-cloud1-d3gpdx70w5d05c68c-1456861154'
const report = {
  status: 'staged_not_uploaded',
  cloud_env_id: cloudEnvId,
  storage_bucket: storageBucket,
  dataset_version: '2026-07-0123456789ab',
  source_dataset_version: '2026-07-abcdefabcdef',
  dataset_as_of: '2026-07',
  remote_schema_version: '2.1.0',
  complete_snapshot_sha256: 'd'.repeat(64),
  complete_snapshot_bytes: 123456,
  manifest_sha256: 'a'.repeat(64),
  source_batch_ids: ['2026-07'],
}

function build(overrides = {}) {
  return buildCompleteHistoryPublishAudit({
    report,
    cloudEnvId,
    storageBucket,
    publishedAt: '2026-08-06T01:00:00.000Z',
    previousDatasetVersion: '2026-06-abcdefabcdef',
    currentSha256: 'b'.repeat(64),
    githubRunId: '123',
    githubRunAttempt: '1',
    commitSha: 'c'.repeat(40),
    releaseAuthorization: {
      repository_automatic_release_enabled: true,
      production_environment_authorized: true,
    },
    ...overrides,
  })
}

test('complete-history publish audit carries the staged cloud target into the immutable audit', () => {
  const audit = build()
  assert.equal(audit.status, 'published')
  assert.equal(audit.cloud_env_id, cloudEnvId)
  assert.equal(audit.storage_bucket, storageBucket)
  assert.equal(audit.release_type, 'complete_history')
})

test('complete-history publish audit rejects a mismatched staged cloud target', () => {
  assert.throws(() => build({ report: { ...report, cloud_env_id: 'cloud1-other' } }), /cloud environment/)
  assert.throws(() => build({ report: { ...report, storage_bucket: 'other-bucket' } }), /storage bucket/)
})

test('complete-history idempotent recovery requires the complete immutable audit identity', () => {
  const audit = build()
  assert.doesNotThrow(() => assertCompleteHistoryPublishAuditIdentity(audit, audit))
  assert.throws(() => assertCompleteHistoryPublishAuditIdentity({ ...audit, dataset_version: '2026-08-0123456789ab' }, audit), /dataset_version/)
  assert.throws(() => assertCompleteHistoryPublishAuditIdentity({ ...audit, source_dataset_version: '2026-08-fedcba987654' }, audit), /source_dataset_version/)
  assert.throws(() => assertCompleteHistoryPublishAuditIdentity({ ...audit, current_sha256: 'd'.repeat(64) }, audit), /current_sha256/)
  assert.throws(() => assertCompleteHistoryPublishAuditIdentity({ ...audit, complete_snapshot_sha256: 'e'.repeat(64) }, audit), /complete_snapshot_sha256/)
  assert.throws(() => assertCompleteHistoryPublishAuditIdentity({ ...audit, github_run_attempt: null }, audit), /run attempt/)
  assert.throws(() => assertCompleteHistoryPublishAuditIdentity({ ...audit, github_run_id: '124' }, audit), /exact immutable publication identity/)
  assert.throws(() => assertCompleteHistoryPublishAuditIdentity({ ...audit, github_run_attempt: '2' }, audit), /exact immutable publication identity/)
  assert.throws(() => assertCompleteHistoryPublishAuditIdentity({ ...audit, commit_sha: 'd'.repeat(40) }, audit), /exact immutable publication identity/)
  assert.throws(() => assertCompleteHistoryPublishAuditIdentity({ ...audit, published_at: '2026-08-06T02:00:00.000Z' }, audit), /exact immutable publication identity/)
  assert.throws(() => assertCompleteHistoryPublishAuditIdentity({
    ...audit,
    release_authorization: { ...audit.release_authorization, unexpected: true },
  }, audit), /exact immutable publication identity/)
})
