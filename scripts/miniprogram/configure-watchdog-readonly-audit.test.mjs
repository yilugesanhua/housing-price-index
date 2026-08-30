import assert from 'node:assert/strict'
import test from 'node:test'

import {
  READONLY_AUDIT_VARIABLE_NAMES,
  buildReadonlyAuditVariables,
  configureReadonlyAudit,
} from './configure-watchdog-readonly-audit.mjs'

test('readonly audit configuration uses exactly the five approved environment variables', () => {
  const variables = buildReadonlyAuditVariables('test-watchdog-token-0123456789')
  assert.deepEqual(variables.map((variable) => variable.Key), READONLY_AUDIT_VARIABLE_NAMES)
  assert.deepEqual(variables.slice(0, 4), [
    { Key: 'MONTHLY_DISCOVERY_LEASE_SECONDS', Value: '720' },
    { Key: 'MONTHLY_DISCOVERY_MAX_ATTEMPTS', Value: '3' },
    { Key: 'WATCHDOG_GITHUB_AUDIT_ENABLED', Value: 'true' },
    { Key: 'WATCHDOG_DRY_RUN', Value: 'false' },
  ])
})

test('readonly audit plan is non-mutating and does not require a token', async () => {
  const result = await configureReadonlyAudit()
  assert.equal(result.mode, 'plan')
  assert.equal(result.github_audit_enabled, true)
  assert.equal(result.watchdog_dry_run, false)
  assert.equal(result.production_data_writes, 0)
  assert.equal('request_id' in result, false)
})

test('readonly audit apply passes the token only to the SCF updater and never returns it', async () => {
  let received
  const result = await configureReadonlyAudit({
    token: 'test-watchdog-token-0123456789',
    apply: true,
    updateFunctionEnvironment: async (input) => {
      received = input
      return { RequestId: 'request-test-123' }
    },
  })
  assert.equal(received.functionName, 'monthlyDataWatchdog')
  assert.equal(received.variables.at(-1).Key, 'WATCHDOG_GITHUB_TOKEN')
  assert.equal(received.variables.at(-1).Value, 'test-watchdog-token-0123456789')
  assert.deepEqual(result.variable_names, READONLY_AUDIT_VARIABLE_NAMES)
  assert.equal(JSON.stringify(result).includes('test-watchdog-token-0123456789'), false)
  assert.equal(result.production_data_writes, 0)
})

test('readonly audit apply fails closed for a missing token or missing updater', async () => {
  await assert.rejects(() => configureReadonlyAudit({ apply: true, updateFunctionEnvironment: async () => ({}) }), /WATCHDOG_GITHUB_TOKEN/)
  await assert.rejects(() => configureReadonlyAudit({ token: 'test-watchdog-token-0123456789', apply: true }), /SCF environment updater/)
})
