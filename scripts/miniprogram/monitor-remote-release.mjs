import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import COS from 'cos-nodejs-sdk-v5'
import TencentCloudScf from 'tencentcloud-sdk-nodejs-scf'
import { validateManifestFunctionOutput } from './post-publish-guard.mjs'
import { classifyRemoteFreshness, sha256 } from './remote-data-lib.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const bundledSnapshot = require(resolve(root, 'apps/miniprogram/data/snapshot.js'))
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const datasetVersion = argument('dataset')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const storageBucketId = '636c-cloud1-d3gpdx70w5d05c68c-1456861154'
const storageRegion = 'ap-shanghai'
const secretId = process.env.TENCENTCLOUD_MONITOR_SECRET_ID
const secretKey = process.env.TENCENTCLOUD_MONITOR_SECRET_KEY
if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || '')) throw new Error('Use --dataset=<active-version>')
if (!secretId || !secretKey) throw new Error('Read-only COS monitor credentials are required')
const cos = new COS({ SecretId: secretId, SecretKey: secretKey })
const ScfClient = TencentCloudScf.scf.v20180416.Client
const scf = new ScfClient({ credential: { secretId, secretKey }, region: storageRegion })
const cosCall = (method, key) => new Promise((resolveCall, reject) => {
  cos[method]({ Bucket: storageBucketId, Region: storageRegion, Key: key }, (error, data) => {
    if (error) reject(new Error(`COS ${method} failed for ${key}: ${error.code || error.statusCode || 'unknown'} ${error.message || ''}`.trim()))
    else resolveCall(data)
  })
})
const downloadObject = async (key, destination) => {
  const result = await cosCall('getObject', key)
  await writeFile(destination, result.Body)
}
const audit = JSON.parse(await readFile(resolve(root, 'data/releases', `${datasetVersion}.json`), 'utf8'))
if (audit.status !== 'published' || audit.cloud_env_id !== cloudEnvId) throw new Error('Monitor target lacks a matching publish audit')
const releaseAuditDir = resolve(root, 'data/releases')
const repairFiles = (await readdir(releaseAuditDir)).filter((name) => name.startsWith('current-pointer-repair-') && name.endsWith('.json')).sort()
let expectedCurrentSha256 = audit.current_sha256
let pointerRepairCount = 0
for (const repairFile of repairFiles) {
  const repair = JSON.parse(await readFile(resolve(releaseAuditDir, repairFile), 'utf8'))
  if (repair.status !== 'current_pointer_repaired' || repair.dataset_version !== datasetVersion) continue
  if (repair.cloud_env_id !== cloudEnvId || repair.before_sha256 !== expectedCurrentSha256 || !/^([a-f0-9]{64})$/.test(repair.after_sha256 || '')) {
    throw new Error(`Invalid current pointer repair audit chain: ${repairFile}`)
  }
  expectedCurrentSha256 = repair.after_sha256
  pointerRepairCount += 1
}
const outputRoot = resolve(root, 'work/post-publish-monitor', datasetVersion)
await rm(outputRoot, { recursive: true, force: true })
await mkdir(resolve(outputRoot, 'cities'), { recursive: true })
const currentPath = resolve(outputRoot, 'current.json')
await cosCall('headObject', 'housing-data/current.json')
console.log('[monitor] Cloud storage metadata preflight passed')
await downloadObject('housing-data/current.json', currentPath)
const currentText = await readFile(currentPath, 'utf8')
const current = JSON.parse(currentText)
if (current.dataset_version !== datasetVersion || current.manifest_sha256 !== audit.manifest_sha256) throw new Error('Active pointer no longer matches the monitored published release')
if (sha256(currentText) !== expectedCurrentSha256) throw new Error('Active pointer hash no longer matches the publish and repair audit chain')
const invocation = await scf.Invoke({ FunctionName: 'getHousingDataManifest', Namespace: cloudEnvId, InvocationType: 'RequestResponse' })
validateManifestFunctionOutput(JSON.stringify(invocation), current)
const cloudRoot = `housing-data/releases/${datasetVersion}`
await downloadObject(`${cloudRoot}/manifest.json`, resolve(outputRoot, 'manifest.json'))
const manifestText = await readFile(resolve(outputRoot, 'manifest.json'), 'utf8')
if (sha256(manifestText) !== current.manifest_sha256) throw new Error('Monitored manifest hash mismatch')
const manifest = JSON.parse(manifestText)
if (manifest.dataset_version !== audit.dataset_version
  || manifest.source_dataset_version !== audit.source_dataset_version
  || manifest.dataset_as_of !== audit.dataset_as_of
  || manifest.bootstrap_sha256 !== audit.bootstrap_sha256
  || manifest.bootstrap_bytes !== audit.bootstrap_bytes
  || JSON.stringify([...(manifest.source_batch_ids || [])].sort()) !== JSON.stringify([...(audit.source_batch_ids || [])].sort())) {
  throw new Error('Monitored manifest metadata no longer matches the immutable publish audit')
}
await downloadObject(`${cloudRoot}/bootstrap.json`, resolve(outputRoot, 'bootstrap.json'))
for (const cityId of Object.keys(manifest.city_files || {})) {
  await downloadObject(`${cloudRoot}/cities/${cityId}.json`, resolve(outputRoot, 'cities', `${cityId}.json`))
}
if (Object.keys(manifest.city_files || {}).length !== 70) throw new Error('Monitored manifest does not contain 70 cities')
await copyFile(currentPath, resolve(outputRoot, 'current.candidate.json'))
await execFileAsync(process.execPath, [resolve(root, 'scripts/miniprogram/verify-remote-data.mjs'), `--dir=${outputRoot}`, '--integrity-only'], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
const freshness = classifyRemoteFreshness(manifest, bundledSnapshot)
const result = { status: 'passed', integrity_status: 'passed', ...freshness, dataset_version: datasetVersion, source_dataset_version: manifest.source_dataset_version, bundled_source_dataset_version: bundledSnapshot.datasetVersion, dataset_as_of: current.dataset_as_of, cloud_env_id: cloudEnvId, current_sha256: sha256(currentText), manifest_sha256: current.manifest_sha256, city_count: 70, cloud_function_verified: true, publish_audit_matched: true, pointer_repair_audits_matched: pointerRepairCount, full_release_reconstructed: true, production_pointer_untouched: true, client_success_rate: null, client_success_rate_reason: 'no anonymous aggregate client telemetry configured', checked_at: new Date().toISOString() }
await writeFile(resolve(outputRoot, 'monitor-report.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result))
