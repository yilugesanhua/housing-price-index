import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { runTcb } from './cloudbase-cli.mjs'
import { validateManifestFunctionOutput } from './post-publish-guard.mjs'
import { sha256 } from './remote-data-lib.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const datasetVersion = argument('dataset')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || '')) throw new Error('Use --dataset=<active-version>')
const audit = JSON.parse(await readFile(resolve(root, 'data/releases', `${datasetVersion}.json`), 'utf8'))
if (audit.status !== 'published' || audit.cloud_env_id !== cloudEnvId) throw new Error('Monitor target lacks a matching publish audit')
const outputRoot = resolve(root, 'work/post-publish-monitor', datasetVersion)
await rm(outputRoot, { recursive: true, force: true })
await mkdir(resolve(outputRoot, 'cities'), { recursive: true })
const currentPath = resolve(outputRoot, 'current.json')
await runTcb(['storage', 'detail', 'housing-data/current.json', '--json', '-e', cloudEnvId])
console.log('[monitor] Cloud storage metadata preflight passed')
await runTcb(['storage', 'download', 'housing-data/current.json', currentPath, '-e', cloudEnvId])
const currentText = await readFile(currentPath, 'utf8')
const current = JSON.parse(currentText)
if (current.dataset_version !== datasetVersion || current.manifest_sha256 !== audit.manifest_sha256) throw new Error('Active pointer no longer matches the monitored published release')
const invocation = await runTcb(['fn', 'invoke', 'getHousingDataManifest', '--json', '-e', cloudEnvId])
validateManifestFunctionOutput(invocation.stdout, current)
const cloudRoot = `housing-data/releases/${datasetVersion}`
await runTcb(['storage', 'download', `${cloudRoot}/manifest.json`, resolve(outputRoot, 'manifest.json'), '--json', '-e', cloudEnvId])
const manifestText = await readFile(resolve(outputRoot, 'manifest.json'), 'utf8')
if (sha256(manifestText) !== current.manifest_sha256) throw new Error('Monitored manifest hash mismatch')
const manifest = JSON.parse(manifestText)
await runTcb(['storage', 'download', `${cloudRoot}/bootstrap.json`, resolve(outputRoot, 'bootstrap.json'), '--json', '-e', cloudEnvId])
for (const cityId of Object.keys(manifest.city_files || {})) {
  await runTcb(['storage', 'download', `${cloudRoot}/cities/${cityId}.json`, resolve(outputRoot, 'cities', `${cityId}.json`), '--json', '-e', cloudEnvId])
}
if (Object.keys(manifest.city_files || {}).length !== 70) throw new Error('Monitored manifest does not contain 70 cities')
await copyFile(currentPath, resolve(outputRoot, 'current.candidate.json'))
await execFileAsync(process.execPath, [resolve(root, 'scripts/miniprogram/verify-remote-data.mjs'), `--dir=${outputRoot}`], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
const result = { status: 'passed', dataset_version: datasetVersion, dataset_as_of: current.dataset_as_of, cloud_env_id: cloudEnvId, current_sha256: sha256(currentText), manifest_sha256: current.manifest_sha256, city_count: 70, cloud_function_verified: true, full_release_reconstructed: true, client_success_rate: null, client_success_rate_reason: 'no anonymous aggregate client telemetry configured', checked_at: new Date().toISOString() }
await writeFile(resolve(outputRoot, 'monitor-report.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result))
