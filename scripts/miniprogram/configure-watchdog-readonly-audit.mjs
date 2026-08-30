import { DEFAULT_CLOUD_ENV_ID, createTencentCloudClient } from './tencent-cloud-sdk.mjs'

export const WATCHDOG_FUNCTION_NAME = 'monthlyDataWatchdog'
export const READONLY_AUDIT_VARIABLE_NAMES = Object.freeze([
  'MONTHLY_DISCOVERY_LEASE_SECONDS',
  'MONTHLY_DISCOVERY_MAX_ATTEMPTS',
  'WATCHDOG_GITHUB_AUDIT_ENABLED',
  'WATCHDOG_DRY_RUN',
  'WATCHDOG_GITHUB_TOKEN',
])

function assertToken(token) {
  if (typeof token !== 'string' || token.length < 16 || /[\r\n]/.test(token)) {
    throw new Error('WATCHDOG_GITHUB_TOKEN is missing or invalid')
  }
}

export function buildReadonlyAuditVariables(token) {
  assertToken(token)
  return [
    { Key: 'MONTHLY_DISCOVERY_LEASE_SECONDS', Value: '720' },
    { Key: 'MONTHLY_DISCOVERY_MAX_ATTEMPTS', Value: '3' },
    { Key: 'WATCHDOG_GITHUB_AUDIT_ENABLED', Value: 'true' },
    { Key: 'WATCHDOG_DRY_RUN', Value: 'false' },
    { Key: 'WATCHDOG_GITHUB_TOKEN', Value: token },
  ]
}

export async function configureReadonlyAudit({
  token,
  apply = false,
  updateFunctionEnvironment = null,
} = {}) {
  if (!apply) {
    return {
      mode: 'plan',
      function_name: WATCHDOG_FUNCTION_NAME,
      cloud_env_id: DEFAULT_CLOUD_ENV_ID,
      variable_names: READONLY_AUDIT_VARIABLE_NAMES,
      github_audit_enabled: true,
      watchdog_dry_run: false,
      production_data_writes: 0,
    }
  }

  const variables = buildReadonlyAuditVariables(token)
  if (typeof updateFunctionEnvironment !== 'function') throw new Error('SCF environment updater is required')
  const response = await updateFunctionEnvironment({ functionName: WATCHDOG_FUNCTION_NAME, variables })
  return {
    mode: 'applied',
    function_name: WATCHDOG_FUNCTION_NAME,
    cloud_env_id: DEFAULT_CLOUD_ENV_ID,
    variable_names: READONLY_AUDIT_VARIABLE_NAMES,
    github_audit_enabled: true,
    watchdog_dry_run: false,
    request_id: response?.RequestId || null,
    production_data_writes: 0,
  }
}

function parseArguments(argv) {
  const args = new Set(argv)
  for (const value of args) {
    if (value !== '--apply') throw new Error(`Unsupported argument: ${value}`)
  }
  return { apply: args.has('--apply') }
}

const invokedPath = process.argv[1]?.replace(/\\/g, '/') || ''
if (invokedPath.endsWith('/configure-watchdog-readonly-audit.mjs')) {
  const { apply } = parseArguments(process.argv.slice(2))
  const cloud = apply ? createTencentCloudClient({ cloudEnvId: DEFAULT_CLOUD_ENV_ID }) : null
  const result = await configureReadonlyAudit({
    token: apply ? process.env.WATCHDOG_GITHUB_TOKEN : undefined,
    apply,
    updateFunctionEnvironment: cloud?.updateFunctionEnvironment,
  })
  console.log(JSON.stringify(result))
}
