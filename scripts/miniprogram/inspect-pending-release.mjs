import { appendFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { validateOfficialReleaseUrl } from './official-source-url.mjs'

const require = createRequire(import.meta.url)
const contract = require('../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/discovery-contract.js')

const DATASET_VERSION = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const SOURCE_VERSION = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const SHA256 = /^[a-f0-9]{64}$/
const RUN_ID = /^\d+$/
const RELEASE_KEY = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{64}$/
const CANDIDATE_ID = /^[a-f0-9]{64}$/
const COMMIT_SHA = /^[a-f0-9]{40}$/

export function validatePendingReleaseState(value) {
  if (value?.status !== 'ready') return { ready: false }
  if (value.format !== 'housing-data-pending-auto-release-v1') throw new Error('Pending release format is invalid')
  if (!DATASET_VERSION.test(value.dataset_version || '')) throw new Error('Pending dataset version is invalid')
  if (!SOURCE_VERSION.test(value.source_dataset_version || '')) throw new Error('Pending source dataset version is invalid')
  validateOfficialReleaseUrl(value.official_url)
  if (!SHA256.test(value.source_raw_sha256 || '')) throw new Error('Pending source SHA-256 is invalid')
  if (!RELEASE_KEY.test(value.release_key || '') || value.release_key !== `${value.dataset_as_of}-${value.source_raw_sha256}`) throw new Error('Pending release key is invalid')
  if (!COMMIT_SHA.test(value.candidate_commit_sha || '') || !COMMIT_SHA.test(value.producer_commit_sha || '') || value.producer_commit_sha !== value.candidate_commit_sha || !SHA256.test(value.candidate_manifest_sha256 || '') || !CANDIDATE_ID.test(value.candidate_id || '')) throw new Error('Pending candidate identity is invalid')
  if (value.candidate_id !== createHash('sha256').update(`${value.release_key}\n${value.candidate_commit_sha}\n${value.candidate_manifest_sha256}`).digest('hex')) throw new Error('Pending candidate ID does not match its identity')
  if (value.state_version !== 'housing-data-auto-update-state-v1') throw new Error('Pending state version is invalid')
  if (!RUN_ID.test(String(value.discovery_run_id || ''))) throw new Error('Pending discovery run ID is invalid')
  if (!contract.parseSlotId(value.cloud_slot_id || '')) throw new Error('Pending CloudBase slot ID is invalid')
  if (!SHA256.test(value.cloud_observation_id || '') || !SHA256.test(value.cloud_observation_payload_sha256 || '')) throw new Error('Pending CloudBase observation identity is invalid')
  if (value.cloud_timing_status !== 'on_time') throw new Error('Pending CloudBase observation was not on time')
  if (value.cloud_handoff_identity !== `housing-data-discovery-v1:${value.idempotency_key}`) throw new Error('Pending CloudBase handoff identity is invalid')
  if (!RUN_ID.test(String(value.candidate_run_id || ''))) throw new Error('Pending candidate workflow run ID is invalid')
  if (!SHA256.test(value.gate_report_sha256 || '')) throw new Error('Pending gate SHA-256 is invalid')
  return {
    ready: true,
    dataset_version: value.dataset_version,
    official_url: value.official_url,
    source_raw_sha256: value.source_raw_sha256,
    discovery_run_id: String(value.discovery_run_id),
    cloud_slot_id: value.cloud_slot_id,
    cloud_observation_id: value.cloud_observation_id,
    cloud_observation_payload_sha256: value.cloud_observation_payload_sha256,
    cloud_timing_status: value.cloud_timing_status,
    cloud_handoff_identity: value.cloud_handoff_identity,
    candidate_run_id: String(value.candidate_run_id),
  }
}

function writeOutput(result) {
  const values = {
    ready: String(result.ready),
    dataset_version: result.dataset_version || '',
    official_url: result.official_url || '',
    source_raw_sha256: result.source_raw_sha256 || '',
    discovery_run_id: result.discovery_run_id || '',
    cloud_slot_id: result.cloud_slot_id || '',
    cloud_observation_id: result.cloud_observation_id || '',
    cloud_observation_payload_sha256: result.cloud_observation_payload_sha256 || '',
    cloud_timing_status: result.cloud_timing_status || '',
    cloud_handoff_identity: result.cloud_handoff_identity || '',
    candidate_run_id: result.candidate_run_id || '',
  }
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error(`Pending output ${key} contains a line break`)
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''))
  } else {
    console.log(JSON.stringify(values))
  }
}

function main() {
  const path = resolve(process.argv[2] || 'data/releases/pending-auto-release.json')
  let value = {}
  try { value = JSON.parse(readFileSync(path, 'utf8')) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  writeOutput(validatePendingReleaseState(value))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
