import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { buildRemoteRelease, clientNextCheckAt, sha256, verifyReleaseAgainstSnapshot } from './remote-data-lib.mjs'
import { loadAndValidateHistoricalCorrection } from './historical-correction-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const snapshot = require(resolve(root, 'apps/miniprogram/data/snapshot.js'))
const locationConfig = require(resolve(root, 'apps/miniprogram/config/location.js'))
const versionConfig = require(resolve(root, 'apps/miniprogram/config/version.js'))
const cloudEnvId = process.argv.find((argument) => argument.startsWith('--env='))?.slice('--env='.length) || locationConfig.cloudEnvId
const publishedData = JSON.parse(await readFile(resolve(root, 'apps/web/public/data/data.json'), 'utf8'))
const sourceBatchIds = publishedData.records.filter((record) => record.stat_month === snapshot.datasetAsOf).map((record) => record.source_batch_id).filter(Boolean)
const dataConfig = require(resolve(root, 'apps/miniprogram/config/data.js'))
const calendarPath = process.argv.find((argument) => argument.startsWith('--calendar='))?.slice('--calendar='.length) || resolve(root, 'work/monthly-data-check/release-calendar.json')
const explicitNextCheckAt = process.argv.find((argument) => argument.startsWith('--next-check-at='))?.slice('--next-check-at='.length)
const correctionPath = process.argv.find((argument) => argument.startsWith('--correction='))?.slice('--correction='.length)
const commitSha = process.argv.find((argument) => argument.startsWith('--commit='))?.slice('--commit='.length)
const githubRunId = process.argv.find((argument) => argument.startsWith('--run-id='))?.slice('--run-id='.length)
const nextCheckAt = explicitNextCheckAt || clientNextCheckAt(JSON.parse(await readFile(resolve(calendarPath), 'utf8')), snapshot.datasetAsOf)
if (!Number.isFinite(Date.parse(nextCheckAt || ''))) throw new Error('Invalid --next-check-at value')
let correction = correctionPath ? await loadAndValidateHistoricalCorrection({ root, requestPath: resolve(root, correctionPath) }) : null
if (correction) {
  if (!/^[a-f0-9]{40}$/.test(commitSha || '') || !/^\d+$/.test(githubRunId || '')) throw new Error('Correction staging requires valid --commit and --run-id')
  correction = { ...correction, audit_report_sha256: sha256(await readFile(resolve(root, 'data/audit-report.json'))), commit_sha: commitSha, github_run_id: githubRunId }
}
const minimumAppVersion = correction ? dataConfig.correctionMinimumAppVersion : dataConfig.monthlyMinimumAppVersion
const release = buildRemoteRelease(snapshot, { cloudEnvId, storageBucket: dataConfig.storageBucket, minimumAppVersion, nextCheckAt, sourceBatchIds, correction })
const outputRoot = resolve(root, 'work/miniprogram-data', release.manifest.dataset_version)
const errors = verifyReleaseAgainstSnapshot(snapshot, release)
if (errors.length) throw new Error(`Remote release validation failed:\n- ${errors.join('\n- ')}`)

await rm(outputRoot, { recursive: true, force: true })
await mkdir(resolve(outputRoot, 'cities'), { recursive: true })
await writeFile(resolve(outputRoot, 'bootstrap.json'), release.bootstrapText, 'utf8')
await writeFile(resolve(outputRoot, 'manifest.json'), release.manifestText, 'utf8')
await writeFile(resolve(outputRoot, 'current.candidate.json'), release.currentText, 'utf8')
if (release.revisionManifestText) await writeFile(resolve(outputRoot, 'revision-manifest.json'), release.revisionManifestText, 'utf8')
await Promise.all(Object.entries(release.cities).map(([cityId, item]) => writeFile(resolve(outputRoot, 'cities', `${cityId}.json`), item.text, 'utf8')))
const report = {
  status: 'staged',
  cloud_env_id: cloudEnvId,
  storage_bucket: dataConfig.storageBucket,
  app_version: versionConfig.version,
  minimum_app_version: minimumAppVersion,
  release_type: release.manifest.release_type,
  revision_id: release.manifest.revision_id || null,
  supersedes_source_dataset_version: release.manifest.supersedes_source_dataset_version || null,
  revision_manifest_sha256: release.manifest.revision_manifest_sha256 || null,
  revision_manifest_bytes: release.manifest.revision_manifest_bytes || null,
  dataset_version: release.manifest.dataset_version,
  source_dataset_version: snapshot.datasetVersion,
  dataset_as_of: snapshot.datasetAsOf,
  release_date: snapshot.releaseDate,
  official_url: snapshot.latestOfficialUrl,
  next_check_at: nextCheckAt,
  source_batch_ids: release.manifest.source_batch_ids,
  manifest_sha256: release.current.manifest_sha256,
  bootstrap_sha256: release.manifest.bootstrap_sha256,
  bootstrap_bytes: release.manifest.bootstrap_bytes,
  city_count: Object.keys(release.cities).length,
  largest_city_bytes: Math.max(...Object.values(release.cities).map((item) => item.bytes)),
  total_release_bytes: release.totalBytes,
  generated_at: new Date().toISOString(),
}
await writeFile(resolve(outputRoot, 'release-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await writeFile(resolve(root, 'work/miniprogram-data/latest-candidate.json'), `${JSON.stringify({ dataset_version: report.dataset_version, source_dataset_version: report.source_dataset_version }, null, 2)}\n`, 'utf8')
await writeFile(resolve(outputRoot, 'release-report.md'), [
  '# 小程序远程数据候选包',
  '',
  `- 状态：已生成，未上传`,
  `- 云环境：${report.cloud_env_id}`,
  `- 小程序版本：${report.app_version}`,
  `- 数据版本：${report.dataset_version}`,
  `- 统计月份：${report.dataset_as_of}`,
  `- 官方发布日期：${report.release_date}`,
  `- 官方来源：${report.official_url}`,
  `- 来源批次：${report.source_batch_ids.join(', ')}`,
  `- Bootstrap：${report.bootstrap_bytes} bytes`,
  `- 最大城市分片：${report.largest_city_bytes} bytes`,
  `- 完整版本：${report.total_release_bytes} bytes`,
  `- 清单 SHA-256：${report.manifest_sha256}`,
  '',
  '本报告只证明候选包已通过本地生成门禁，不表示已上传或已上线。',
  '',
].join('\n'), 'utf8')
console.log(`Staged ${report.dataset_version} at ${outputRoot}`)
console.log(JSON.stringify(report, null, 2))
