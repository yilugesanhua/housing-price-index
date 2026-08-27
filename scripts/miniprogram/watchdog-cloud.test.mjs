import assert from 'node:assert/strict'
import test from 'node:test'

import watchdog from '../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/index.js'
import contract from '../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/discovery-contract.js'
import cloudDiscovery from '../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/cloud-discovery.js'

const NOW = Date.parse('2026-08-10T01:50:00.000Z')
const baseEnv = {
  WATCHDOG_GITHUB_TOKEN: 'test-token',
  WATCHDOG_REPOSITORY: 'owner/repository',
  WATCHDOG_WORKFLOW: 'monthly-data-check.yml',
  WATCHDOG_DEFAULT_BRANCH: 'main',
}

function memoryDatabase() {
  const stored = new Map()
  return {
    stored,
    database: {
      async runTransaction(work) {
        return work({
          collection(name) {
            assert.equal(name, 'monthlyDataWatchdog')
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
    },
  }
}

function readOnlyOutput(status = 'waiting') {
  return {
    pointer: {
      dataset_as_of: '2026-06',
      dataset_version: '2026-06-safe-version',
      next_check_at: '2026-09-15T01:15:00.000Z',
      manifest_sha256: 'a'.repeat(64),
      pointer_sha256: 'b'.repeat(64),
    },
    calendar: {
      year: 2026,
      source_url: 'https://www.stats.gov.cn/sj/fbrc/bnxxfb/',
      source_urls: [
        'https://www.stats.gov.cn/sj/fbrc/index_fbrc.html',
        'https://www.stats.gov.cn/sj/fbrc/bnxxfb/',
      ],
      raw_content_sha256: 'c'.repeat(64),
      entries: [],
      source_responses: [],
    },
    result: {
      status,
      dataset_as_of: '2026-06',
      expected_stat_month: '2026-07',
      latest_official_month: null,
      latest_official_url: null,
      release_window: 'waiting',
      official_list_checked: false,
      official_release_detected: false,
    },
  }
}

function strictSlot(iso) {
  const slot = contract.parseSlotId(iso)
  assert.ok(slot, `invalid test slot: ${iso}`)
  return slot
}

function seedCompletedSlots(stored, dateText) {
  for (const slot of contract.scheduledSlotsForBeijingDate(dateText)) {
    stored.set(`discovery-slot:${slot.slot_id}`, {
      _id: `discovery-slot:${slot.slot_id}`,
      status: 'succeeded',
      timing_status: 'on_time',
    })
  }
}

function mockRequest({ scheduleRuns = [], dispatchRuns = [], calls = [] } = {}) {
  return (options, callback) => {
    const responseBody = options.method === 'POST'
      ? ''
      : JSON.stringify({ workflow_runs: options.path.includes('event=schedule') ? scheduleRuns : options.path.includes('event=workflow_dispatch') ? dispatchRuns : [] })
    const call = { method: options.method, path: options.path, body: '' }
    calls.push(call)
    const response = {
      statusCode: 200,
      on(event, handler) {
        if (event === 'data' && responseBody) handler(Buffer.from(responseBody))
        if (event === 'end') queueMicrotask(handler)
      },
    }
    queueMicrotask(() => callback(response))
    return {
      on() {},
      write(chunk) { call.body += Buffer.from(chunk).toString('utf8') },
      end() {},
      destroy(error) { throw error },
    }
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
  assert.deepEqual(JSON.parse(post.body), {
    ref: 'main',
    inputs: { watchdog_slot: '2026-08-10T01:35:00.000Z' },
  })
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
  const expectedAt = '2026-08-10T01:35:00.000Z'
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
      scheduleRuns: [{ id: 123, status: 'completed', conclusion: 'success', head_branch: 'main', created_at: '2026-08-10T01:36:00.000Z' }],
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

test('strict discovery exposes exactly 27 Beijing 20-minute slots from 09:15 through 17:55', () => {
  const slots = contract.discoverySlotsForBeijingDate('2026-08-10')
  assert.equal(slots.length, 27)
  assert.deepEqual(slots.map((slot) => slot.planned_at).slice(0, 3), [
    '2026-08-10T01:15:00.000Z',
    '2026-08-10T01:35:00.000Z',
    '2026-08-10T01:55:00.000Z',
  ])
  assert.equal(slots.at(-1).planned_at, '2026-08-10T09:55:00.000Z')
  assert.equal(contract.slotPolicy(slots.at(-1)).retry_deadline_at, '2026-08-10T10:00:00.000Z')
})

test('strict controller starts each due read-only slot once and records an immutable observation', async () => {
  const { database, stored } = memoryDatabase()
  seedCompletedSlots(stored, '2026-08-09')
  let calls = 0
  const performDiscovery = async () => {
    calls += 1
    return readOnlyOutput()
  }
  const calendarNow = Date.parse('2026-08-10T01:00:30.000Z')
  const discoveryNow = Date.parse('2026-08-10T01:15:30.000Z')
  const first = await watchdog.runStrictController({ database, now: calendarNow, clock: () => calendarNow, performDiscovery })
  const second = await watchdog.runStrictController({ database, now: discoveryNow, clock: () => discoveryNow, performDiscovery })
  const duplicate = await watchdog.runStrictController({ database, now: discoveryNow, clock: () => discoveryNow, performDiscovery })

  assert.equal(first.status, 'processed')
  assert.equal(second.status, 'processed')
  assert.equal(duplicate.status, 'idle')
  assert.equal(calls, 2)
  const record = stored.get('discovery-slot:2026-08-10T01:15:00.000Z')
  assert.equal(record.status, 'succeeded')
  assert.equal(record.timing_status, 'on_time')
  assert.match(record.observation_id, /^[a-f0-9]{64}$/)
  const observation = stored.get(`discovery-observation:${record.observation_id}`)
  assert.equal(observation.payload_sha256.length, 64)
  assert.equal(observation.handoff_identity, null)
})

test('strict controller records every missed prior-day discovery slot as expired without fetching', async () => {
  const { database, stored } = memoryDatabase()
  let calls = 0
  const now = Date.parse('2026-08-11T00:10:00.000Z')
  const result = await watchdog.runStrictController({
    database,
    now,
    clock: () => now,
    performDiscovery: async () => {
      calls += 1
      return readOnlyOutput()
    },
  })

  const expiredDiscovery = [...stored.values()].filter((record) => record.task === 'discovery' && record.status === 'expired')
  const expiredCalendar = [...stored.values()].filter((record) => record.task === 'calendar' && record.status === 'expired')
  assert.equal(result.status, 'attention')
  assert.equal(calls, 0)
  assert.equal(expiredDiscovery.length, 27)
  assert.equal(expiredCalendar.length, 1)
  assert.ok(expiredDiscovery.every((record) => record.last_error_code === undefined))
})

test('strict controller keeps a late start visible instead of rewriting it as on-time success', async () => {
  const { database, stored } = memoryDatabase()
  const now = Date.parse('2026-08-10T01:18:00.000Z')
  const output = await watchdog.runStrictController({ database, now, clock: () => now, performDiscovery: async () => readOnlyOutput() })
  const report = output.slots.find((entry) => entry.slot_id === '2026-08-10T01:15:00.000Z')
  const record = stored.get('discovery-slot:2026-08-10T01:15:00.000Z')
  assert.equal(output.status, 'attention')
  assert.equal(report.status, 'succeeded')
  assert.equal(report.timing_status, 'late')
  assert.equal(record.timing_status, 'late')
  assert.ok(record.status_history.some((entry) => entry.event === 'late'))
})

test('strict slot lease blocks a duplicate runner and can be reclaimed after lease expiry', async () => {
  const { database } = memoryDatabase()
  const slot = strictSlot('2026-08-10T01:15:00.000Z')
  const now = Date.parse(slot.planned_at)
  const first = await watchdog.claimDiscoverySlot({ database, slot, now, owner: 'first', leaseMs: 60_000, maxAttempts: 3 })
  const duplicate = await watchdog.claimDiscoverySlot({ database, slot, now: now + 30_000, owner: 'second', leaseMs: 60_000, maxAttempts: 3 })
  const resumed = await watchdog.claimDiscoverySlot({ database, slot, now: now + 60_001, owner: 'second', leaseMs: 60_000, maxAttempts: 3 })
  assert.equal(first.state, 'claimed')
  assert.equal(duplicate.state, 'leased')
  assert.equal(resumed.state, 'claimed')
  assert.equal(resumed.record.attempts, 2)
})

test('strict slot does not start a new retry after its 20-minute window ends', async () => {
  const { database, stored } = memoryDatabase()
  const slot = strictSlot('2026-08-10T01:15:00.000Z')
  const expired = await watchdog.claimDiscoverySlot({
    database,
    slot,
    now: Date.parse('2026-08-10T01:35:00.000Z'),
    owner: 'late-runner',
    leaseMs: 60_000,
    maxAttempts: 3,
  })
  assert.equal(expired.state, 'expired')
  assert.equal(stored.get('discovery-slot:2026-08-10T01:15:00.000Z').status, 'expired')
})

test('network failure retries within the same slot and preserves the failure reason', async () => {
  const { database, stored } = memoryDatabase()
  const calendarNow = Date.parse('2026-08-10T01:00:00.000Z')
  const slotNow = Date.parse('2026-08-10T01:15:00.000Z')
  await watchdog.runStrictController({ database, now: calendarNow, clock: () => calendarNow, performDiscovery: async () => readOnlyOutput() })
  const timeout = Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })
  const failed = await watchdog.runStrictController({ database, now: slotNow, clock: () => slotNow, performDiscovery: async () => { throw timeout } })
  const recordAfterFailure = stored.get('discovery-slot:2026-08-10T01:15:00.000Z')
  const recoveredAt = slotNow + 60_000
  const recovered = await watchdog.runStrictController({ database, now: recoveredAt, clock: () => recoveredAt, performDiscovery: async () => readOnlyOutput() })
  const recordAfterRecovery = stored.get('discovery-slot:2026-08-10T01:15:00.000Z')
  assert.equal(failed.status, 'attention')
  assert.equal(recordAfterFailure.status, 'retrying')
  assert.equal(recordAfterFailure.last_error_code, 'ETIMEDOUT')
  assert.equal(recovered.status, 'processed')
  assert.equal(recordAfterRecovery.status, 'succeeded')
  assert.equal(recordAfterRecovery.attempts, 2)
})

test('observation records are immutable by identity', async () => {
  const { database } = memoryDatabase()
  const observation = {
    observation_id: 'a'.repeat(64),
    payload_sha256: 'b'.repeat(64),
    status: 'waiting',
  }
  assert.deepEqual(await watchdog.writeObservation({ database, observation }), {
    state: 'stored',
    id: `discovery-observation:${observation.observation_id}`,
  })
  assert.deepEqual(await watchdog.writeObservation({ database, observation }), {
    state: 'existing',
    id: `discovery-observation:${observation.observation_id}`,
  })
  await assert.rejects(
    () => watchdog.writeObservation({ database, observation: { ...observation, payload_sha256: 'c'.repeat(64) } }),
    /不可变观察报告身份冲突/,
  )
})

test('observation artifacts use a deterministic object and reject overwrite', async () => {
  const stored = new Map()
  const cloudSdk = {
    async downloadFile({ fileID }) {
      const key = fileID.split('/').slice(-2).join('/')
      if (!stored.has(key)) {
        const error = new Error('not found')
        error.errCode = -1
        throw error
      }
      return { fileContent: stored.get(key) }
    },
    async uploadFile({ cloudPath, fileContent }) {
      stored.set(cloudPath.split('/').slice(-2).join('/'), Buffer.from(fileContent))
    },
  }
  const observation = {
    observation_id: 'a'.repeat(64),
    payload_sha256: 'b'.repeat(64),
    slot_id: '2026-08-10T01:15:00.000Z',
  }
  // The helper only treats storage bytes as immutable; schema validation is
  // covered by the shared discovery-contract and GitHub gate tests.
  const first = await watchdog.writeObservationArtifact({ cloudSdk, observation })
  const second = await watchdog.writeObservationArtifact({ cloudSdk, observation })
  assert.equal(first.state, 'stored')
  assert.equal(second.state, 'existing')
  const conflicting = { ...observation, payload_sha256: 'c'.repeat(64) }
  await assert.rejects(() => watchdog.writeObservationArtifact({ cloudSdk, observation: conflicting }), /不可变观察对象身份冲突/)
})

test('cloud discovery reads only the fixed production pointer and has no storage write method', async () => {
  const pointer = JSON.stringify({
    dataset_as_of: '2026-06',
    dataset_version: '2026-06-safe-version',
    next_check_at: '2026-09-15T01:15:00.000Z',
    manifest_sha256: 'd'.repeat(64),
  })
  const calls = []
  const cloudSdk = {
    async downloadFile(input) {
      calls.push(input)
      return { fileContent: Buffer.from(pointer) }
    },
    async uploadFile() { throw new Error('must never write') },
    async deleteFile() { throw new Error('must never write') },
  }
  const result = await cloudDiscovery.readProductionPointer({ cloudSdk })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].fileID, cloudDiscovery.DEFAULT_CURRENT_FILE_ID)
  assert.equal(result.dataset_as_of, '2026-06')
  assert.throws(() => cloudDiscovery.assertPointerFileId('cloud://another-object'), /白名单外/)
})
