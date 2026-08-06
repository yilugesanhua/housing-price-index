function assert(condition, message) {
  if (!condition) throw new Error(`Complete history publish audit rejected: ${message}`)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function buildCompleteHistoryPublishAudit({
  report,
  cloudEnvId,
  storageBucket,
  publishedAt,
  previousDatasetVersion,
  currentSha256,
  githubRunId,
  githubRunAttempt,
  commitSha,
  releaseAuthorization,
}) {
  assert(report?.status === 'staged_not_uploaded', 'staged report status is invalid')
  assert(report.cloud_env_id === cloudEnvId, 'staged report cloud environment does not match the publish target')
  assert(report.storage_bucket === storageBucket, 'staged report storage bucket does not match the publish target')
  assert(/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(report.dataset_version || ''), 'staged report dataset version is invalid')
  assert(/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(report.source_dataset_version || ''), 'staged report source dataset version is invalid')
  assert(/^20\d{2}-(0[1-9]|1[0-2])$/.test(report.dataset_as_of || ''), 'staged report dataset month is invalid')
  assert(report.remote_schema_version === '2.1.0', 'staged report remote schema is invalid')
  assert(/^[a-f0-9]{64}$/.test(report.complete_snapshot_sha256 || ''), 'staged report complete snapshot hash is invalid')
  assert(Number.isInteger(report.complete_snapshot_bytes) && report.complete_snapshot_bytes > 0, 'staged report complete snapshot bytes are invalid')
  assert(/^[a-f0-9]{64}$/.test(report.manifest_sha256 || ''), 'staged report manifest hash is invalid')
  assert(Array.isArray(report.source_batch_ids), 'staged report source batch IDs are invalid')
  assert(Number.isFinite(Date.parse(publishedAt || '')), 'publication time is invalid')
  assert(previousDatasetVersion === null || /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(previousDatasetVersion || ''), 'previous dataset version is invalid')
  assert(/^[a-f0-9]{64}$/.test(currentSha256 || ''), 'current pointer hash is invalid')
  assert(/^\d+$/.test(String(githubRunId || '')), 'GitHub run ID is invalid')
  assert(/^\d+$/.test(String(githubRunAttempt || '')), 'GitHub run attempt is invalid')
  assert(/^[a-f0-9]{40}$/.test(commitSha || ''), 'commit SHA is invalid')
  assert(releaseAuthorization?.repository_automatic_release_enabled === true, 'repository release authorization is invalid')
  assert(releaseAuthorization?.production_environment_authorized === true, 'production release authorization is invalid')
  return {
    ...report,
    status: 'published',
    cloud_env_id: cloudEnvId,
    storage_bucket: storageBucket,
    published_at: publishedAt,
    previous_dataset_version: previousDatasetVersion,
    current_sha256: currentSha256,
    github_run_id: githubRunId,
    github_run_attempt: githubRunAttempt,
    commit_sha: commitSha,
    release_authorization: releaseAuthorization,
    release_type: 'complete_history',
  }
}

export function assertCompleteHistoryPublishAuditIdentity(audit, expected) {
  assert(audit && typeof audit === 'object' && !Array.isArray(audit), 'existing publication audit is invalid')
  assert(audit.status === 'published', 'existing publication audit is not published')
  assert(audit.release_type === 'complete_history', 'existing publication audit has the wrong release type')
  for (const field of [
    'cloud_env_id',
    'storage_bucket',
    'dataset_version',
    'source_dataset_version',
    'dataset_as_of',
    'remote_schema_version',
    'complete_snapshot_sha256',
    'complete_snapshot_bytes',
    'manifest_sha256',
    'previous_dataset_version',
    'current_sha256',
  ]) {
    assert(audit[field] === expected[field], `existing publication audit ${field} differs`)
  }
  assert(JSON.stringify(audit.source_batch_ids || []) === JSON.stringify(expected.source_batch_ids || []),
    'existing publication audit source batch IDs differ')
  assert(/^\d+$/.test(String(audit.github_run_id || '')), 'existing publication audit GitHub run ID is invalid')
  assert(/^\d+$/.test(String(audit.github_run_attempt || '')), 'existing publication audit GitHub run attempt is invalid')
  assert(/^[a-f0-9]{40}$/.test(audit.commit_sha || ''), 'existing publication audit commit SHA is invalid')
  assert(audit.release_authorization?.repository_automatic_release_enabled === true,
    'existing publication audit repository authorization is invalid')
  assert(audit.release_authorization?.production_environment_authorized === true,
    'existing publication audit production authorization is invalid')
  assert(canonicalJson(audit) === canonicalJson(expected),
    'existing publication audit differs from the exact immutable publication identity')
}
