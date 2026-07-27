import assert from 'node:assert/strict'
import test from 'node:test'
import { assertRehearsalKey } from './tencent-cloud-sdk.mjs'

test('isolated write rehearsal accepts only its own run prefix', () => {
  assert.equal(assertRehearsalKey('housing-data/rehearsals/12345/probe.json', '12345'), 'housing-data/rehearsals/12345/probe.json')
  assert.throws(() => assertRehearsalKey('housing-data/current.json', '12345'), /Refusing non-rehearsal/)
  assert.throws(() => assertRehearsalKey('housing-data/releases/2026-07-test/manifest.json', '12345'), /Refusing non-rehearsal/)
  assert.throws(() => assertRehearsalKey('housing-data/rehearsals/other/probe.json', '12345'), /Refusing non-rehearsal/)
  assert.throws(() => assertRehearsalKey('housing-data/rehearsals/12345/../current.json', '12345'), /Refusing non-rehearsal/)
})
