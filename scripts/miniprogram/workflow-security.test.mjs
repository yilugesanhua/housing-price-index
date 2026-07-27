import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const discovery = await readFile(resolve(root, '.github/workflows/monthly-data-check.yml'), 'utf8')
const publisher = await readFile(resolve(root, '.github/workflows/monthly-data-auto-publish.yml'), 'utf8')
const recovery = await readFile(resolve(root, '.github/workflows/monthly-data-pending-publish.yml'), 'utf8')
const monitor = await readFile(resolve(root, '.github/workflows/monthly-data-post-publish-monitor.yml'), 'utf8')

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

test('remote monitor uses the current read-only object metadata API', async () => {
  const script = await readFile(resolve(root, 'scripts/miniprogram/monitor-remote-release.mjs'), 'utf8')
  assert.match(script, /'storage', 'objects', 'stat'/)
  assert.match(script, /'--method', 'HEAD'/)
  assert.doesNotMatch(script, /'storage', 'detail', 'housing-data\/current\.json'/)
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
