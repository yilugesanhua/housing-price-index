import assert from 'node:assert/strict'
import test from 'node:test'

import watchdog from '../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/index.js'

const NOW = Date.parse('2026-08-10T01:45:00.000Z')
const baseEnv = {
  WATCHDOG_GITHUB_TOKEN: 'test-token',
  WATCHDOG_REPOSITORY: 'owner/repository',
  WATCHDOG_WORKFLOW: 'monthly-data-check.yml',
  WATCHDOG_DEFAULT_BRANCH: 'main',
}

function mockRequest({ scheduleRuns = [], dispatchRuns = [], calls = [] } = {}) {
  return (options, callback) => {
    const responseBody = options.method === 'POST'
      ? ''
      : JSON.stringify({ workflow_runs: options.path.includes('event=schedule') ? scheduleRuns : options.path.includes('event=workflow_dispatch') ? dispatchRuns : [] })
    calls.push({ method: options.method, path: options.path })
    const response = {
      statusCode: 200,
      on(event, handler) {
        if (event === 'data' && responseBody) handler(Buffer.from(responseBody))
        if (event === 'end') queueMicrotask(handler)
      },
    }
    queueMicrotask(() => callback(response))
    return { on() {}, write() {}, end() {}, destroy(error) { throw error } }
  }
}

test('dry-run detects a missing scheduled run without dispatching', async () => {
  const calls = []
  const result = await watchdog.runWatchdog({ env: { ...baseEnv, WATCHDOG_DRY_RUN: 'true' }, now: NOW, request: mockRequest({ calls }) })
  assert.equal(result.status, 'would_dispatch')
  assert.equal(result.reason, 'schedule_missing')
  assert.equal(calls.filter((call) => call.method === 'POST').length, 0)
})

test('dispatches only the monthly check workflow on the default branch', async () => {
  const calls = []
  const result = await watchdog.runWatchdog({ env: baseEnv, now: NOW, request: mockRequest({ calls }), claimSlot: async () => true })
  assert.equal(result.status, 'dispatched')
  const post = calls.find((call) => call.method === 'POST')
  assert.match(post.path, /actions\/workflows\/monthly-data-check\.yml\/dispatches/)
})

test('does not dispatch when another watchdog already claimed the same slot', async () => {
  const calls = []
  const result = await watchdog.runWatchdog({ env: baseEnv, now: NOW, request: mockRequest({ calls }), claimSlot: async () => false })
  assert.equal(result.status, 'idle')
  assert.equal(result.reason, 'already_claimed')
  assert.equal(calls.some((call) => call.method === 'POST'), false)
})

test('state claim stores one deterministic slot and rejects a duplicate claim', async () => {
  const stored = new Map()
  const database = {
    async runTransaction(work) {
      return work({
        collection() {
          return {
            doc(id) {
              return {
                async get() {
                  if (!stored.has(id)) {
                    const error = new Error('document not found')
                    error.errCode = -1
                    throw error
                  }
                  return { data: stored.get(id) }
                },
                async set({ data }) { stored.set(id, data) },
              }
            },
          }
        },
      })
    },
  }
  const expectedAt = '2026-08-10T01:32:00.000Z'
  assert.equal(await watchdog.claimDispatchSlot({ database, expectedAt, now: NOW }), true)
  assert.equal(await watchdog.claimDispatchSlot({ database, expectedAt, now: NOW }), false)
  assert.equal(stored.get(`monthly-data-check:${expectedAt}`).status, 'claimed')
})

test('does not dispatch when a schedule run is observed', async () => {
  const calls = []
  const result = await watchdog.runWatchdog({
    env: baseEnv,
    now: NOW,
    request: mockRequest({
      calls,
      scheduleRuns: [{ id: 123, status: 'completed', conclusion: 'success', head_branch: 'main', created_at: '2026-08-10T01:33:00.000Z' }],
    }),
  })
  assert.equal(result.status, 'idle')
  assert.equal(result.reason, 'schedule_observed')
  assert.equal(calls.some((call) => call.method === 'POST'), false)
})

test('reports a stalled candidate run once without dispatching another workflow', async () => {
  const calls = []
  const result = await watchdog.runWatchdog({
    env: { ...baseEnv, WATCHDOG_PUBLISH_WORKFLOW: 'monthly-data-auto-publish.yml' },
    now: NOW,
    request: (options, callback) => {
      const isPublish = options.path.includes('monthly-data-auto-publish.yml')
      const responseBody = options.method === 'POST' ? '' : JSON.stringify({ workflow_runs: isPublish
        ? [{ id: 789, status: 'in_progress', head_branch: 'main', created_at: '2026-08-10T00:30:00.000Z' }]
        : [] })
      calls.push({ method: options.method, path: options.path })
      const response = {
        statusCode: 200,
        on(event, handler) {
          if (event === 'data' && responseBody) handler(Buffer.from(responseBody))
          if (event === 'end') queueMicrotask(handler)
        },
      }
      queueMicrotask(() => callback(response))
      return { on() {}, write() {}, end() {}, destroy(error) { throw error } }
    },
    claimAlert: async () => true,
  })
  assert.equal(result.status, 'stalled')
  assert.equal(result.reason, 'candidate_stalled')
  assert.equal(result.runId, '789')
  assert.equal(calls.some((call) => call.method === 'POST'), false)
})

test('deduplicates a previously alerted stalled candidate run', async () => {
  const result = await watchdog.runWatchdog({
    env: baseEnv,
    now: NOW,
    request: (options, callback) => {
      const responseBody = options.method === 'POST' ? '' : JSON.stringify({ workflow_runs: options.path.includes('monthly-data-auto-publish.yml')
        ? [{ id: 789, status: 'queued', head_branch: 'main', created_at: '2026-08-10T00:30:00.000Z' }]
        : [] })
      const response = { statusCode: 200, on(event, handler) { if (event === 'data' && responseBody) handler(Buffer.from(responseBody)); if (event === 'end') queueMicrotask(handler) } }
      queueMicrotask(() => callback(response))
      return { on() {}, write() {}, end() {}, destroy(error) { throw error } }
    },
    claimAlert: async () => false,
  })
  assert.equal(result.status, 'idle')
  assert.equal(result.reason, 'already_alerted')
})

test('missing token fails closed before calling GitHub', async () => {
  await assert.rejects(() => watchdog.runWatchdog({ env: { ...baseEnv, WATCHDOG_GITHUB_TOKEN: '' }, now: NOW, request: mockRequest() }), /WATCHDOG_GITHUB_TOKEN/)
})
