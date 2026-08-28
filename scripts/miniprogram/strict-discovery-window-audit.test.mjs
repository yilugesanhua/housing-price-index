import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

import { assertStrictDiscoveryWindow, auditStrictDiscoveryWindow, parseAuditInputText } from './strict-discovery-window-audit.mjs'

const require = createRequire(import.meta.url)
const contract = require('../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/discovery-contract.js')

function validRecord(slot, index) {
  const policy = contract.slotPolicy(slot)
  const startedAt = new Date(slot.planned_at_ms + 5_000).toISOString()
  const completedAt = new Date(slot.planned_at_ms + 11_000).toISOString()
  return {
    _id: `discovery-slot:${slot.slot_id}`,
    format: 'housing-data-discovery-slot-v1',
    slot_id: slot.slot_id,
    task: 'discovery',
    planned_at: slot.planned_at,
    start_deadline_at: policy.start_deadline_at,
    retry_deadline_at: policy.retry_deadline_at,
    attempts: { $numberInt: '1' },
    status: 'succeeded',
    result_status: 'update_available',
    timing_status: 'on_time',
    status_history: [
      { event: 'pending', at: slot.planned_at },
      { event: 'started', at: startedAt },
      { event: 'succeeded', at: completedAt },
    ],
    retryable: false,
    late_at: null,
    actual_started_at: startedAt,
    completed_at: completedAt,
    completed_after_deadline: false,
    observation_id: String(index).padStart(64, 'a'),
    observation_payload_sha256: String(index).padStart(64, 'b'),
    handoff_identity: `housing-data-discovery-v1:${String(index).padStart(64, 'c')}`,
  }
}

function validWindow(dateText = '2026-08-27') {
  return contract.discoverySlotsForBeijingDate(dateText).map(validRecord)
}

function validObservation(record) {
  return {
    _id: `discovery-observation:${record.observation_id}`,
    format: 'housing-data-discovery-observation-v1',
    observation_id: record.observation_id,
    slot_id: record.slot_id,
    payload_sha256: record.observation_payload_sha256,
    handoff_identity: record.handoff_identity,
  }
}

function validAuditRecords(dateText = '2026-08-27') {
  const records = validWindow(dateText)
  return [...records, ...records.map(validObservation)]
}

test('accepts one complete on-time record for every strict discovery slot', () => {
  const records = [
    { _id: 'discovery-slot:2026-08-27T01:00:00.000Z', task: 'calendar', slot_id: '2026-08-27T01:00:00.000Z' },
    ...validAuditRecords(),
  ]
  assert.deepEqual(assertStrictDiscoveryWindow({ dateText: '2026-08-27', records }), {
    status: 'passed',
    date: '2026-08-27',
    expected_slot_count: 27,
    received_slot_count: 27,
    unique_slot_count: 27,
    errors: [],
  })
})

test('accepts the JSON-lines format produced by CloudBase collection exports', () => {
  const records = validAuditRecords()
  const exported = records.map((record) => JSON.stringify(record)).join('\n')
  assert.deepEqual(parseAuditInputText(exported), records)
})

test('reports a missing strict discovery slot', () => {
  const records = validAuditRecords()
  const result = auditStrictDiscoveryWindow({ dateText: '2026-08-27', records: records.filter((record) => record._id !== 'discovery-slot:2026-08-27T01:15:00.000Z') })
  assert.equal(result.status, 'failed')
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /2026-08-27T01:15:00\.000Z: missing discovery slot/)
})

test('reports duplicates and a late discovery separately', () => {
  const records = validAuditRecords()
  records[0].actual_started_at = '2026-08-27T01:17:00.001Z'
  records.push({ ...records[1] })
  const result = auditStrictDiscoveryWindow({ dateText: '2026-08-27', records })
  assert.equal(result.status, 'failed')
  assert.ok(result.errors.some((error) => error.includes('two-minute deadline')))
  assert.ok(result.errors.some((error) => error.includes('duplicate discovery slot records')))
})

test('rejects a failed slot and incomplete immutable observation identity', () => {
  const records = validAuditRecords()
  records[0].status = 'failed'
  records[1].observation_id = 'not-a-sha256'
  const result = auditStrictDiscoveryWindow({ dateText: '2026-08-27', records })
  assert.equal(result.status, 'failed')
  assert.ok(result.errors.some((error) => error.includes('on-time success')))
  assert.ok(result.errors.some((error) => error.includes('immutable observation identity is incomplete')))
})

test('rejects an unexpected discovery slot in the audited day', () => {
  const records = validAuditRecords()
  records.push({
    ...records[0],
    _id: 'discovery-slot:2026-08-27T10:15:00.000Z',
    slot_id: '2026-08-27T10:15:00.000Z',
    planned_at: '2026-08-27T10:15:00.000Z',
  })
  const result = auditStrictDiscoveryWindow({ dateText: '2026-08-27', records })
  assert.equal(result.status, 'failed')
  assert.ok(result.errors.some((error) => error.includes('unexpected discovery slot')))
})

test('rejects a slot whose immutable observation record has a different payload hash', () => {
  const records = validAuditRecords()
  const observation = records.find((record) => record._id.startsWith('discovery-observation:'))
  observation.payload_sha256 = 'f'.repeat(64)
  const result = auditStrictDiscoveryWindow({ dateText: '2026-08-27', records })
  assert.equal(result.status, 'failed')
  assert.ok(result.errors.some((error) => error.includes('payload hash does not match')))
})
