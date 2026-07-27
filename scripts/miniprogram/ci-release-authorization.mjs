import { timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { sha256 } from './remote-data-lib.mjs'

const execFileAsync = promisify(execFile)

const SHA_PATTERN = /^[a-f0-9]{40}$/
const RUN_ID_PATTERN = /^\d+$/

function equal(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && timingSafeEqual(a, b)
}

function requireEqual(actual, expected, label) {
  if (!equal(actual, expected)) throw new Error(`CI release authorization rejected: ${label} mismatch`)
}

export function validateCiReleaseAuthorization({ env, datasetVersion, cloudEnvId, gateReportText, checkedOutSha = env.GITHUB_SHA }) {
  requireEqual(env.GITHUB_ACTIONS, 'true', 'GitHub Actions marker')
  const allowedWorkflow = env.GITHUB_EVENT_NAME === 'workflow_run' && env.GITHUB_WORKFLOW === 'monthly-data-auto-publish'
    ? 'monthly-data-auto-publish.yml'
    : env.GITHUB_EVENT_NAME === 'schedule' && env.GITHUB_WORKFLOW === 'monthly-data-pending-publish'
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
  requireEqual(env.AUTOMATIC_RELEASE_ENABLED, 'true', 'production enable flag')
  const gate = JSON.parse(gateReportText)
  requireEqual(gate.status, 'passed', 'gate status')
  requireEqual(gate.dataset_version, datasetVersion, 'gate dataset version')
  requireEqual(gate.cloud_env_id, cloudEnvId, 'gate cloud environment')
  requireEqual(gate.commit_sha, checkedOutSha, 'gate commit SHA')
  requireEqual(String(gate.discovery_run_id), env.CI_DISCOVERY_RUN_ID, 'discovery run ID')
  return gate
}

export async function authorizeCiRelease({ root, env = process.env, datasetVersion, cloudEnvId }) {
  const gatePath = resolve(root, env.CI_GATE_REPORT_PATH || '')
  const gateReportText = await readFile(gatePath, 'utf8')
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  return validateCiReleaseAuthorization({ env, datasetVersion, cloudEnvId, gateReportText, checkedOutSha: stdout.trim() })
}
