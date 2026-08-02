import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCiRollbackAuthorization } from './ci-rollback-authorization.mjs'

const datasetVersion = '2026-06-e9788d0bddf3'
const cloudEnvId = 'cloud1-d3gpdx70w5d05c68c'
const storageBucket = '636c-cloud1-d3gpdx70w5d05c68c-1456861154'
const commitSha = 'a'.repeat(40)
const validEnv = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_WORKFLOW: 'manual-data-rollback',
  GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/manual-data-rollback.yml@refs/heads/main',
  GITHUB_SHA: commitSha,
  GITHUB_RUN_ID: '123456',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_REF: 'refs/heads/main',
  CI_DEFAULT_BRANCH: 'main',
  CI_COMMIT_SHA: commitSha,
  CI_RUN_ID: '123456',
  CI_PRODUCTION_ENVIRONMENT: 'housing-data-production',
  CI_CLOUD_ENV_ID: cloudEnvId,
  CI_DATASET_VERSION: datasetVersion,
  ROLLBACK_CONFIRMATION: datasetVersion,
  AUTOMATIC_RELEASE_ENABLED: 'true',
  PRODUCTION_RELEASE_AUTHORIZED: 'true',
  CI_ORDINARY_CI_WORKFLOW: '.github/workflows/ci.yml',
  CI_ORDINARY_CI_EVENT: 'push',
  CI_ORDINARY_CI_CONCLUSION: 'success',
  CI_ORDINARY_CI_COMMIT_SHA: commitSha,
  CI_ORDINARY_CI_RUN_ID: '654321',
}

test('accepts only the protected rollback workflow with exact CI evidence and both switches', () => {
  const result = validateCiRollbackAuthorization({ env: validEnv, datasetVersion, cloudEnvId, checkedOutSha: commitSha })
  assert.deepEqual(result, {
    repository_automatic_release_enabled: true,
    production_environment_authorized: true,
    ordinary_ci_workflow: '.github/workflows/ci.yml',
    ordinary_ci_run_id: '654321',
  })
})

for (const [field, value, message] of [
  ['GITHUB_ACTIONS', 'false', /GitHub Actions marker mismatch/],
  ['GITHUB_WORKFLOW', 'other-workflow', /workflow identity mismatch/],
  ['GITHUB_RUN_ATTEMPT', '0', /run attempt is invalid/],
  ['GITHUB_REF', 'refs/heads/feature', /default branch mismatch/],
  ['ROLLBACK_CONFIRMATION', '2026-06-ffffffffffff', /rollback confirmation mismatch/],
  ['AUTOMATIC_RELEASE_ENABLED', 'false', /repository automatic release flag mismatch/],
  ['PRODUCTION_RELEASE_AUTHORIZED', 'false', /production environment authorization mismatch/],
  ['CI_ORDINARY_CI_WORKFLOW', 'ci', /ordinary CI workflow mismatch/],
  ['CI_ORDINARY_CI_COMMIT_SHA', 'b'.repeat(40), /ordinary CI commit SHA mismatch/],
]) {
  test(`rejects rollback authorization when ${field} is invalid`, () => {
    assert.throws(() => validateCiRollbackAuthorization({ env: { ...validEnv, [field]: value }, datasetVersion, cloudEnvId, checkedOutSha: commitSha }), message)
  })
}
