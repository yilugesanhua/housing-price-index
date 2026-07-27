import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { resolve } from 'node:path'
import { createTencentCloudClient } from './tencent-cloud-sdk.mjs'
import { sha256, stableJson } from './remote-data-lib.mjs'
import { readRollbackEligibleAudit } from './release-audit-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const datasetVersion = argument('dataset')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || '')) throw new Error('Use --dataset=<active-version>')

const workRoot = resolve(root, 'work/miniprogram-data/current-pointer-repair', datasetVersion)
await rm(workRoot, { recursive: true, force: true })
await mkdir(workRoot, { recursive: true })
const currentPath = resolve(workRoot, 'current.before.json')
const cloud = createTencentCloudClient({ cloudEnvId })
await cloud.downloadObject('housing-data/current.json', currentPath)
const currentText = await readFile(currentPath, 'utf8')
const current = JSON.parse(currentText)
if (current.dataset_version !== datasetVersion) throw new Error('Requested dataset is not the active remote version')

const activeAudit = await readRollbackEligibleAudit(root, datasetVersion, cloudEnvId)
if (activeAudit.current_sha256 !== sha256(currentText)) throw new Error('Active current.json differs from its publish audit record')
const previousDatasetVersion = current.previous_dataset_version
if (!previousDatasetVersion) throw new Error('Active pointer has no previous_dataset_version to repair')
const correction = JSON.parse(await readFile(resolve(root, 'data/releases', `${previousDatasetVersion}.correction.json`), 'utf8'))
if (correction.dataset_version !== previousDatasetVersion || correction.rollback_allowed !== false) {
  throw new Error('Previous version is not explicitly disabled by a valid correction record')
}
if (!stdin.isTTY) throw new Error('Interactive terminal required for current pointer repair')

console.log(JSON.stringify({
  target_env: cloudEnvId,
  active_dataset_version: datasetVersion,
  invalid_previous_dataset_version: previousDatasetVersion,
  repair: 'set previous_dataset_version to null',
}, null, 2))
const prompt = createInterface({ input: stdin, output: stdout })
const confirmation = await prompt.question(`输入当前完整数据版本 ${datasetVersion} 以修复线上指针：`)
prompt.close()
if (confirmation.trim() !== datasetVersion) throw new Error('Current pointer repair cancelled: dataset version confirmation did not match')

const repairedAt = new Date().toISOString()
const repaired = { ...current, previous_dataset_version: null }
const repairedText = stableJson(repaired)
const repairedPath = resolve(workRoot, 'current.repaired.json')
await writeFile(repairedPath, repairedText, 'utf8')
await cloud.uploadFile(repairedPath, 'housing-data/current.json')
const roundTripPath = resolve(workRoot, 'current.roundtrip.json')
await cloud.downloadObject('housing-data/current.json', roundTripPath)
if (await readFile(roundTripPath, 'utf8') !== repairedText) throw new Error('Repaired current.json round-trip verification failed')

const timestamp = repairedAt.replace(/[:.]/g, '-')
const record = {
  status: 'current_pointer_repaired',
  repaired_at: repairedAt,
  cloud_env_id: cloudEnvId,
  dataset_version: datasetVersion,
  removed_previous_dataset_version: previousDatasetVersion,
  reason: correction.reason,
  before_sha256: sha256(currentText),
  after_sha256: sha256(repairedText),
}
await writeFile(resolve(root, 'data/releases', `current-pointer-repair-${timestamp}.json`), `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
console.log(`Repaired current.json for ${datasetVersion}; round-trip verification passed`)
