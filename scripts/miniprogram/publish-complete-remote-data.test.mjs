import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./publish-complete-remote-data.mjs', import.meta.url), 'utf8')

test('complete-history publication preflights a full verified rollback target before activation', () => {
  const preflightStart = source.indexOf('async function verifyRollbackTarget(pointer)')
  const packageStart = source.indexOf('async function verifyCompleteRollbackPackage(pointer)')
  const activationStart = source.indexOf('await activatePointerWithRollback({')
  assert.ok(packageStart >= 0 && preflightStart > packageStart && activationStart > preflightStart)
  const rollbackPackage = source.slice(packageStart, preflightStart)
  const preflight = source.slice(preflightStart, activationStart)
  assert.match(preflight, /previousAudit\.manifest_sha256 === pointer\.manifest_sha256/)
  assert.match(preflight, /previousAudit\.complete_snapshot_sha256 === remoteManifest\.complete_snapshot_sha256/)
  assert.match(rollbackPackage, /complete-snapshot\.json/)
  assert.match(rollbackPackage, /validateCompleteRemoteSnapshot\(remoteSnapshot\)/)
  assert.match(preflight, /validateManifestFunctionOutput/)

  const activation = source.slice(activationStart)
  assert.match(activation, /verifyRollbackTarget,/)
  assert.match(activation, /guardRollback: async \(pointer\) => \{ const remoteManifest = await verifyCompleteRollbackPackage\(pointer\)/)
  assert.match(activation, /storage_bucket: cloud\.bucket/)
})

test('complete-history idempotent audit recovery validates more than the manifest hash', () => {
  assert.match(source, /assertCompleteHistoryPublishAuditIdentity\(existing, audit\)/)
})
