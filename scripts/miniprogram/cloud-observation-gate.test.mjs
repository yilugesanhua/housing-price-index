import assert from 'node:assert/strict'
import test from 'node:test'
import { sha256 } from './remote-data-lib.mjs'
import { validateCloudObservation, validateObservationPayload, verifyCloudObservation, verifyCloudObservationIdentity } from './cloud-observation-gate.mjs'

const slotId = '2026-08-17T01:35:00.000Z'
const officialUrl = 'https://www.stats.gov.cn/sj/zxfb/202608/t20260817_1.html'
const idempotencyKey = sha256(`2026-07\n${officialUrl}`)
const report = {
  status: 'update_available',
  slot_id: slotId,
  dataset_as_of: '2026-06',
  expected_stat_month: '2026-07',
  latest_official_month: '2026-07',
  latest_official_url: officialUrl,
}
const handoff = {
  format: 'housing-data-discovery-handoff-v1',
  status: 'update_available',
  slot_id: slotId,
  expected_stat_month: '2026-07',
  official_url: officialUrl,
  idempotency_key: idempotencyKey,
  handoff_identity: `housing-data-discovery-v1:${idempotencyKey}`,
}
const payload = {
  format: 'housing-data-discovery-observation-v1',
  observation_id: 'a'.repeat(64),
  slot_id: slotId,
  task: 'discovery',
  planned_at: slotId,
  actual_started_at: '2026-08-17T01:35:10.000Z',
  completed_at: '2026-08-17T01:35:20.000Z',
  timing_status: 'on_time',
  status: 'update_available',
  result: { ...report },
  pointer: { dataset_as_of: '2026-06', pointer_sha256: 'b'.repeat(64) },
  calendar: { calendar_sha256: 'c'.repeat(64) },
  discovery_responses: [],
  idempotency_key: idempotencyKey,
  handoff_identity: handoff.handoff_identity,
}
const observation = { ...payload, payload_sha256: sha256(JSON.stringify(payload)) }

function fakeClient(value = observation) {
  return { async getObject() { return Buffer.from(JSON.stringify(value)) } }
}

test('validates an on-time CloudBase update and binds it to the GitHub handoff', () => {
  assert.equal(validateObservationPayload(observation).payload_sha256, observation.payload_sha256)
  const result = validateCloudObservation({ observation, report, handoff })
  assert.deepEqual(result, {
    status: 'passed',
    slot_id: slotId,
    observation_id: observation.observation_id,
    observation_payload_sha256: observation.payload_sha256,
    timing_status: 'on_time',
    handoff_identity: handoff.handoff_identity,
  })
})

test('reads exactly the deterministic observation object for the requested slot', async () => {
  const result = await verifyCloudObservation({ report, handoff, client: fakeClient() })
  assert.equal(result.status, 'passed')
  assert.match(result.key, /^housing-data\/discovery\/observations\/[a-f0-9]{64}\.json$/)
})

test('rejects a tampered payload or mismatched observation identity', async () => {
  const tampered = { ...observation, status: 'current' }
  await assert.rejects(() => verifyCloudObservation({ report, handoff, client: fakeClient(tampered) }), /payload hash mismatch/)
  await assert.rejects(() => verifyCloudObservationIdentity({
    slotId,
    observationId: 'd'.repeat(64),
    payloadSha256: observation.payload_sha256,
    handoffIdentity: handoff.handoff_identity,
    client: fakeClient(),
  }), /observation ID changed/)
})

test('blocks a late observation from automatic publication', () => {
  const latePayload = { ...observation, timing_status: 'late' }
  delete latePayload.payload_sha256
  const late = { ...latePayload, payload_sha256: sha256(JSON.stringify(latePayload)) }
  assert.throws(() => validateCloudObservation({ observation: late, report, handoff }), /observation was late/)
})
