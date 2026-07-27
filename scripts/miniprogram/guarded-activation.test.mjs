import assert from 'node:assert/strict'
import test from 'node:test'
import { activatePointerWithRollback, GuardedActivationError } from './guarded-activation.mjs'
import { stableJson } from './remote-data-lib.mjs'

const pointer = (version) => ({
  dataset_version: version,
  dataset_as_of: version.slice(0, 7),
  schema_version: '1.3.0',
  manifest_file_id: `cloud://env.bucket/housing-data/releases/${version}/manifest.json`,
  manifest_sha256: 'a'.repeat(64),
  published_at: null,
  previous_dataset_version: null,
  next_check_at: '2026-09-15T01:40:00.000Z',
})
const previous = pointer('2026-06-abcdefabcdef')
const candidate = pointer('2026-07-0123456789ab')

function harness(options = {}) {
  let remote = stableJson(previous)
  const events = []
  return {
    events,
    get remote() { return remote },
    args: {
      candidate,
      candidateText: stableJson(candidate),
      previous,
      rollbackEligible: options.rollbackEligible ?? true,
      writePointer: async (text, label) => {
        events.push(`write:${label}`)
        if (options.failWrite === label) throw new Error(`write failed: ${label}`)
        remote = text
      },
      readPointerText: async (label) => {
        events.push(`read:${label}`)
        if (options.corruptRead === label) return `${remote} `
        return remote
      },
      guardCandidate: async () => { events.push('guard:candidate'); if (options.failGuard) throw new Error('full remote guard failed') },
      guardRollback: async () => { events.push('guard:rollback'); if (options.failRollbackGuard) throw new Error('rollback guard failed') },
      recordRollback: async () => events.push('audit:rollback'),
      recordFailure: async ({ rollbackStatus }) => events.push(`audit:failure:${rollbackStatus}`),
      now: () => '2026-08-17T02:00:00.000Z',
    },
  }
}

test('publishes only after pointer round-trip and full guard succeed', async () => {
  const item = harness()
  assert.deepEqual(await activatePointerWithRollback(item.args), { status: 'published', rollback_status: 'not-needed' })
  assert.equal(item.remote, stableJson(candidate))
  assert.deepEqual(item.events, ['write:candidate', 'read:candidate', 'guard:candidate'])
})

test('pointer-switch interruption restores and verifies the previous pointer', async () => {
  const item = harness({ corruptRead: 'candidate' })
  await assert.rejects(() => activatePointerWithRollback(item.args), (error) => error instanceof GuardedActivationError && error.rollbackStatus === 'succeeded')
  assert.match(item.remote, /2026-06-abcdefabcdef/)
  assert.deepEqual(item.events.slice(-4), ['read:automatic-rollback', 'guard:rollback', 'audit:rollback', 'audit:failure:succeeded'])
})

test('post-switch guard failure automatically rolls back and records the outcome', async () => {
  const item = harness({ failGuard: true })
  await assert.rejects(() => activatePointerWithRollback(item.args), /automatic rollback succeeded/)
  assert.match(item.remote, /2026-06-abcdefabcdef/)
  assert.ok(item.events.includes('audit:rollback'))
})

test('rollback failure is surfaced as a distinct alert condition', async () => {
  const item = harness({ failGuard: true, failWrite: 'automatic-rollback' })
  await assert.rejects(() => activatePointerWithRollback(item.args), (error) => error instanceof GuardedActivationError && error.rollbackStatus === 'failed' && /write failed/.test(error.message))
  assert.match(item.remote, /2026-07-0123456789ab/)
  assert.ok(item.events.includes('audit:failure:failed'))
})

test('missing rollback eligibility fails closed without inventing a target', async () => {
  const item = harness({ failGuard: true, rollbackEligible: false })
  await assert.rejects(() => activatePointerWithRollback(item.args), (error) => error.rollbackStatus === 'not-available')
  assert.ok(item.events.includes('audit:failure:not-available'))
})
