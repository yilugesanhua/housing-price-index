import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { buildRemoteRelease, clientNextCheckAt, verifyReleaseAgainstSnapshot } from './remote-data-lib.mjs'

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
const calendar = JSON.parse(await readFile(resolve(calendarPath), 'utf8'))
const nextCheckAt = clientNextCheckAt(calendar, snapshot.datasetAsOf)
const release = buildRemoteRelease(snapshot, { cloudEnvId, storageBucket: dataConfig.storageBucket, minimumAppVersion: versionConfig.version, nextCheckAt, sourceBatchIds })
const outputRoot = resolve(root, 'work/miniprogram-data', release.manifest.dataset_version)
const errors = verifyReleaseAgainstSnapshot(snapshot, release)
if (errors.length) throw new Error(`Remote release validation failed:\n- ${errors.join('\n- ')}`)

await rm(outputRoot, { recursive: true, force: true })
await mkdir(resolve(outputRoot, 'cities'), { recursive: true })
await writeFile(resolve(outputRoot, 'bootstrap.json'), release.bootstrapText, 'utf8')
await writeFile(resolve(outputRoot, 'manifest.json'), release.manifestText, 'utf8')
await writeFile(resolve(outputRoot, 'current.candidate.json'), release.currentText, 'utf8')
await Promise.all(Object.entries(release.cities).map(([cityId, item]) => writeFile(resolve(outputRoot, 'cities', `${cityId}.json`), item.text, 'utf8')))
const report = {
  status: 'staged',
  cloud_env_id: cloudEnvId,
  storage_bucket: dataConfig.storageBucket,
  app_version: versionConfig.version,
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
