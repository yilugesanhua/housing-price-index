import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import COS from 'cos-nodejs-sdk-v5'

export const AUTO_UPDATE_STATES = Object.freeze(['preparing', 'ready', 'publishing', 'published', 'failed'])
const TRANSITIONS = new Map([
  ['preparing', new Set(['preparing', 'ready', 'failed'])],
  ['ready', new Set(['ready', 'preparing', 'publishing', 'failed'])],
  ['publishing', new Set(['publishing', 'published', 'failed'])],
  ['published', new Set(['published'])],
  ['failed', new Set(['preparing', 'failed'])],
])

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function buildReleaseKey(datasetAsOf, sourceRawSha256) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(datasetAsOf || '')) throw new Error('release key month is invalid')
  if (!/^[a-f0-9]{64}$/.test(sourceRawSha256 || '')) throw new Error('release key source SHA-256 is invalid')
  return `${datasetAsOf}-${sourceRawSha256}`
}

export function buildCandidateId({ releaseKey, commitSha, candidateManifestSha256 }) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{64}$/.test(releaseKey || '')) throw new Error('candidate release key is invalid')
  if (!/^[a-f0-9]{40}$/.test(commitSha || '')) throw new Error('candidate commit SHA is invalid')
  if (!/^[a-f0-9]{64}$/.test(candidateManifestSha256 || '')) throw new Error('candidate manifest SHA-256 is invalid')
  return sha256(`${releaseKey}\n${commitSha}\n${candidateManifestSha256}`)
}

export function validateStateIdentity(state) {
  if (!state || !AUTO_UPDATE_STATES.includes(state.status)) throw new Error('auto-update state is invalid')
  if (state.format !== 'housing-data-auto-update-state-v1') throw new Error('auto-update state format is invalid')
  const releaseKey = buildReleaseKey(state.dataset_as_of, state.source_raw_sha256)
  if (state.release_key !== releaseKey) throw new Error('auto-update state release key is invalid')
  if (state.status === 'preparing' || state.status === 'failed') return state
  if (!/^[a-f0-9]{40}$/.test(state.candidate_commit_sha || '') || !/^[a-f0-9]{40}$/.test(state.producer_commit_sha || '') || state.producer_commit_sha !== state.candidate_commit_sha || !/^[a-f0-9]{64}$/.test(state.candidate_manifest_sha256 || '')) throw new Error('auto-update state candidate identity is incomplete')
  const candidateId = buildCandidateId({ releaseKey, commitSha: state.candidate_commit_sha, candidateManifestSha256: state.candidate_manifest_sha256 })
  if (state.candidate_id !== candidateId) throw new Error('auto-update state candidate ID is invalid')
  return state
}

export function transitionState(state, next, patch = {}) {
  if (!AUTO_UPDATE_STATES.includes(next) || !state || !AUTO_UPDATE_STATES.includes(state.status)) throw new Error('auto-update state is invalid')
  if (!TRANSITIONS.get(state.status)?.has(next)) throw new Error(`invalid auto-update transition ${state.status} -> ${next}`)
  return validateStateIdentity({ ...state, ...patch, status: next, updated_at: patch.updated_at || state.updated_at })
}

export async function readState(path) {
  try { return validateStateIdentity(JSON.parse(await readFile(path, 'utf8'))) } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

export async function writeState(path, state) {
  validateStateIdentity(state)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
  return state
}

export async function readProductionPointer(output = 'work/monthly-data-check/current.json', env = process.env) {
  const secretId = env.TENCENTCLOUD_MONITOR_SECRET_ID
  const secretKey = env.TENCENTCLOUD_MONITOR_SECRET_KEY
  if (!secretId || !secretKey) throw new Error('Read-only production pointer credentials are required')
  const bucket = env.COS_BUCKET || '636c-cloud1-d3gpdx70w5d05c68c-1456861154'
  const region = env.COS_REGION || 'ap-shanghai'
  const cos = new COS({ SecretId: secretId, SecretKey: secretKey, Timeout: 30_000 })
  const body = await new Promise((resolveCall, reject) => cos.getObject({ Bucket: bucket, Region: region, Key: 'housing-data/current.json' }, (error, result) => error ? reject(error) : resolveCall(result.Body)))
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : Buffer.from(body).toString('utf8')
  const pointer = JSON.parse(text)
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(pointer.dataset_as_of || '') || !/^[a-f0-9]{64}$/.test(pointer.manifest_sha256 || '') || !Number.isFinite(Date.parse(pointer.next_check_at || ''))) throw new Error('Production current.json identity is invalid')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, text, 'utf8')
  return pointer
}

if (process.argv[1]?.endsWith('auto-update-state.mjs') && process.argv.includes('--read-production-pointer')) {
  const output = process.argv.find((value) => value.startsWith('--output='))?.slice('--output='.length) || 'work/monthly-data-check/current.json'
  const pointer = await readProductionPointer(output)
  console.log(JSON.stringify({ dataset_as_of: pointer.dataset_as_of, dataset_version: pointer.dataset_version, manifest_sha256: pointer.manifest_sha256 }))
}
