import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertRehearsalKey, createTencentCloudClient } from './tencent-cloud-sdk.mjs'
import { sha256 } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const runId = argument('run-id') || process.env.GITHUB_RUN_ID
if (!/^\d+(?:-\d+)?$/.test(runId || '')) throw new Error('Use --run-id=<numeric-id>')

const cloud = createTencentCloudClient({ cloudEnvId })
const prefix = `housing-data/rehearsals/${runId}/`
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

const report = {
  status: 'passed',
  format: 'housing-data-write-rehearsal-v1',
  run_id: runId,
  cloud_env_id: cloudEnvId,
  prefix,
  production_pointer_untouched: true,
  production_release_prefix_untouched: true,
  checks,
  checked_at: new Date().toISOString(),
}
const outputRoot = resolve(root, 'work/cloud-write-rehearsal', runId)
await mkdir(outputRoot, { recursive: true })
await writeFile(resolve(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report))
