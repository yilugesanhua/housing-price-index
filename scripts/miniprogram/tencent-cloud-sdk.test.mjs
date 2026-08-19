import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertRehearsalKey,
  assertReleaseCleanupPrefix,
  cosTimeoutForKey,
  DEFAULT_COS_TIMEOUT_MS,
  LARGE_TRANSFER_COS_TIMEOUT_MS,
} from './tencent-cloud-sdk.mjs'

test('isolated write rehearsal accepts only its own run prefix', () => {
  assert.equal(assertRehearsalKey('housing-data/rehearsals/12345/probe.json', '12345'), 'housing-data/rehearsals/12345/probe.json')
  assert.throws(() => assertRehearsalKey('housing-data/current.json', '12345'), /Refusing non-rehearsal/)
  assert.throws(() => assertRehearsalKey('housing-data/releases/2026-07-test/manifest.json', '12345'), /Refusing non-rehearsal/)
  assert.throws(() => assertRehearsalKey('housing-data/rehearsals/other/probe.json', '12345'), /Refusing non-rehearsal/)
  assert.throws(() => assertRehearsalKey('housing-data/rehearsals/12345/../current.json', '12345'), /Refusing non-rehearsal/)
})

test('release cleanup is restricted to one immutable release prefix', () => {
  assert.equal(assertReleaseCleanupPrefix('2026-07-0123456789ab'), 'housing-data/releases/2026-07-0123456789ab/')
  assert.throws(() => assertReleaseCleanupPrefix('2026-07'), /Invalid release cleanup/)
  assert.throws(() => assertReleaseCleanupPrefix('2026-07-0123456789ab/../../current'), /Invalid release cleanup/)
})

test('complete bootstrap transfers get a longer SDK-enforced timeout', () => {
  assert.equal(cosTimeoutForKey('housing-data/releases/test/bootstrap.json'), LARGE_TRANSFER_COS_TIMEOUT_MS)
  assert.equal(cosTimeoutForKey('housing-data/rehearsals/123/bootstrap.json'), LARGE_TRANSFER_COS_TIMEOUT_MS)
  assert.equal(cosTimeoutForKey('housing-data/releases/test/complete-snapshot.json'), LARGE_TRANSFER_COS_TIMEOUT_MS)
  assert.equal(cosTimeoutForKey('housing-data/releases/test/manifest.json'), DEFAULT_COS_TIMEOUT_MS)
  assert.equal(cosTimeoutForKey('housing-data/releases/test/cities/beijing.json'), DEFAULT_COS_TIMEOUT_MS)
})
