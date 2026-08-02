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
  PRODUCTION_RELEASE_AUTHORIZED: 'true',
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
  ['AUTOMATIC_RELEASE_ENABLED', 'false', /repository automatic release flag mismatch/],
  ['PRODUCTION_RELEASE_AUTHORIZED', 'false', /production environment authorization mismatch/],
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
  const recoveryGate = {
    ...gate,
    recovery: true,
    ordinary_ci: { workflow: 'ci.yml', event: 'push', conclusion: 'success', run_id: '789', commit_sha: validEnv.CI_COMMIT_SHA },
  }
  const recoveryText = `${JSON.stringify(recoveryGate)}\n`
  const env = {
    ...validEnv,
    GITHUB_EVENT_NAME: 'schedule',
    GITHUB_WORKFLOW: 'monthly-data-pending-publish',
    GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/monthly-data-pending-publish.yml@refs/heads/main',
    CI_GATE_REPORT_SHA256: sha256(recoveryText),
  }
  assert.equal(validateCiReleaseAuthorization({ env, datasetVersion, cloudEnvId, gateReportText: recoveryText, checkedOutSha: env.CI_COMMIT_SHA }).status, 'passed')
  const mismatchedText = `${JSON.stringify({ ...recoveryGate, ordinary_ci: { ...recoveryGate.ordinary_ci, commit_sha: 'b'.repeat(40) } })}\n`
  assert.throws(() => validateCiReleaseAuthorization({
    env: { ...env, CI_GATE_REPORT_SHA256: sha256(mismatchedText) }, datasetVersion, cloudEnvId,
    gateReportText: mismatchedText, checkedOutSha: env.CI_COMMIT_SHA,
  }), /recovery ordinary CI commit SHA mismatch/)
})

test('accepts only the fixed manually confirmed corrected release with both production switches enabled', () => {
  const correctedDatasetVersion = '2026-06-e9788d0bddf3'
  const correctedGate = {
    status: 'passed',
    gate_type: 'manual_corrected_release',
    dataset_version: correctedDatasetVersion,
    source_dataset_version: '2026-06-4fd1d1a8ff12',
    expected_current_dataset_version: '2026-06-ec36ff8fb2e5',
    expected_current_source_dataset_version: '2026-06-679ea146d4e2',
    cloud_env_id: cloudEnvId,
    commit_sha: validEnv.CI_COMMIT_SHA,
    github_run_id: validEnv.GITHUB_RUN_ID,
  }
  const correctedText = `${JSON.stringify(correctedGate)}\n`
  const correctedEnv = {
    ...validEnv,
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_WORKFLOW: 'manual-corrected-data-publish',
    GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/manual-corrected-data-publish.yml@refs/heads/main',
    CI_DATASET_VERSION: correctedDatasetVersion,
    CI_GATE_REPORT_SHA256: sha256(correctedText),
    CI_EXPECTED_CURRENT_DATASET_VERSION: '2026-06-ec36ff8fb2e5',
    CI_EXPECTED_CURRENT_SOURCE_DATASET_VERSION: '2026-06-679ea146d4e2',
    AUTOMATIC_RELEASE_ENABLED: 'true',
    PRODUCTION_RELEASE_AUTHORIZED: 'true',
  }
  assert.equal(validateCiReleaseAuthorization({ env: correctedEnv, datasetVersion: correctedDatasetVersion, cloudEnvId, gateReportText: correctedText, checkedOutSha: correctedEnv.CI_COMMIT_SHA }).gate_type, 'manual_corrected_release')

  for (const [field, value, message] of [
    ['CI_EXPECTED_CURRENT_DATASET_VERSION', '2026-06-ffffffffffff', /attested current dataset version mismatch/],
    ['CI_EXPECTED_CURRENT_SOURCE_DATASET_VERSION', '2026-06-ffffffffffff', /attested current source dataset version mismatch/],
    ['AUTOMATIC_RELEASE_ENABLED', 'false', /repository automatic release flag mismatch/],
    ['PRODUCTION_RELEASE_AUTHORIZED', 'false', /production environment authorization mismatch/],
  ]) {
    assert.throws(() => validateCiReleaseAuthorization({
      env: { ...correctedEnv, [field]: value },
      datasetVersion: correctedDatasetVersion,
      cloudEnvId,
      gateReportText: correctedText,
      checkedOutSha: correctedEnv.CI_COMMIT_SHA,
    }), message)
  }
})

test('rejects arbitrary workflow_dispatch publication', () => {
  assert.throws(() => validateCiReleaseAuthorization({
    env: { ...validEnv, GITHUB_EVENT_NAME: 'workflow_dispatch' },
    datasetVersion,
    cloudEnvId,
    gateReportText,
    checkedOutSha: validEnv.CI_COMMIT_SHA,
  }), /workflow\/event identity mismatch/)
})

test('accepts only an attested generic historical correction workflow', () => {
  const correctionGate = {
    status: 'passed', gate_type: 'historical_data_correction', revision_id: 'revision-2026-06-audited-fix',
    dataset_version: datasetVersion, source_dataset_version: '2026-07-222222222222',
    supersedes_source_dataset_version: '2026-07-111111111111', cloud_env_id: cloudEnvId,
    commit_sha: validEnv.CI_COMMIT_SHA, github_run_id: validEnv.GITHUB_RUN_ID, request_sha256: 'f'.repeat(64),
  }
  const text = `${JSON.stringify(correctionGate)}\n`
  const env = {
    ...validEnv, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW: 'historical-data-correction',
    GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/historical-data-correction.yml@refs/heads/main',
    CI_GATE_REPORT_SHA256: sha256(text), CI_REVISION_ID: correctionGate.revision_id,
    CI_SUPERSEDES_SOURCE_DATASET_VERSION: correctionGate.supersedes_source_dataset_version,
    CI_CORRECTION_REQUEST_SHA256: correctionGate.request_sha256,
    AUTOMATIC_RELEASE_ENABLED: 'true', PRODUCTION_RELEASE_AUTHORIZED: 'true',
  }
  assert.equal(validateCiReleaseAuthorization({ env, datasetVersion, cloudEnvId, gateReportText: text, checkedOutSha: env.CI_COMMIT_SHA }).gate_type, 'historical_data_correction')
  assert.throws(() => validateCiReleaseAuthorization({ env: { ...env, CI_REVISION_ID: 'wrong' }, datasetVersion, cloudEnvId, gateReportText: text, checkedOutSha: env.CI_COMMIT_SHA }), /revision ID mismatch/)
  assert.throws(() => validateCiReleaseAuthorization({ env: { ...env, AUTOMATIC_RELEASE_ENABLED: 'false' }, datasetVersion, cloudEnvId, gateReportText: text, checkedOutSha: env.CI_COMMIT_SHA }), /repository automatic release flag mismatch/)
  assert.throws(() => validateCiReleaseAuthorization({ env: { ...env, PRODUCTION_RELEASE_AUTHORIZED: 'false' }, datasetVersion, cloudEnvId, gateReportText: text, checkedOutSha: env.CI_COMMIT_SHA }), /production environment authorization mismatch/)
})
