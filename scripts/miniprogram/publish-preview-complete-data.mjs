import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { buildCompleteRemoteRelease, verifyCompleteRemoteRelease } from './complete-remote-data.mjs'
import { buildControlValidUntil, buildRevocationRegistryArtifact, createRevocationRegistry, validateControlPointer } from './control-plane.mjs'
import { clientNextCheckAt, sha256, stableJson } from './remote-data-lib.mjs'
import { createTencentCloudClient } from './tencent-cloud-sdk.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const dataConfig = require(resolve(root, 'apps/miniprogram/config/data.js'))
const versionConfig = require(resolve(root, 'apps/miniprogram/config/version.js'))
const locationConfig = require(resolve(root, 'apps/miniprogram/config/location.js'))
const cloudEnvId = locationConfig.cloudEnvId
const dataRoot = 'housing-data/preview'
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const dryRun = process.argv.includes('--dry-run')

if (!dryRun && process.env.GITHUB_ACTIONS !== 'true') throw new Error('Preview upload is allowed only in GitHub Actions')
const completeSnapshot = JSON.parse(await readFile(resolve(root, 'work/miniprogram-data-input/complete-snapshot.json'), 'utf8'))
const publishedData = JSON.parse(await readFile(resolve(root, 'apps/web/public/data/data.json'), 'utf8'))
const calendarPath = argument('calendar') || resolve(root, 'work/monthly-data-check/release-calendar.json')
const calendar = JSON.parse(await readFile(resolve(calendarPath), 'utf8'))
const sourceBatchIds = [...new Set(publishedData.records.filter((record) => record.stat_month >= completeSnapshot.coverageStart).map((record) => record.source_batch_id).filter(Boolean))].sort()
const release = buildCompleteRemoteRelease(completeSnapshot, {
  cloudEnvId,
  storageBucket: dataConfig.storageBucket,
  minimumAppVersion: versionConfig.version,
  nextCheckAt: clientNextCheckAt(calendar, completeSnapshot.datasetAsOf),
  sourceBatchIds,
  dataRoot,
})
const errors = verifyCompleteRemoteRelease(completeSnapshot, release)
if (errors.length) throw new Error(`Preview complete package validation failed:\n- ${errors.join('\n- ')}`)
const generatedAt = new Date().toISOString()
const registryArtifact = buildRevocationRegistryArtifact(createRevocationRegistry({ generatedAt }), {
  cloudEnvId,
  storageBucket: dataConfig.storageBucket,
  dataRoot,
})
const current = {
  ...release.current,
  published_at: generatedAt,
  previous_dataset_version: null,
  control_schema_version: '1.0.0',
  control_generation: 1,
  ...registryArtifact.currentFields,
  transition_type: 'publish',
  data_status: 'current',
  status_reason: 'isolated_development_preview',
  control_generated_at: generatedAt,
  control_valid_until: buildControlValidUntil(generatedAt),
}
validateControlPointer(current, { config: { cloudEnvId, storageBucket: dataConfig.storageBucket, remoteDataRoot: dataRoot }, allowLegacy: false, requireContext: true, manifest: release.manifest, registry: registryArtifact.registry })
const currentText = stableJson(current)
const prefix = `${dataRoot}/releases/${release.manifest.dataset_version}`
const output = resolve(root, 'work/miniprogram-preview-data', release.manifest.dataset_version)
await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true })
for (const [name, content] of [['complete-snapshot.json', release.completeSnapshotText], ['manifest.json', release.manifestText], ['current.json', currentText], ['revocations.json', registryArtifact.text]]) {
  await writeFile(resolve(output, name), content, 'utf8')
}
const report = { status: dryRun ? 'dry_run_passed' : 'uploaded', data_root: dataRoot, dataset_version: current.dataset_version, complete_snapshot_sha256: sha256(release.completeSnapshotText), complete_snapshot_bytes: release.manifest.complete_snapshot_bytes, manifest_sha256: current.manifest_sha256, current_sha256: sha256(currentText), production_pointer_untouched: true, production_release_prefix_untouched: true }
if (!dryRun) {
  const cloud = createTencentCloudClient({ cloudEnvId })
  const uploadExact = async (key, body) => {
    if (await cloud.objectExists(key)) {
      if ((await cloud.getObject(key)).toString('utf8') !== body) throw new Error(`Preview immutable object differs: ${key}`)
    } else {
      await cloud.putObject(key, Buffer.from(body, 'utf8'))
      if ((await cloud.getObject(key)).toString('utf8') !== body) throw new Error(`Preview object round-trip failed: ${key}`)
    }
  }
  await uploadExact(`${prefix}/complete-snapshot.json`, release.completeSnapshotText)
  await uploadExact(`${prefix}/manifest.json`, release.manifestText)
  await uploadExact(registryArtifact.cosKey, registryArtifact.text)
  await cloud.putObject(`${dataRoot}/current.json`, Buffer.from(currentText, 'utf8'))
  if ((await cloud.getObject(`${dataRoot}/current.json`)).toString('utf8') !== currentText) throw new Error('Preview current pointer round-trip failed')
}
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report))
