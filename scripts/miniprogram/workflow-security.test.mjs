import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const discovery = await readFile(resolve(root, '.github/workflows/monthly-data-check.yml'), 'utf8')
const publisher = await readFile(resolve(root, '.github/workflows/monthly-data-auto-publish.yml'), 'utf8')
const recovery = await readFile(resolve(root, '.github/workflows/monthly-data-pending-publish.yml'), 'utf8')
const monitor = await readFile(resolve(root, '.github/workflows/monthly-data-post-publish-monitor.yml'), 'utf8')
const rehearsal = await readFile(resolve(root, '.github/workflows/cloud-write-rehearsal.yml'), 'utf8')

test('discovery workflow remains read-only and has no production environment', () => {
  assert.match(discovery, /permissions:\s+contents: read/)
  assert.doesNotMatch(discovery, /contents: write|housing-data-production|TENCENTCLOUD_SECRET/)
})

test('publisher is triggered only by the named discovery workflow', () => {
  assert.match(publisher, /workflow_run:\s+workflows: \[monthly-data-check\]/)
  assert.doesNotMatch(publisher, /pull_request:|workflow_dispatch:/)
  assert.match(publisher, /Require successful ordinary CI for the base commit/)
  assert.match(publisher, /actions\/workflows\/ci\.yml\/runs/)
})

test('production pointer writes are serialized and never cancelled', () => {
  assert.match(publisher, /group: housing-data-production-publish/)
  assert.match(publisher, /cancel-in-progress: false/)
  assert.match(recovery, /group: housing-data-production-publish/)
  assert.match(recovery, /cancel-in-progress: false/)
  assert.match(monitor, /group: housing-data-production-publish/)
})

test('scheduled recovery reads state without credentials and publishes only a ready pending release', () => {
  const inspect = recovery.slice(recovery.indexOf('  inspect:'), recovery.indexOf('  publish:'))
  const publish = recovery.slice(recovery.indexOf('  publish:'))
  assert.doesNotMatch(inspect, /housing-data-production|TENCENTCLOUD_SECRET/)
  assert.match(publish, /needs\.inspect\.outputs\.ready == 'true'/)
  assert.match(publish, /vars\.AUTOMATIC_RELEASE_ENABLED == 'true'/)
  assert.match(publish, /miniprogram:data:verify-official-source/)
  assert.match(publish, /environment: housing-data-production/)
})

test('24-hour monitor uses a separate read-only identity and does not expose pointer writes', () => {
  assert.match(monitor, /workflow_dispatch:/)
  assert.match(monitor, /Invalid manual dataset version/)
  assert.match(monitor, /TENCENTCLOUD_MONITOR_SECRET_ID/)
  assert.match(monitor, /monitor-remote-release\.mjs/)
  assert.doesNotMatch(monitor, /miniprogram:data:publish|storage', 'upload|TENCENTCLOUD_SECRET_ID:/)
})

test('remote monitor uses the official COS SDK with the read-only identity', async () => {
  const script = await readFile(resolve(root, 'scripts/miniprogram/monitor-remote-release.mjs'), 'utf8')
  assert.match(script, /cosCall\('headObject', 'housing-data\/current\.json'\)/)
  assert.match(script, /TENCENTCLOUD_MONITOR_SECRET_ID/)
  assert.doesNotMatch(script, /\['storage', '(?:detail|download)'/)
  assert.match(monitor, /Verify cloud function, pointer, and all 70 remote shards\s+env:\s+TENCENTCLOUD_MONITOR_SECRET_ID:/)
})

test('remote monitor invokes SCF directly without CloudBase CLI preflight permissions', async () => {
  const script = await readFile(resolve(root, 'scripts/miniprogram/monitor-remote-release.mjs'), 'utf8')
  assert.match(script, /scf\.Invoke\(/)
  assert.match(script, /Namespace: cloudEnvId/)
  assert.doesNotMatch(script, /runTcb|\['fn', 'invoke'/)
  assert.doesNotMatch(monitor, /tcb login/)
})

test('only the publish job receives the protected environment and credentials', () => {
  const prepare = publisher.slice(publisher.indexOf('  prepare:'), publisher.indexOf('  publish:'))
  const publish = publisher.slice(publisher.indexOf('  publish:'))
  assert.doesNotMatch(prepare, /environment: housing-data-production|TENCENTCLOUD_SECRET/)
  assert.match(publish, /environment: housing-data-production/)
  assert.match(publish, /vars\.AUTOMATIC_RELEASE_ENABLED == 'true'/)
  assert.match(publish, /secrets\.TENCENTCLOUD_SECRET_ID/)
  assert.match(publish, /CI_GATE_REPORT_SHA256/)
})

test('publisher workflows use direct SDK credentials without CloudBase CLI login', () => {
  assert.doesNotMatch(publisher, /tcb login/)
  assert.doesNotMatch(recovery, /tcb login/)
  assert.match(publisher, /Publish immutable release[\s\S]*TENCENTCLOUD_SECRET_ID:/)
  assert.match(recovery, /Retry guarded publication[\s\S]*TENCENTCLOUD_SECRET_ID:/)
})

test('manual write rehearsal is isolated from production keys', async () => {
  const script = await readFile(resolve(root, 'scripts/miniprogram/rehearse-cloud-write.mjs'), 'utf8')
  assert.match(rehearsal, /workflow_dispatch:/)
  assert.match(rehearsal, /environment: housing-data-production/)
  assert.match(rehearsal, /miniprogram:data:rehearse-write/)
  assert.doesNotMatch(rehearsal, /AUTOMATIC_RELEASE_ENABLED|tcb login/)
  assert.match(script, /housing-data\/rehearsals\/\$\{runId\}\//)
  assert.doesNotMatch(script, /putObject\(['"]housing-data\/(?:current\.json|releases\/)/)
  assert.match(script, /pointerKey = assertRehearsalKey\(`\$\{prefix\}current\.json`/)
  assert.match(script, /headObject/)
  assert.match(script, /getObject/)
  assert.match(script, /activatePointerWithRollback/)
  assert.match(script, /intentional isolated post-switch guard failure/)
  assert.match(script, /automatic_rollback_verified/)
})
