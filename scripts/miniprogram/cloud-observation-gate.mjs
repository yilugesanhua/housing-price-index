import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createTencentCloudClient, DEFAULT_CLOUD_ENV_ID, STORAGE_BUCKET_ID, STORAGE_REGION } from './tencent-cloud-sdk.mjs'
import { sha256 } from './remote-data-lib.mjs'

const require = createRequire(import.meta.url)
const contract = require('../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/discovery-contract.js')
const SHA256 = /^[a-f0-9]{64}$/

function assert(condition, message) {
  if (!condition) throw new Error(`Cloud observation gate rejected: ${message}`)
}

function cloneWithoutPayloadHash(observation) {
  const { payload_sha256: ignored, ...payload } = observation || {}
  return payload
}

export function validateObservationPayload(observation) {
  assert(observation?.format === 'housing-data-discovery-observation-v1', 'observation format is invalid')
  assert(contract.parseSlotId(observation.slot_id), 'observation slot ID is invalid')
  assert(SHA256.test(observation.observation_id || ''), 'observation ID is invalid')
  assert(SHA256.test(observation.payload_sha256 || ''), 'observation payload hash is invalid')
  assert(observation.payload_sha256 === sha256(JSON.stringify(cloneWithoutPayloadHash(observation))), 'observation payload hash mismatch')
  assert(observation.planned_at === observation.slot_id, 'observation planned slot does not match slot ID')
  assert(['on_time', 'late'].includes(observation.timing_status), 'observation timing status is invalid')
  assert(Number.isFinite(Date.parse(observation.actual_started_at || '')), 'observation start time is invalid')
  assert(Number.isFinite(Date.parse(observation.completed_at || '')), 'observation completion time is invalid')
  assert(['waiting', 'current', 'update_available', 'anomaly'].includes(observation.status), 'observation result status is invalid')
  assert(observation.result?.status === observation.status, 'observation nested result status mismatch')
  assert(SHA256.test(observation.pointer?.pointer_sha256 || ''), 'observation pointer identity is invalid')
  assert(/^[a-f0-9]{64}$/.test(observation.calendar?.calendar_sha256 || ''), 'observation calendar identity is invalid')
  return observation
}

export function validateCloudObservation({ observation, report, handoff = null }) {
  validateObservationPayload(observation)
  assert(report && typeof report === 'object', 'GitHub discovery report is missing')
  assert(observation.slot_id === report.slot_id, 'CloudBase slot ID does not match GitHub report')
  assert(observation.status === report.status, 'CloudBase status does not match GitHub report')
  assert(observation.pointer.dataset_as_of === report.dataset_as_of, 'CloudBase pointer month does not match GitHub report')
  if (report.status === 'update_available') {
    assert(observation.timing_status === 'on_time', 'CloudBase observation was late; automatic publication is blocked')
    assert(observation.result?.expected_stat_month === report.expected_stat_month, 'CloudBase expected month does not match GitHub report')
    assert(observation.result?.latest_official_month === report.latest_official_month, 'CloudBase official month does not match GitHub report')
    assert(observation.result?.latest_official_url === report.latest_official_url, 'CloudBase official URL does not match GitHub report')
    assert(observation.handoff_identity, 'CloudBase observation has no handoff identity')
    assert(handoff?.format === 'housing-data-discovery-handoff-v1', 'GitHub handoff is missing')
    assert(handoff.slot_id === observation.slot_id, 'CloudBase slot ID does not match GitHub handoff')
    assert(handoff.handoff_identity === observation.handoff_identity, 'CloudBase handoff identity does not match GitHub handoff')
    assert(handoff.idempotency_key === observation.idempotency_key, 'CloudBase idempotency key does not match GitHub handoff')
    assert(handoff.expected_stat_month === observation.result.expected_stat_month, 'CloudBase handoff month does not match GitHub handoff')
    assert(handoff.official_url === observation.result.latest_official_url, 'CloudBase handoff URL does not match GitHub handoff')
  } else {
    assert(!handoff, 'A non-update observation cannot carry a publication handoff')
  }
  return {
    status: 'passed',
    slot_id: observation.slot_id,
    observation_id: observation.observation_id,
    observation_payload_sha256: observation.payload_sha256,
    timing_status: observation.timing_status,
    handoff_identity: observation.handoff_identity || null,
  }
}

export async function readCloudObservation({ slotId, client }) {
  assert(contract.parseSlotId(slotId), 'requested slot ID is invalid')
  assert(client && typeof client.getObject === 'function', 'read-only Tencent Cloud client is unavailable')
  const key = contract.observationObjectKey(slotId)
  const body = await client.getObject(key)
  let observation
  try {
    observation = JSON.parse(body.toString('utf8'))
  } catch {
    throw new Error('CloudBase observation object is not valid JSON')
  }
  return { key, observation: validateObservationPayload(observation) }
}

export async function verifyCloudObservation({ report, handoff = null, client }) {
  assert(report?.slot_id, 'GitHub discovery report has no slot ID')
  const fetched = await readCloudObservation({ slotId: report.slot_id, client })
  const gate = validateCloudObservation({ observation: fetched.observation, report, handoff })
  return { ...gate, key: fetched.key, observation: fetched.observation }
}

export async function verifyCloudObservationIdentity({ slotId, observationId, payloadSha256, handoffIdentity, client }) {
  const fetched = await readCloudObservation({ slotId, client })
  assert(fetched.observation.status === 'update_available', 'CloudBase observation is not an available update')
  assert(fetched.observation.timing_status === 'on_time', 'CloudBase observation was late')
  assert(fetched.observation.observation_id === observationId, 'CloudBase observation ID changed')
  assert(fetched.observation.payload_sha256 === payloadSha256, 'CloudBase observation payload hash changed')
  assert(fetched.observation.handoff_identity === handoffIdentity, 'CloudBase handoff identity changed')
  return { status: 'passed', key: fetched.key, observation: fetched.observation }
}

async function main() {
  const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  const reportPath = resolve(argument('report') || 'work/monthly-data-check/report.json')
  const handoffPath = argument('handoff') ? resolve(argument('handoff')) : null
  const outputPath = resolve(argument('output') || 'work/monthly-data-check/cloud-observation.json')
  const client = createTencentCloudClient({
    secretId: process.env.TENCENTCLOUD_MONITOR_SECRET_ID,
    secretKey: process.env.TENCENTCLOUD_MONITOR_SECRET_KEY,
    cloudEnvId: argument('env') || DEFAULT_CLOUD_ENV_ID,
    bucket: process.env.COS_BUCKET || STORAGE_BUCKET_ID,
    region: process.env.COS_REGION || STORAGE_REGION,
  })
  let result
  if (argument('slot')) {
    result = await verifyCloudObservationIdentity({
      slotId: argument('slot'),
      observationId: argument('expected-observation-id'),
      payloadSha256: argument('expected-payload-sha256'),
      handoffIdentity: argument('expected-handoff-identity'),
      client,
    })
  } else {
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    const handoff = handoffPath ? JSON.parse(await readFile(handoffPath, 'utf8')) : null
    result = await verifyCloudObservation({ report, handoff, client })
  }
  await mkdir(resolve(outputPath, '..'), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(result.observation, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ status: result.status, slot_id: result.observation.slot_id, observation_id: result.observation.observation_id, timing_status: result.observation.timing_status }))
}

if (process.argv[1]?.endsWith('cloud-observation-gate.mjs')) await main()
