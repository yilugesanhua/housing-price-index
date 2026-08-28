import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const contract = require('../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/discovery-contract.js')

const SLOT_PREFIX = 'discovery-slot:'
const OBSERVATION_PREFIX = 'discovery-observation:'
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

export function parseAuditInputText(text) {
  try {
    return JSON.parse(text)
  } catch (error) {
    // CloudBase `db nosql dump --file-type json` exports one JSON document per
    // line rather than wrapping the collection in a JSON array.
    const lines = String(text).split(/\r?\n/).filter((line) => line.trim())
    if (lines.length === 0) throw error
    try {
      return lines.map((line, index) => {
        try {
          return JSON.parse(line)
        } catch (lineError) {
          throw new Error(`CloudBase export line ${index + 1} is not valid JSON: ${errorText(lineError)}`)
        }
      })
    } catch (lineError) {
      throw new Error(`audit input is neither JSON nor a CloudBase JSON-lines export: ${errorText(lineError)}`)
    }
  }
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

function validateObservationLink(record, observations, slotId) {
  const matches = observations.filter((observation) => observation.observation_id === record.observation_id)
  if (matches.length === 0) throw new Error(`${slotId}: immutable observation record is missing`)
  if (matches.length !== 1) throw new Error(`${slotId}: immutable observation record is duplicated`)
  const observation = matches[0]
  if (observation.format !== 'housing-data-discovery-observation-v1') throw new Error(`${slotId}: immutable observation format is invalid`)
  if (observation.slot_id !== record.slot_id) throw new Error(`${slotId}: immutable observation slot identity does not match`)
  if (observation.payload_sha256 !== record.observation_payload_sha256) throw new Error(`${slotId}: immutable observation payload hash does not match`)
  if (observation.handoff_identity !== record.handoff_identity) throw new Error(`${slotId}: immutable observation handoff identity does not match`)
}

function selectExpectedSlots(dateText, slotCount) {
  const allSlots = contract.discoverySlotsForBeijingDate(dateText)
  if (slotCount === undefined) return allSlots
  if (!Number.isInteger(slotCount) || slotCount < 1 || slotCount > allSlots.length) {
    throw new Error(`slotCount must be an integer from 1 to ${allSlots.length}`)
  }
  return allSlots.slice(0, slotCount)
}

export function auditStrictDiscoveryWindow({ dateText, records, slotCount }) {
  const allSlots = contract.discoverySlotsForBeijingDate(dateText)
  const expectedSlots = selectExpectedSlots(dateText, slotCount)
  const suppliedRecords = extractRecords(records)
  const allExpectedIds = new Set(allSlots.map((slot) => `${SLOT_PREFIX}${slot.slot_id}`))
  const expectedIds = new Set(expectedSlots.map((slot) => `${SLOT_PREFIX}${slot.slot_id}`))
  const observations = suppliedRecords.filter((record) => typeof record?._id === 'string' && record._id.startsWith(OBSERVATION_PREFIX))
  // The collection also contains official-calendar records with this ID prefix.
  // Keep those out, but retain an expected ID with the wrong task so validation fails.
  const dayDiscoveryRecords = suppliedRecords.filter((record) => (
    isTargetDateSlot(record, dateText)
    && (record.task === 'discovery' || allExpectedIds.has(record._id))
  ))
  const targetRecords = dayDiscoveryRecords.filter((record) => expectedIds.has(record._id))
  const errors = []

  for (const record of dayDiscoveryRecords) {
    if (!allExpectedIds.has(record._id)) errors.push(`${record._id}: unexpected discovery slot`)
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
      validateObservationLink(matches[0], observations, slot.slot_id)
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
  const rawSlotCount = argument('slot-count')
  const slotCount = rawSlotCount === undefined ? undefined : Number(rawSlotCount)
  if (!dateText || !inputPath) throw new Error('Use --date=YYYY-MM-DD and --input=PATH')
  const records = parseAuditInputText(await readFile(resolve(inputPath), 'utf8'))
  const result = auditStrictDiscoveryWindow({ dateText, records, slotCount })
  if (outputPath) await writeFile(resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  if (result.status !== 'passed') throw new Error(`Strict discovery window audit rejected: ${result.errors.join('; ')}`)
  console.log(JSON.stringify(result))
}

if (process.argv[1]?.endsWith('strict-discovery-window-audit.mjs')) await main()
