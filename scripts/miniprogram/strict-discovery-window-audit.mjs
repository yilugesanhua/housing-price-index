import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const contract = require('../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/discovery-contract.js')

const SLOT_PREFIX = 'discovery-slot:'
const SHA256 = /^[a-f0-9]{64}$/
const HANDOFF_IDENTITY = /^housing-data-discovery-v1:[a-f0-9]{64}$/

function errorText(value) {
  return value instanceof Error ? value.message : String(value)
}

function parseTimestamp(value, field, slotId) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(parsed)) throw new Error(`${slotId}: ${field} is invalid`)
  return parsed
}

function parseAttempts(value, slotId) {
  if (Number.isInteger(value)) return value
  const serialized = value?.$numberInt ?? value?.$numberLong
  if (typeof serialized === 'string' && /^\d+$/.test(serialized)) return Number(serialized)
  throw new Error(`${slotId}: attempts is invalid`)
}

function extractRecords(input) {
  if (Array.isArray(input)) return input
  if (Array.isArray(input?.records)) return input.records
  if (Array.isArray(input?.data?.results)) {
    return input.data.results.flatMap((entry) => Array.isArray(entry) ? entry : [entry])
  }
  throw new Error('audit input must be an array, a records array, or a CloudBase query response')
}

function isTargetDateSlot(record, dateText) {
  if (typeof record?._id !== 'string' || !record._id.startsWith(SLOT_PREFIX)) return false
  return record._id.slice(SLOT_PREFIX.length).startsWith(`${dateText}T`)
}

function validateRecord(record, slot) {
  const slotId = slot.slot_id
  const policy = contract.slotPolicy(slot)
  if (record.format !== 'housing-data-discovery-slot-v1') throw new Error(`${slotId}: record format is invalid`)
  if (record.task !== 'discovery') throw new Error(`${slotId}: task is invalid`)
  if (record.slot_id !== slotId || record.planned_at !== slot.planned_at) throw new Error(`${slotId}: slot identity is invalid`)
  if (record.status !== 'succeeded' || record.timing_status !== 'on_time') throw new Error(`${slotId}: discovery was not an on-time success`)
  if (parseAttempts(record.attempts, slotId) !== 1) throw new Error(`${slotId}: discovery did not succeed on its first attempt`)
  if (record.retryable !== false || record.completed_after_deadline !== false || record.late_at !== null) {
    throw new Error(`${slotId}: completion state is inconsistent`)
  }
  if (!SHA256.test(record.observation_id || '') || !SHA256.test(record.observation_payload_sha256 || '') || !HANDOFF_IDENTITY.test(record.handoff_identity || '')) {
    throw new Error(`${slotId}: immutable observation identity is incomplete`)
  }
  const actualStartedAt = parseTimestamp(record.actual_started_at, 'actual_started_at', slotId)
  const completedAt = parseTimestamp(record.completed_at, 'completed_at', slotId)
  if (actualStartedAt < slot.planned_at_ms || actualStartedAt > policy.start_deadline_at_ms) {
    throw new Error(`${slotId}: discovery did not start within the two-minute deadline`)
  }
  if (completedAt < actualStartedAt || completedAt > policy.retry_deadline_at_ms) {
    throw new Error(`${slotId}: completion time is invalid`)
  }
  const events = Array.isArray(record.status_history) ? record.status_history.map((entry) => entry?.event) : []
  if (!['pending', 'started', 'succeeded'].every((event) => events.includes(event))) {
    throw new Error(`${slotId}: status history is incomplete`)
  }
}

export function auditStrictDiscoveryWindow({ dateText, records }) {
  const expectedSlots = contract.discoverySlotsForBeijingDate(dateText)
  const suppliedRecords = extractRecords(records)
  const expectedIds = new Set(expectedSlots.map((slot) => `${SLOT_PREFIX}${slot.slot_id}`))
  // The collection also contains official-calendar records with this ID prefix.
  // Keep those out, but retain an expected ID with the wrong task so validation fails.
  const targetRecords = suppliedRecords.filter((record) => (
    isTargetDateSlot(record, dateText)
    && (record.task === 'discovery' || expectedIds.has(record._id))
  ))
  const errors = []

  for (const record of targetRecords) {
    if (!expectedIds.has(record._id)) errors.push(`${record._id}: unexpected discovery slot`)
  }

  for (const slot of expectedSlots) {
    const id = `${SLOT_PREFIX}${slot.slot_id}`
    const matches = targetRecords.filter((record) => record._id === id)
    if (matches.length === 0) {
      errors.push(`${slot.slot_id}: missing discovery slot`)
      continue
    }
    if (matches.length !== 1) {
      errors.push(`${slot.slot_id}: duplicate discovery slot records`)
      continue
    }
    try {
      validateRecord(matches[0], slot)
    } catch (error) {
      errors.push(errorText(error))
    }
  }

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    date: dateText,
    expected_slot_count: expectedSlots.length,
    received_slot_count: targetRecords.length,
    unique_slot_count: new Set(targetRecords.map((record) => record._id)).size,
    errors,
  }
}

export function assertStrictDiscoveryWindow(input) {
  const result = auditStrictDiscoveryWindow(input)
  if (result.status !== 'passed') throw new Error(`Strict discovery window audit rejected: ${result.errors.join('; ')}`)
  return result
}

function argument(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}

async function main() {
  const dateText = argument('date')
  const inputPath = argument('input')
  const outputPath = argument('output')
  if (!dateText || !inputPath) throw new Error('Use --date=YYYY-MM-DD and --input=PATH')
  const records = JSON.parse(await readFile(resolve(inputPath), 'utf8'))
  const result = auditStrictDiscoveryWindow({ dateText, records })
  if (outputPath) await writeFile(resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  if (result.status !== 'passed') throw new Error(`Strict discovery window audit rejected: ${result.errors.join('; ')}`)
  console.log(JSON.stringify(result))
}

if (process.argv[1]?.endsWith('strict-discovery-window-audit.mjs')) await main()
