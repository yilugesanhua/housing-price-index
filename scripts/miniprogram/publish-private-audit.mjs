import { copyFile, glob, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { isMissingCloudFile, runTcb } from './cloudbase-cli.mjs'
import { byteLength, sha256 } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const datasetVersion = argument('dataset')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const dryRun = process.argv.includes('--dry-run')
if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || '')) throw new Error('Use --dataset=<published-version>')
if (!/^cloud[\w-]+$/.test(cloudEnvId)) throw new Error('Invalid cloud environment ID')
const month = datasetVersion.slice(0, 7)
const outputRoot = resolve(root, 'work/private-audit', datasetVersion)
await rm(outputRoot, { recursive: true, force: true })
await mkdir(resolve(outputRoot, 'source'), { recursive: true })
await mkdir(resolve(outputRoot, 'reports'), { recursive: true })

const requiredCopies = [
  [resolve(root, 'work/auto-release/gate-report.json'), resolve(outputRoot, 'reports/production-gate.json')],
  [resolve(root, 'work/auto-release/discovery-gate.json'), resolve(outputRoot, 'reports/discovery-gate.json')],
  [resolve(root, 'work/monthly-data-check/release-calendar.json'), resolve(outputRoot, 'reports/release-calendar.json')],
  [resolve(root, 'data/releases', `${datasetVersion}.json`), resolve(outputRoot, 'reports/publish-audit.json')],
  [resolve(root, 'work/miniprogram-data', datasetVersion, 'release-report.json'), resolve(outputRoot, 'reports/release-report.json')],
]
for (const [source, destination] of requiredCopies) await copyFile(source, destination)

let sourceCount = 0
for await (const path of await glob(`data/raw/${month}/*.{batch.json,html.gz}`)) {
  await copyFile(resolve(root, path), resolve(outputRoot, 'source', basename(path)))
  sourceCount += 1
}
if (sourceCount !== 2) throw new Error(`Private audit requires exactly one batch and one compressed HTML archive; got ${sourceCount} files`)

const files = []
for await (const path of await glob('**/*', { cwd: outputRoot })) {
  const absolute = resolve(outputRoot, path)
  try {
    const content = await readFile(absolute)
    files.push({ path: path.replaceAll('\\', '/'), sha256: sha256(content), bytes: content.byteLength })
  } catch (_) {}
}
files.sort((a, b) => a.path.localeCompare(b.path))
const publishAudit = JSON.parse(await readFile(resolve(root, 'data/releases', `${datasetVersion}.json`), 'utf8'))
const manifest = {
  format: 'housing-data-private-audit-v1',
  dataset_version: datasetVersion,
  cloud_env_id: cloudEnvId,
  github_run_id: process.env.GITHUB_RUN_ID || null,
  commit_sha: process.env.CI_COMMIT_SHA || null,
  created_at: publishAudit.published_at,
  files,
  total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
}
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
const manifestPath = resolve(outputRoot, 'audit-manifest.json')
await writeFile(manifestPath, manifestText, 'utf8')
if (dryRun) {
  console.log(`Staged private audit ${datasetVersion}: ${files.length} evidence files, ${byteLength(manifestText) + manifest.total_bytes} bytes`)
  process.exit(0)
}
const cloudRoot = `housing-data-audit/releases/${datasetVersion}`
const existing = await runTcb(['storage', 'detail', `${cloudRoot}/audit-manifest.json`, '--json', '-e', cloudEnvId], { allowFailure: true })
if (existing.ok) {
  const roundTrip = resolve(outputRoot, 'existing-audit-manifest.json')
  await runTcb(['storage', 'download', `${cloudRoot}/audit-manifest.json`, roundTrip, '--json', '-e', cloudEnvId])
  const existingManifest = JSON.parse(await readFile(roundTrip, 'utf8'))
  if (existingManifest.format !== 'housing-data-private-audit-v1' || existingManifest.dataset_version !== datasetVersion || existingManifest.cloud_env_id !== cloudEnvId || !Array.isArray(existingManifest.files)) throw new Error('Existing private audit manifest is invalid')
  const existingPaths = new Set(existingManifest.files.map((file) => file.path))
  for (const required of ['reports/production-gate.json', 'reports/publish-audit.json', 'reports/release-report.json']) if (!existingPaths.has(required)) throw new Error(`Existing private audit is missing ${required}`)
  if (![...existingPaths].some((path) => path.startsWith('source/') && path.endsWith('.batch.json')) || ![...existingPaths].some((path) => path.startsWith('source/') && path.endsWith('.html.gz'))) throw new Error('Existing private audit is missing source evidence')
  const verifyRoot = resolve(outputRoot, 'existing-audit-verify')
  for (const file of existingManifest.files) {
    if (!/^[a-zA-Z0-9._/-]+$/.test(file.path || '') || file.path.includes('..') || !/^[a-f0-9]{64}$/.test(file.sha256 || '') || !Number.isInteger(file.bytes)) throw new Error('Existing private audit contains unsafe file metadata')
    const destination = resolve(verifyRoot, file.path)
    await mkdir(dirname(destination), { recursive: true })
    await runTcb(['storage', 'download', `${cloudRoot}/${file.path}`, destination, '--json', '-e', cloudEnvId])
    const content = await readFile(destination)
    if (content.byteLength !== file.bytes || sha256(content) !== file.sha256) throw new Error(`Existing private audit file verification failed: ${file.path}`)
  }
  console.log(`Private audit ${datasetVersion} already exists and all ${existingManifest.files.length} files passed verification`)
  process.exit(0)
}
if (!isMissingCloudFile(existing)) throw new Error(`Could not prove private audit path is unused: ${existing.stderr || existing.stdout}`)
await runTcb(['storage', 'upload', outputRoot, cloudRoot, '--times', '3', '--json', '-e', cloudEnvId])
const roundTrip = resolve(outputRoot, 'audit-manifest.roundtrip.json')
await runTcb(['storage', 'download', `${cloudRoot}/audit-manifest.json`, roundTrip, '--json', '-e', cloudEnvId])
if (sha256(await readFile(roundTrip)) !== sha256(manifestText)) throw new Error('Private audit manifest round-trip verification failed')
console.log(`Published private audit ${datasetVersion}: ${files.length} evidence files, ${byteLength(manifestText) + manifest.total_bytes} bytes`)
