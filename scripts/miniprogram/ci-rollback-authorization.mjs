import { timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SHA_PATTERN = /^[a-f0-9]{40}$/
const RUN_ID_PATTERN = /^\d+$/
const RUN_ATTEMPT_PATTERN = /^[1-9]\d*$/
const DATASET_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const WORKFLOW_PATH = '.github/workflows/manual-data-rollback.yml'
const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'

function equal(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && timingSafeEqual(a, b)
}

function requireEqual(actual, expected, label) {
  if (!equal(actual, expected)) throw new Error(`CI rollback authorization rejected: ${label} mismatch`)
}

export function validateCiRollbackAuthorization({ env, datasetVersion, cloudEnvId, checkedOutSha = env.GITHUB_SHA }) {
  requireEqual(env.GITHUB_ACTIONS, 'true', 'GitHub Actions marker')
  requireEqual(env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'workflow event')
  requireEqual(env.GITHUB_WORKFLOW, 'manual-data-rollback', 'workflow identity')
  if (!String(env.GITHUB_WORKFLOW_REF || '').includes(`/${WORKFLOW_PATH}@refs/heads/`)) {
    throw new Error('CI rollback authorization rejected: workflow reference mismatch')
  }
  if (!SHA_PATTERN.test(env.GITHUB_SHA || '')) throw new Error('CI rollback authorization rejected: commit SHA is invalid')
  if (!RUN_ID_PATTERN.test(env.GITHUB_RUN_ID || '')) throw new Error('CI rollback authorization rejected: run ID is invalid')
  if (!RUN_ATTEMPT_PATTERN.test(env.GITHUB_RUN_ATTEMPT || '')) throw new Error('CI rollback authorization rejected: run attempt is invalid')
  if (!DATASET_PATTERN.test(datasetVersion || '')) throw new Error('CI rollback authorization rejected: dataset version is invalid')
  requireEqual(env.GITHUB_REF, `refs/heads/${env.CI_DEFAULT_BRANCH}`, 'default branch')
  requireEqual(env.CI_COMMIT_SHA, checkedOutSha, 'attested commit SHA')
  requireEqual(env.CI_RUN_ID, env.GITHUB_RUN_ID, 'attested run ID')
  requireEqual(env.CI_PRODUCTION_ENVIRONMENT, 'housing-data-production', 'protected environment')
  requireEqual(env.CI_CLOUD_ENV_ID, cloudEnvId, 'cloud environment')
  requireEqual(env.CI_DATASET_VERSION, datasetVersion, 'dataset version')
  requireEqual(env.ROLLBACK_CONFIRMATION, datasetVersion, 'rollback confirmation')
  requireEqual(env.AUTOMATIC_RELEASE_ENABLED, 'true', 'repository automatic release flag')
  requireEqual(env.PRODUCTION_RELEASE_AUTHORIZED, 'true', 'production environment authorization')
  requireEqual(env.CI_ORDINARY_CI_WORKFLOW, CI_WORKFLOW_PATH, 'ordinary CI workflow')
  requireEqual(env.CI_ORDINARY_CI_EVENT, 'push', 'ordinary CI event')
  requireEqual(env.CI_ORDINARY_CI_CONCLUSION, 'success', 'ordinary CI conclusion')
  requireEqual(env.CI_ORDINARY_CI_COMMIT_SHA, checkedOutSha, 'ordinary CI commit SHA')
  if (!RUN_ID_PATTERN.test(env.CI_ORDINARY_CI_RUN_ID || '')) throw new Error('CI rollback authorization rejected: ordinary CI run ID is invalid')
  return {
    repository_automatic_release_enabled: true,
    production_environment_authorized: true,
    ordinary_ci_workflow: CI_WORKFLOW_PATH,
    ordinary_ci_run_id: env.CI_ORDINARY_CI_RUN_ID,
  }
}

export async function authorizeCiRollback({ root, env = process.env, datasetVersion, cloudEnvId }) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: resolve(root), encoding: 'utf8' })
  return validateCiRollbackAuthorization({ env, datasetVersion, cloudEnvId, checkedOutSha: stdout.trim() })
}

export {
  manualRollbackAuditFileName,
  validateManualRollbackAudit,
} from './manual-rollback-intent.mjs'
