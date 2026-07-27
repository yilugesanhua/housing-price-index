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
if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || '')) throw new Error('Use --dataset=<existing-version>')
const audit = await readRollbackEligibleAudit(root, datasetVersion, cloudEnvId)
const workRoot = resolve(root, 'work/miniprogram-data/rollback', datasetVersion)
await rm(workRoot, { recursive: true, force: true })
await mkdir(workRoot, { recursive: true })
const manifestPath = resolve(workRoot, 'manifest.json')
const currentPath = resolve(workRoot, 'current-before-rollback.json')
const cloud = createTencentCloudClient({ cloudEnvId })
await cloud.downloadObject(`housing-data/releases/${datasetVersion}/manifest.json`, manifestPath)
const manifestText = await readFile(manifestPath, 'utf8')
if (sha256(manifestText) !== audit.manifest_sha256) throw new Error('Rollback target manifest hash does not match its publish audit record')
await cloud.downloadObject('housing-data/current.json', currentPath)
const previousCurrent = JSON.parse(await readFile(currentPath, 'utf8'))
if (!stdin.isTTY) throw new Error('Interactive terminal required for rollback')
console.log(JSON.stringify({ target_env: cloudEnvId, current_dataset_version: previousCurrent.dataset_version, rollback_dataset_version: datasetVersion, manifest_sha256: audit.manifest_sha256 }, null, 2))
const prompt = createInterface({ input: stdin, output: stdout })
const confirmation = await prompt.question(`输入完整数据版本 ${datasetVersion} 以执行回滚：`)
prompt.close()
if (confirmation.trim() !== datasetVersion) throw new Error('Rollback cancelled: dataset version confirmation did not match')
const manifest = JSON.parse(manifestText)
const manifestFileId = String(manifest.bootstrap_file_id || '').replace(/\/bootstrap\.json$/, '/manifest.json')
if (!manifestFileId.includes(`.${audit.storage_bucket || '636c-cloud1-d3gpdx70w5d05c68c-1456861154'}/housing-data/releases/${datasetVersion}/manifest.json`)) {
  throw new Error('Rollback target does not use a complete SDK-compatible cloud file ID')
}
const current = {
  dataset_version: manifest.dataset_version,
  dataset_as_of: manifest.dataset_as_of,
  schema_version: manifest.schema_version,
  manifest_file_id: manifestFileId,
  manifest_sha256: audit.manifest_sha256,
  published_at: new Date().toISOString(),
  previous_dataset_version: previousCurrent.dataset_version,
  next_check_at: manifest.next_check_at,
}
const rollbackPointerPath = resolve(workRoot, 'current.rollback.json')
const rollbackPointerText = stableJson(current)
await writeFile(rollbackPointerPath, rollbackPointerText, 'utf8')
await cloud.uploadFile(rollbackPointerPath, 'housing-data/current.json')
const roundTripPath = resolve(workRoot, 'current.roundtrip.json')
await cloud.downloadObject('housing-data/current.json', roundTripPath)
if (await readFile(roundTripPath, 'utf8') !== rollbackPointerText) throw new Error('Rollback current.json round-trip verification failed')
const logDir = resolve(root, 'data/releases')
const timestamp = current.published_at.replace(/[:.]/g, '-')
await writeFile(resolve(logDir, `rollback-${timestamp}.json`), `${JSON.stringify({ status: 'rolled_back', rolled_back_at: current.published_at, from_dataset_version: previousCurrent.dataset_version, to_dataset_version: datasetVersion, cloud_env_id: cloudEnvId, current_sha256: sha256(rollbackPointerText) }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
console.log(`Rolled back from ${previousCurrent.dataset_version} to ${datasetVersion}`)
