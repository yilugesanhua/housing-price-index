import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { assertRehearsalKey, createTencentCloudClient } from './tencent-cloud-sdk.mjs'
import { activatePointerWithRollback, GuardedActivationError } from './guarded-activation.mjs'
import { sha256, stableJson } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const execFileAsync = promisify(execFile)
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const runId = argument('run-id') || process.env.GITHUB_RUN_ID
if (!/^\d+(?:-\d+)?$/.test(runId || '')) throw new Error('Use --run-id=<numeric-id>')

const cloud = createTencentCloudClient({ cloudEnvId })
const prefix = `housing-data/rehearsals/${runId}/`
const outputRoot = resolve(root, 'work/cloud-write-rehearsal', runId)
await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
const payloads = [
  ['probe.json', Buffer.from(`${JSON.stringify({ format: 'housing-data-write-rehearsal-v1', run_id: runId, cloud_env_id: cloudEnvId })}\n`)],
  ['bytes.bin', Buffer.from(Array.from({ length: 256 }, (_, index) => index))],
]
const checks = []

for (const [name, body] of payloads) {
  const key = assertRehearsalKey(`${prefix}${name}`, runId)
  await cloud.putObject(key, body)
  await cloud.headObject(key)
  const downloaded = await cloud.getObject(key)
  if (downloaded.byteLength !== body.byteLength || sha256(downloaded) !== sha256(body)) {
    throw new Error(`Rehearsal round-trip mismatch for ${key}`)
  }
  checks.push({ key, bytes: body.byteLength, sha256: sha256(body), head_verified: true, round_trip_verified: true })
}

const pointer = (datasetVersion) => ({
  dataset_version: datasetVersion,
  dataset_as_of: datasetVersion.slice(0, 7),
  schema_version: '1.3.0',
  manifest_file_id: `cloud://${cloudEnvId}.${cloud.bucket}/housing-data/releases/${datasetVersion}/manifest.json`,
  manifest_sha256: 'a'.repeat(64),
  published_at: '2026-07-27T00:00:00.000Z',
  previous_dataset_version: null,
  next_check_at: '2026-08-17T01:40:00.000Z',
})
const basePointer = pointer('2026-05-aaaaaaaaaaaa')
const successfulPointer = pointer('2026-06-bbbbbbbbbbbb')
const failedPointer = pointer('2026-07-cccccccccccc')
const pointerKey = assertRehearsalKey(`${prefix}current.json`, runId)
await cloud.putObject(pointerKey, Buffer.from(stableJson(basePointer)))

const writePointer = async (pointerText) => cloud.putObject(pointerKey, Buffer.from(pointerText))
const readPointerText = async () => (await cloud.getObject(pointerKey)).toString('utf8')
const guardPointer = async (expected) => {
  const actual = JSON.parse(await readPointerText())
  if (actual.dataset_version !== expected.dataset_version || actual.manifest_sha256 !== expected.manifest_sha256) {
    throw new Error('Isolated pointer guard mismatch')
  }
}

const switchResult = await activatePointerWithRollback({
  candidate: successfulPointer,
  candidateText: stableJson(successfulPointer),
  previous: basePointer,
  rollbackEligible: true,
  writePointer,
  readPointerText,
  guardCandidate: guardPointer,
  guardRollback: guardPointer,
})
if (switchResult.status !== 'published') throw new Error('Isolated pointer switch did not publish')

let rollbackRecorded = false
let failureRecorded = false
try {
  await activatePointerWithRollback({
    candidate: failedPointer,
    candidateText: stableJson(failedPointer),
    previous: successfulPointer,
    rollbackEligible: true,
    writePointer,
    readPointerText,
    guardCandidate: async () => { throw new Error('intentional isolated post-switch guard failure') },
    guardRollback: guardPointer,
    prepareRollback: async () => ({ ...successfulPointer, previous_dataset_version: null }),
    recordRollback: async () => { rollbackRecorded = true },
    recordFailure: async ({ rollbackStatus }) => { failureRecorded = rollbackStatus === 'succeeded' },
  })
  throw new Error('Intentional isolated guard failure unexpectedly succeeded')
} catch (error) {
  if (!(error instanceof GuardedActivationError) || error.rollbackStatus !== 'succeeded') throw error
}
const finalPointer = JSON.parse(await readPointerText())
if (finalPointer.dataset_version !== successfulPointer.dataset_version || !rollbackRecorded || !failureRecorded) {
  throw new Error('Isolated automatic rollback was not fully verified')
}

const latestCandidate = JSON.parse(await readFile(resolve(root, 'work/miniprogram-data/latest-candidate.json'), 'utf8'))
const sourceRoot = resolve(root, 'work/miniprogram-data', latestCandidate.dataset_version)
const sourceManifest = JSON.parse(await readFile(resolve(sourceRoot, 'manifest.json'), 'utf8'))
const releasePrefix = `${prefix}release/${latestCandidate.dataset_version}`
await cloud.uploadFile(resolve(sourceRoot, 'bootstrap.json'), assertRehearsalKey(`${releasePrefix}/bootstrap.json`, runId))
const uploadedCityKeys = await cloud.uploadDirectory(resolve(sourceRoot, 'cities'), assertRehearsalKey(`${releasePrefix}/cities`, runId))
await cloud.uploadFile(resolve(sourceRoot, 'manifest.json'), assertRehearsalKey(`${releasePrefix}/manifest.json`, runId))
if (uploadedCityKeys.length !== 70) throw new Error(`Expected 70 uploaded city shards; got ${uploadedCityKeys.length}`)

const reconstructedRoot = resolve(outputRoot, 'full-release')
await cloud.downloadObject(assertRehearsalKey(`${releasePrefix}/manifest.json`, runId), resolve(reconstructedRoot, 'manifest.json'))
await cloud.downloadObject(assertRehearsalKey(`${releasePrefix}/bootstrap.json`, runId), resolve(reconstructedRoot, 'bootstrap.json'))
for (const cityId of Object.keys(sourceManifest.city_files || {})) {
  await cloud.downloadObject(assertRehearsalKey(`${releasePrefix}/cities/${cityId}.json`, runId), resolve(reconstructedRoot, 'cities', `${cityId}.json`))
}
await copyFile(resolve(sourceRoot, 'current.candidate.json'), resolve(reconstructedRoot, 'current.candidate.json'))
await execFileAsync(process.execPath, [resolve(root, 'scripts/miniprogram/verify-remote-data.mjs'), `--dir=${reconstructedRoot}`], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
})

const report = {
  status: 'passed',
  format: 'housing-data-write-rehearsal-v1',
  run_id: runId,
  cloud_env_id: cloudEnvId,
  prefix,
  production_pointer_untouched: true,
  production_release_prefix_untouched: true,
  checks,
  pointer_rehearsal: {
    key: pointerKey,
    switch_round_trip_verified: true,
    intentional_guard_failure_observed: true,
    automatic_rollback_verified: true,
    restored_dataset_version: finalPointer.dataset_version,
  },
  full_release_rehearsal: {
    prefix: releasePrefix,
    dataset_version: latestCandidate.dataset_version,
    manifest_sha256: sha256(await readFile(resolve(reconstructedRoot, 'manifest.json'))),
    city_count: uploadedCityKeys.length,
    full_release_reconstructed: true,
  },
  checked_at: new Date().toISOString(),
}
await writeFile(resolve(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report))
