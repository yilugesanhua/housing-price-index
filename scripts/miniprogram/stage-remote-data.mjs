import { glob, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { buildRemoteRelease, clientNextCheckAt, verifyReleaseAgainstSnapshot } from './remote-data-lib.mjs'
import { loadAndValidateHistoricalCorrection } from './historical-correction-lib.mjs'
import { buildPublicationIdentity, validateAuditSourceIndex } from './publication-identity.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const snapshotPath = process.argv.find((argument) => argument.startsWith('--snapshot='))?.slice('--snapshot='.length) || 'apps/miniprogram/data/snapshot.js'
const snapshot = require(resolve(root, snapshotPath))
const locationConfig = require(resolve(root, 'apps/miniprogram/config/location.js'))
const versionConfig = require(resolve(root, 'apps/miniprogram/config/version.js'))
const cloudEnvId = process.argv.find((argument) => argument.startsWith('--env='))?.slice('--env='.length) || locationConfig.cloudEnvId
const dataRoot = process.argv.find((argument) => argument.startsWith('--data-root='))?.slice('--data-root='.length) || 'apps/web/public/data'
const auditRoot = process.argv.find((argument) => argument.startsWith('--audit-root='))?.slice('--audit-root='.length) || ''
const publishedData = JSON.parse(await readFile(resolve(root, dataRoot, 'data.json'), 'utf8'))
const latestSourceBatchIds = [...new Set(publishedData.records
  .filter((record) => record.stat_month === snapshot.datasetAsOf)
  .map((record) => record.source_batch_id)
  .filter(Boolean))].sort()
const auditReport = JSON.parse(await readFile(resolve(root, auditRoot || 'data', 'audit-report.json'), 'utf8'))
const sourceBatchPaths = await glob('data/raw/**/*.batch.json', { cwd: root })
const sourceBatches = []
for (const path of sourceBatchPaths) {
  const batch = JSON.parse(await readFile(resolve(root, path), 'utf8'))
  if (batch?.source_batch?.stat_month <= snapshot.datasetAsOf) sourceBatches.push(batch)
}
validateAuditSourceIndex({ auditReport, batches: sourceBatches })
const publicationIdentity = buildPublicationIdentity({ records: publishedData.records, auditReport })
const dataConfig = require(resolve(root, 'apps/miniprogram/config/data.js'))
const calendarPath = process.argv.find((argument) => argument.startsWith('--calendar='))?.slice('--calendar='.length) || resolve(root, 'work/monthly-data-check/release-calendar.json')
const explicitNextCheckAt = process.argv.find((argument) => argument.startsWith('--next-check-at='))?.slice('--next-check-at='.length)
const correctionPath = process.argv.find((argument) => argument.startsWith('--correction='))?.slice('--correction='.length)
const commitSha = process.argv.find((argument) => argument.startsWith('--commit='))?.slice('--commit='.length)
const githubRunId = process.argv.find((argument) => argument.startsWith('--run-id='))?.slice('--run-id='.length)
const outputDirectory = process.argv.find((argument) => argument.startsWith('--output-root='))?.slice('--output-root='.length) || 'work/miniprogram-data'
const latestCandidatePath = process.argv.find((argument) => argument.startsWith('--latest-candidate='))?.slice('--latest-candidate='.length) || 'work/miniprogram-data/latest-candidate.json'
const nextCheckAt = explicitNextCheckAt || clientNextCheckAt(JSON.parse(await readFile(resolve(calendarPath), 'utf8')), snapshot.datasetAsOf)
if (!Number.isFinite(Date.parse(nextCheckAt || ''))) throw new Error('Invalid --next-check-at value')
const generatedAt = process.env.AUTO_RELEASE_TIME_SEED && Number.isFinite(Date.parse(process.env.AUTO_RELEASE_TIME_SEED))
  ? new Date(process.env.AUTO_RELEASE_TIME_SEED).toISOString()
  : snapshot.generatedAt
let correction = correctionPath ? await loadAndValidateHistoricalCorrection({
  root,
  requestPath: resolve(root, correctionPath),
  candidateCommitSha: commitSha,
  githubRunId,
}) : null
if (correction) {
  for (const field of ['candidate_records_sha256', 'audit_records_sha256', 'source_index_sha256', 'audit_report_sha256', 'audit_commit_sha', 'audit_code_sha256', 'audit_version']) {
    if (correction[field] !== publicationIdentity[field]) throw new Error(`Correction identity differs from staged publication identity: ${field}`)
  }
  if (JSON.stringify(correction.latest_source_batch_ids) !== JSON.stringify(latestSourceBatchIds)) throw new Error('Correction latest source batches differ from staged publication')
}
const minimumAppVersion = correction ? dataConfig.correctionMinimumAppVersion : dataConfig.monthlyMinimumAppVersion
const release = buildRemoteRelease(snapshot, {
  cloudEnvId,
  storageBucket: dataConfig.storageBucket,
  minimumAppVersion,
  nextCheckAt,
  latestSourceBatchIds,
  publicationIdentity,
  correction,
})
const outputRoot = resolve(root, outputDirectory, release.manifest.dataset_version)
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
  source_dataset_version: snapshot.sourceDatasetVersion,
  dataset_as_of: snapshot.datasetAsOf,
  release_date: snapshot.releaseDate,
  official_url: snapshot.latestOfficialUrl,
  next_check_at: nextCheckAt,
  latest_source_batch_ids: release.manifest.latest_source_batch_ids,
  revision_source_batch_ids: release.manifest.revision_source_batch_ids || [],
  candidate_records_sha256: release.manifest.candidate_records_sha256,
  audit_records_sha256: release.manifest.audit_records_sha256,
  source_index_sha256: release.manifest.source_index_sha256,
  audit_report_sha256: release.manifest.audit_report_sha256,
  audit_commit_sha: release.manifest.audit_commit_sha,
  audit_code_sha256: release.manifest.audit_code_sha256,
  ledger_before_sha256: release.manifest.ledger_before_sha256 || null,
  ledger_after_sha256: release.manifest.ledger_after_sha256 || null,
  ledger_append_start: release.manifest.ledger_append_start ?? null,
  ledger_append_count: release.manifest.ledger_append_count ?? null,
  ledger_append_sha256: release.manifest.ledger_append_sha256 || null,
  manifest_sha256: release.current.manifest_sha256,
  bootstrap_sha256: release.manifest.bootstrap_sha256,
  bootstrap_bytes: release.manifest.bootstrap_bytes,
  city_count: Object.keys(release.cities).length,
  largest_city_bytes: Math.max(...Object.values(release.cities).map((item) => item.bytes)),
  total_release_bytes: release.totalBytes,
  generated_at: generatedAt,
}
await writeFile(resolve(outputRoot, 'release-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await mkdir(resolve(root, latestCandidatePath, '..'), { recursive: true })
await writeFile(resolve(root, latestCandidatePath), `${JSON.stringify({ dataset_version: report.dataset_version, source_dataset_version: report.source_dataset_version }, null, 2)}\n`, 'utf8')
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
  `- 最新月来源批次：${report.latest_source_batch_ids.join(', ')}`,
  ...(report.revision_source_batch_ids.length ? [`- 历史修订来源批次：${report.revision_source_batch_ids.join(', ')}`] : []),
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
