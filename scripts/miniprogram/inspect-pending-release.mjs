import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { validateOfficialReleaseUrl } from './official-source-url.mjs'

const DATASET_VERSION = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const SOURCE_VERSION = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const SHA256 = /^[a-f0-9]{64}$/
const RUN_ID = /^\d+$/

export function validatePendingReleaseState(value) {
  if (value?.status !== 'ready') return { ready: false }
  if (value.format !== 'housing-data-pending-auto-release-v1') throw new Error('Pending release format is invalid')
  if (!DATASET_VERSION.test(value.dataset_version || '')) throw new Error('Pending dataset version is invalid')
  if (!SOURCE_VERSION.test(value.source_dataset_version || '')) throw new Error('Pending source dataset version is invalid')
  validateOfficialReleaseUrl(value.official_url)
  if (!SHA256.test(value.source_raw_sha256 || '')) throw new Error('Pending source SHA-256 is invalid')
  if (!RUN_ID.test(String(value.discovery_run_id || ''))) throw new Error('Pending discovery run ID is invalid')
  if (!SHA256.test(value.gate_report_sha256 || '')) throw new Error('Pending gate SHA-256 is invalid')
  return {
    ready: true,
    dataset_version: value.dataset_version,
    official_url: value.official_url,
    source_raw_sha256: value.source_raw_sha256,
    discovery_run_id: String(value.discovery_run_id),
  }
}

function writeOutput(result) {
  const values = {
    ready: String(result.ready),
    dataset_version: result.dataset_version || '',
    official_url: result.official_url || '',
    source_raw_sha256: result.source_raw_sha256 || '',
    discovery_run_id: result.discovery_run_id || '',
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
