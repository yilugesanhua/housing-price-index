import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { loadValidatedAuditEvidence } from './audit-evidence.mjs'
import { buildCompleteRemoteRelease, verifyCompleteRemoteRelease } from './complete-remote-data.mjs'
import { clientNextCheckAt } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const dataConfig = require(resolve(root, 'apps/miniprogram/config/data.js'))
const versionConfig = require(resolve(root, 'apps/miniprogram/config/version.js'))
const locationConfig = require(resolve(root, 'apps/miniprogram/config/location.js'))
const completeSnapshot = JSON.parse(await readFile(resolve(root, 'work/miniprogram-data-input/complete-snapshot.json'), 'utf8'))
const publishedData = JSON.parse(await readFile(resolve(root, 'apps/web/public/data/data.json'), 'utf8'))
const publishedManifest = JSON.parse(await readFile(resolve(root, 'apps/web/public/data/manifest.json'), 'utf8'))
const calendarPath = process.argv.find((argument) => argument.startsWith('--calendar='))?.slice('--calendar='.length) || resolve(root, 'work/monthly-data-check/release-calendar.json')
const explicitNextCheckAt = process.argv.find((argument) => argument.startsWith('--next-check-at='))?.slice('--next-check-at='.length)
const cloudEnvId = process.argv.find((argument) => argument.startsWith('--env='))?.slice('--env='.length) || locationConfig.cloudEnvId
const nextCheckAt = explicitNextCheckAt || clientNextCheckAt(JSON.parse(await readFile(resolve(calendarPath), 'utf8')), completeSnapshot.datasetAsOf)
const sourceBatchIds = [...new Set(publishedData.records.filter((record) => record.stat_month >= completeSnapshot.coverageStart).map((record) => record.source_batch_id).filter(Boolean))].sort()
const { identity: auditIdentity } = await loadValidatedAuditEvidence(root, {
  expectedParserVersion: publishedManifest.parser_version,
  expectedCoverageEnd: completeSnapshot.datasetAsOf,
})
const release = buildCompleteRemoteRelease(completeSnapshot, {
  cloudEnvId,
  storageBucket: dataConfig.storageBucket,
  minimumAppVersion: versionConfig.version,
  nextCheckAt,
  sourceBatchIds,
  auditIdentity,
})
const errors = verifyCompleteRemoteRelease(completeSnapshot, release)
if (errors.length) throw new Error(`Complete remote release validation failed:\n- ${errors.join('\n- ')}`)

const outputRoot = resolve(root, 'work/miniprogram-complete-data', release.manifest.dataset_version)
await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
await writeFile(resolve(outputRoot, 'complete-snapshot.json'), release.completeSnapshotText, 'utf8')
await writeFile(resolve(outputRoot, 'manifest.json'), release.manifestText, 'utf8')
await writeFile(resolve(outputRoot, 'current.candidate.json'), release.currentText, 'utf8')
const report = {
  status: 'staged_not_uploaded',
  cloud_env_id: cloudEnvId,
  storage_bucket: dataConfig.storageBucket,
  app_version: versionConfig.version,
  remote_schema_version: release.manifest.remote_schema_version,
  dataset_version: release.manifest.dataset_version,
  source_dataset_version: release.manifest.source_dataset_version,
  coverage_start: release.manifest.coverage_start,
  dataset_as_of: release.manifest.dataset_as_of,
  month_count: release.manifest.month_count,
  record_count: release.manifest.month_count * 70 * 2 * 4,
  complete_snapshot_sha256: release.manifest.complete_snapshot_sha256,
  complete_snapshot_bytes: release.manifest.complete_snapshot_bytes,
  manifest_sha256: release.current.manifest_sha256,
  total_release_bytes: release.totalBytes,
  source_batch_count: sourceBatchIds.length,
  audit_version: release.manifest.audit_version,
  audit_report_sha256: release.manifest.audit_report_sha256,
  audit_code_sha256: release.manifest.audit_code_sha256,
  audit_repository_commit_sha: release.manifest.audit_repository_commit_sha,
  generated_at: new Date().toISOString(),
}
await writeFile(resolve(outputRoot, 'release-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await writeFile(resolve(root, 'work/miniprogram-complete-data/latest-candidate.json'), `${JSON.stringify({ dataset_version: report.dataset_version }, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
