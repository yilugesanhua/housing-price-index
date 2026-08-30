import { timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { sha256 } from './remote-data-lib.mjs'
import { COMPLETE_REMOTE_MONTHS, COMPLETE_REMOTE_SCHEMA_VERSION, completeCoverageStart } from './complete-remote-data.mjs'

const require = createRequire(import.meta.url)
const discoveryContract = require('../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/discovery-contract.js')

const execFileAsync = promisify(execFile)

const SHA_PATTERN = /^[a-f0-9]{40}$/
const RUN_ID_PATTERN = /^\d+$/
const PENDING_RECOVERY_CONFIRMATION = 'recover-pending-release'
const CORRECTED_RELEASE = Object.freeze({
  workflow: 'manual-corrected-data-publish',
  workflowFile: 'manual-corrected-data-publish.yml',
  sourceDatasetVersion: '2026-06-4fd1d1a8ff12',
  expectedCurrentDatasetVersion: '2026-06-ec36ff8fb2e5',
  expectedCurrentSourceDatasetVersion: '2026-06-679ea146d4e2',
})

function equal(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && timingSafeEqual(a, b)
}

function requireEqual(actual, expected, label) {
  if (!equal(actual, expected)) throw new Error(`CI release authorization rejected: ${label} mismatch`)
}

function requireOrdinaryCi(gate, checkedOutSha, label) {
  if (!RUN_ID_PATTERN.test(String(gate.ordinary_ci?.run_id || ''))) throw new Error(`CI release authorization rejected: ${label} ordinary CI run ID is invalid`)
  requireEqual(gate.ordinary_ci?.workflow, 'ci.yml', `${label} ordinary CI workflow`)
  if (!['push', 'workflow_dispatch'].includes(gate.ordinary_ci?.event)) throw new Error(`CI release authorization rejected: ${label} ordinary CI event mismatch`)
  requireEqual(gate.ordinary_ci?.conclusion, 'success', `${label} ordinary CI conclusion`)
  requireEqual(gate.ordinary_ci?.commit_sha, checkedOutSha, `${label} ordinary CI commit SHA`)
}

export function validateCiReleaseAuthorization({ env, datasetVersion, cloudEnvId, gateReportText, checkedOutSha = env.GITHUB_SHA }) {
  requireEqual(env.GITHUB_ACTIONS, 'true', 'GitHub Actions marker')
  const correctedRelease = env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_WORKFLOW === CORRECTED_RELEASE.workflow
  const historicalCorrection = env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_WORKFLOW === 'historical-data-correction'
  const completeHistory = env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_WORKFLOW === 'complete-history-data-publish'
  const allowedWorkflow = correctedRelease
    ? CORRECTED_RELEASE.workflowFile
    : historicalCorrection
      ? 'historical-data-correction.yml'
      : completeHistory
        ? 'complete-history-data-publish.yml'
    : env.GITHUB_EVENT_NAME === 'workflow_run' && env.GITHUB_WORKFLOW === 'monthly-data-auto-publish'
      ? 'monthly-data-auto-publish.yml'
    : ['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) && env.GITHUB_WORKFLOW === 'monthly-data-pending-publish'
        ? 'monthly-data-pending-publish.yml'
        : null
  if (!allowedWorkflow) throw new Error('CI release authorization rejected: workflow/event identity mismatch')
  if (!String(env.GITHUB_WORKFLOW_REF || '').includes(`/.github/workflows/${allowedWorkflow}@refs/heads/`)) {
    throw new Error('CI release authorization rejected: workflow reference mismatch')
  }
  if (!SHA_PATTERN.test(env.GITHUB_SHA || '')) throw new Error('CI release authorization rejected: commit SHA is invalid')
  if (!RUN_ID_PATTERN.test(env.GITHUB_RUN_ID || '')) throw new Error('CI release authorization rejected: run ID is invalid')
  requireEqual(env.GITHUB_REF, `refs/heads/${env.CI_DEFAULT_BRANCH}`, 'default branch')
  if (!SHA_PATTERN.test(checkedOutSha || '')) throw new Error('CI release authorization rejected: checked-out commit SHA is invalid')
  requireEqual(env.CI_COMMIT_SHA, checkedOutSha, 'attested commit SHA')
  requireEqual(env.CI_RUN_ID, env.GITHUB_RUN_ID, 'attested run ID')
  requireEqual(env.CI_PRODUCTION_ENVIRONMENT, 'housing-data-production', 'protected environment')
  requireEqual(env.CI_CLOUD_ENV_ID, cloudEnvId, 'cloud environment')
  requireEqual(env.CI_DATASET_VERSION, datasetVersion, 'dataset version')
  requireEqual(env.CI_GATE_REPORT_SHA256, sha256(gateReportText), 'gate report SHA-256')
  const gate = JSON.parse(gateReportText)
  requireEqual(gate.status, 'passed', 'gate status')
  requireEqual(gate.dataset_version, datasetVersion, 'gate dataset version')
  requireEqual(gate.cloud_env_id, cloudEnvId, 'gate cloud environment')
  requireEqual(gate.commit_sha, checkedOutSha, 'gate commit SHA')
  requireEqual(env.AUTOMATIC_RELEASE_ENABLED, 'true', 'repository automatic release flag')
  requireEqual(env.PRODUCTION_RELEASE_AUTHORIZED, 'true', 'production environment authorization')
  if (env.GITHUB_WORKFLOW === 'monthly-data-pending-publish' && env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    requireEqual(env.CI_MANUAL_RECOVERY_CONFIRMATION, PENDING_RECOVERY_CONFIRMATION, 'manual pending recovery confirmation')
  }
  gate.release_authorization = {
    repository_automatic_release_enabled: true,
    production_environment_authorized: true,
  }
  if (correctedRelease) {
    requireEqual(gate.gate_type, 'manual_corrected_release', 'corrected release gate type')
    requireEqual(gate.github_run_id, env.GITHUB_RUN_ID, 'corrected release run ID')
    requireEqual(gate.source_dataset_version, CORRECTED_RELEASE.sourceDatasetVersion, 'corrected source dataset version')
    requireEqual(gate.expected_current_dataset_version, CORRECTED_RELEASE.expectedCurrentDatasetVersion, 'expected current dataset version')
    requireEqual(gate.expected_current_source_dataset_version, CORRECTED_RELEASE.expectedCurrentSourceDatasetVersion, 'expected current source dataset version')
    requireEqual(env.CI_EXPECTED_CURRENT_DATASET_VERSION, CORRECTED_RELEASE.expectedCurrentDatasetVersion, 'attested current dataset version')
    requireEqual(env.CI_EXPECTED_CURRENT_SOURCE_DATASET_VERSION, CORRECTED_RELEASE.expectedCurrentSourceDatasetVersion, 'attested current source dataset version')
  } else if (historicalCorrection) {
    requireEqual(gate.gate_type, 'historical_data_correction', 'historical correction gate type')
    requireEqual(gate.github_run_id, env.GITHUB_RUN_ID, 'historical correction run ID')
    requireEqual(gate.revision_id, env.CI_REVISION_ID, 'historical correction revision ID')
    requireEqual(gate.supersedes_source_dataset_version, env.CI_SUPERSEDES_SOURCE_DATASET_VERSION, 'historical correction superseded source')
    requireEqual(gate.request_sha256, env.CI_CORRECTION_REQUEST_SHA256, 'historical correction request SHA-256')
  } else if (completeHistory) {
    requireEqual(gate.gate_type, 'complete_history_release', 'complete history gate type')
    requireEqual(gate.github_run_id, env.GITHUB_RUN_ID, 'complete history release run ID')
    requireEqual(gate.remote_schema_version, COMPLETE_REMOTE_SCHEMA_VERSION, 'complete history remote schema')
    requireEqual(gate.coverage_start, completeCoverageStart(gate.dataset_as_of), 'complete history rolling coverage start')
    requireEqual(String(gate.month_count), String(COMPLETE_REMOTE_MONTHS), 'complete history month count')
    requireEqual(gate.complete_snapshot_sha256, env.CI_COMPLETE_SNAPSHOT_SHA256, 'complete history snapshot SHA-256')
  } else {
    requireEqual(String(gate.discovery_run_id), env.CI_DISCOVERY_RUN_ID, 'discovery run ID')
    if (!/^[a-f0-9]{64}$/.test(gate.cloud_observation_id || '') || !/^[a-f0-9]{64}$/.test(gate.cloud_observation_payload_sha256 || '')) throw new Error('CI release authorization rejected: CloudBase observation identity is invalid')
    if (!discoveryContract.parseSlotId(gate.cloud_slot_id || '')) throw new Error('CI release authorization rejected: CloudBase slot identity is invalid')
    requireEqual(gate.cloud_timing_status, 'on_time', 'CloudBase discovery timing')
    requireEqual(gate.cloud_handoff_identity, `housing-data-discovery-v1:${gate.idempotency_key}`, 'CloudBase handoff identity')
    if (gate.recovery === true) {
      requireOrdinaryCi(gate, checkedOutSha, 'recovery')
    } else requireOrdinaryCi(gate, checkedOutSha, 'candidate')
  }
  return gate
}

export async function authorizeCiRelease({ root, env = process.env, datasetVersion, cloudEnvId }) {
  const gatePath = resolve(root, env.CI_GATE_REPORT_PATH || '')
  const gateReportText = await readFile(gatePath, 'utf8')
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  return validateCiReleaseAuthorization({ env, datasetVersion, cloudEnvId, gateReportText, checkedOutSha: stdout.trim() })
}
