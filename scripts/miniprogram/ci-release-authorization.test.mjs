import assert from 'node:assert/strict'
import test from 'node:test'
import { sha256 } from './remote-data-lib.mjs'
import { validateCiReleaseAuthorization } from './ci-release-authorization.mjs'

const datasetVersion = '2026-07-0123456789ab'
const cloudEnvId = 'cloud1-d3gpdx70w5d05c68c'
const gate = {
  status: 'passed',
  dataset_version: datasetVersion,
  cloud_env_id: cloudEnvId,
  commit_sha: 'a'.repeat(40),
  discovery_run_id: '456',
}
const gateReportText = `${JSON.stringify(gate)}\n`
const validEnv = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_run',
  GITHUB_WORKFLOW: 'monthly-data-auto-publish',
  GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/monthly-data-auto-publish.yml@refs/heads/main',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '123',
  GITHUB_REF: 'refs/heads/main',
  CI_DEFAULT_BRANCH: 'main',
  CI_COMMIT_SHA: 'a'.repeat(40),
  CI_RUN_ID: '123',
  CI_DISCOVERY_RUN_ID: '456',
  CI_PRODUCTION_ENVIRONMENT: 'housing-data-production',
  CI_CLOUD_ENV_ID: cloudEnvId,
  CI_DATASET_VERSION: datasetVersion,
  CI_GATE_REPORT_SHA256: sha256(gateReportText),
  AUTOMATIC_RELEASE_ENABLED: 'true',
}

test('accepts only a complete production CI attestation', () => {
  assert.equal(validateCiReleaseAuthorization({ env: validEnv, datasetVersion, cloudEnvId, gateReportText, checkedOutSha: validEnv.CI_COMMIT_SHA }).status, 'passed')
})

for (const [field, value, message] of [
  ['GITHUB_EVENT_NAME', 'pull_request', /workflow\/event identity mismatch/],
  ['GITHUB_REF', 'refs/heads/feature', /default branch mismatch/],
  ['CI_COMMIT_SHA', 'b'.repeat(40), /commit SHA mismatch/],
  ['CI_RUN_ID', '999', /run ID mismatch/],
  ['CI_PRODUCTION_ENVIRONMENT', 'test', /protected environment mismatch/],
  ['CI_DATASET_VERSION', '2026-07-ffffffffffff', /dataset version mismatch/],
  ['CI_GATE_REPORT_SHA256', '0'.repeat(64), /gate report SHA-256 mismatch/],
  ['AUTOMATIC_RELEASE_ENABLED', 'false', /production enable flag mismatch/],
]) {
  test(`rejects CI attestation when ${field} is invalid`, () => {
    assert.throws(() => validateCiReleaseAuthorization({ env: { ...validEnv, [field]: value }, datasetVersion, cloudEnvId, gateReportText, checkedOutSha: validEnv.CI_COMMIT_SHA }), message)
  })
}

test('rejects a gate report that did not pass', () => {
  const failedText = `${JSON.stringify({ ...gate, status: 'failed' })}\n`
  assert.throws(() => validateCiReleaseAuthorization({
    env: { ...validEnv, CI_GATE_REPORT_SHA256: sha256(failedText) },
    datasetVersion,
    cloudEnvId,
    gateReportText: failedText,
    checkedOutSha: validEnv.CI_COMMIT_SHA,
  }), /gate status mismatch/)
})

test('accepts the fixed scheduled pending-release recovery workflow', () => {
  const env = {
    ...validEnv,
    GITHUB_EVENT_NAME: 'schedule',
    GITHUB_WORKFLOW: 'monthly-data-pending-publish',
    GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/monthly-data-pending-publish.yml@refs/heads/main',
  }
  assert.equal(validateCiReleaseAuthorization({ env, datasetVersion, cloudEnvId, gateReportText, checkedOutSha: env.CI_COMMIT_SHA }).status, 'passed')
})
