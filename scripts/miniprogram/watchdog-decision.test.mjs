import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decideWatchdog,
  findStalledRun,
  isExpectedScheduleSlot,
  latestExpectedScheduleAt,
} from './watchdog-decision.mjs'

const at = (value) => Date.parse(value)

test('matches the monthly check schedule expressed in UTC', () => {
  assert.equal(isExpectedScheduleSlot(at('2026-08-10T01:27:00.000Z')), true)
  assert.equal(isExpectedScheduleSlot(at('2026-08-10T02:30:00.000Z')), true)
  assert.equal(isExpectedScheduleSlot(at('2026-08-10T01:22:00.000Z')), false)
  assert.equal(isExpectedScheduleSlot(at('2026-08-09T01:27:00.000Z')), false)
})

test('finds the latest due slot without inventing a slot outside the configured windows', () => {
  assert.equal(new Date(latestExpectedScheduleAt(at('2026-08-10T01:35:00.000Z'))).toISOString(), '2026-08-10T01:32:00.000Z')
  assert.equal(latestExpectedScheduleAt(at('2026-08-09T03:00:00.000Z'), 30), null)
})

test('waits through the grace period', () => {
  const result = decideWatchdog({
    now: at('2026-08-10T01:35:00.000Z'),
    expectedAt: at('2026-08-10T01:32:00.000Z'),
    graceMs: 10 * 60 * 1000,
  })
  assert.equal(result.shouldDispatch, false)
  assert.equal(result.reason, 'within_grace_period')
})

test('dispatches once when the scheduled run is missing', () => {
  const result = decideWatchdog({
    now: at('2026-08-10T01:45:00.000Z'),
    expectedAt: at('2026-08-10T01:32:00.000Z'),
    scheduleRuns: [],
    dispatchRuns: [],
  })
  assert.equal(result.shouldDispatch, true)
  assert.equal(result.reason, 'schedule_missing')
})

test('does not dispatch when schedule is queued, successful, or already supplemented', () => {
  const base = { now: at('2026-08-10T01:45:00.000Z'), expectedAt: at('2026-08-10T01:32:00.000Z') }
  assert.equal(decideWatchdog({ ...base, scheduleRuns: [{ id: 1, status: 'queued', head_branch: 'main', created_at: '2026-08-10T01:33:00.000Z' }] }).reason, 'schedule_observed')
  assert.equal(decideWatchdog({ ...base, scheduleRuns: [{ id: 2, status: 'completed', conclusion: 'success', head_branch: 'main', created_at: '2026-08-10T01:33:00.000Z' }] }).reason, 'schedule_observed')
  assert.equal(decideWatchdog({ ...base, dispatchRuns: [{ id: 3, status: 'completed', conclusion: 'success', head_branch: 'main', created_at: '2026-08-10T01:40:00.000Z' }] }).reason, 'already_dispatched')
})

test('ignores runs from another branch and reports a failed schedule separately', () => {
  const result = decideWatchdog({
    now: at('2026-08-10T01:45:00.000Z'),
    expectedAt: at('2026-08-10T01:32:00.000Z'),
    scheduleRuns: [
      { id: 4, status: 'completed', conclusion: 'failure', head_branch: 'feature', created_at: '2026-08-10T01:33:00.000Z' },
      { id: 5, status: 'completed', conclusion: 'failure', head_branch: 'main', created_at: '2026-08-10T01:33:00.000Z' },
    ],
  })
  assert.equal(result.shouldDispatch, false)
  assert.equal(result.reason, 'schedule_failed')
  assert.equal(result.failedRunId, '5')
})

test('fails closed on malformed input', () => {
  assert.deepEqual(decideWatchdog({ now: NaN }), { shouldDispatch: false, reason: 'invalid_input', expectedAt: null })
})

test('finds only a same-branch queued or in-progress run older than the stall threshold', () => {
  const now = at('2026-08-10T02:00:00.000Z')
  assert.deepEqual(findStalledRun({
    now,
    stallMs: 30 * 60 * 1000,
    runs: [
      { id: 1, status: 'in_progress', head_branch: 'main', created_at: '2026-08-10T01:00:00.000Z' },
      { id: 2, status: 'queued', head_branch: 'feature', created_at: '2026-08-10T00:00:00.000Z' },
      { id: 3, status: 'completed', conclusion: 'failure', head_branch: 'main', created_at: '2026-08-10T00:00:00.000Z' },
    ],
  }), {
    runId: '1',
    createdAt: '2026-08-10T01:00:00.000Z',
    ageMs: 60 * 60 * 1000,
  })
})

test('fails closed when a stalled run has no durable GitHub run ID', () => {
  assert.equal(findStalledRun({
    now: at('2026-08-10T02:00:00.000Z'),
    runs: [{ status: 'in_progress', head_branch: 'main', created_at: '2026-08-10T01:00:00.000Z' }],
  }), null)
})
