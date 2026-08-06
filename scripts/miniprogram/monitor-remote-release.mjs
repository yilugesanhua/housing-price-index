import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import COS from 'cos-nodejs-sdk-v5'
import TencentCloudScf from 'tencentcloud-sdk-nodejs-scf'
import { validateManifestFunctionOutput } from './post-publish-guard.mjs'
import { classifyRemoteFreshness, sha256 } from './remote-data-lib.mjs'
import { validateControlPointer } from './control-plane.mjs'
import {
  validateControlAuditTransitions,
  validatePostWriteValidationReceiptInvocation,
} from './legacy-control-migration.mjs'
import {
  assertMonitorPointerStable,
  loadExplicitMigrationAudit,
  mergeMigrationAuditEntries,
} from './monitor-audit-chain.mjs'
import { validateMonitoredManifestMetadata, validateMonitorReleaseAudit } from './monitor-release-audit.mjs'
import { validateManualRollbackAudit } from './ci-rollback-authorization.mjs'
import { COMPLETE_REMOTE_MONTHS, COMPLETE_REMOTE_SCHEMA_VERSION, completeCoverageStart, validateCompleteRemoteSnapshot } from './complete-remote-data.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const datasetVersion = argument('dataset')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const migrationAuditDir = argument('migration-audit-dir')
const integrityOnly = process.argv.includes('--integrity-only')
const bundledSnapshot = integrityOnly ? null : require(resolve(root, 'apps/miniprogram/data/snapshot.js'))
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
const auditFileName = `${datasetVersion}.json`
const auditText = await readFile(resolve(root, 'data/releases', auditFileName), 'utf8')
const audit = JSON.parse(auditText)
const monitorAudit = validateMonitorReleaseAudit({
  audit,
  auditText,
  datasetVersion,
  expectedCloudEnvId: cloudEnvId,
  expectedStorageBucket: storageBucketId,
  fileName: auditFileName,
})
const releaseAuditDir = resolve(root, 'data/releases')
const repairFiles = (await readdir(releaseAuditDir)).filter((name) => name.startsWith('current-pointer-repair-') && name.endsWith('.json')).sort()
const repairs = await Promise.all(repairFiles.map(async (fileName) => ({
  fileName,
  audit: JSON.parse(await readFile(resolve(releaseAuditDir, fileName), 'utf8')),
})))
const migrationFiles = (await readdir(releaseAuditDir)).filter((name) => name.startsWith('legacy-control-migration-') && name.endsWith('.json')).sort()
const repositoryMigrations = await Promise.all(migrationFiles.map(async (fileName) => {
  const text = await readFile(resolve(releaseAuditDir, fileName), 'utf8')
  return { fileName, text, audit: JSON.parse(text) }
}))
const explicitMigrations = migrationAuditDir
  ? [await loadExplicitMigrationAudit({
      root,
      directory: migrationAuditDir,
      datasetVersion,
      sourceDatasetVersion: audit.source_dataset_version,
      manifestSha256: audit.manifest_sha256,
      cloudEnvId,
      storageBucket: storageBucketId,
    })]
  : []
const migrations = mergeMigrationAuditEntries(repositoryMigrations, explicitMigrations)
const rollbackFiles = (await readdir(releaseAuditDir)).filter((name) => name.startsWith('manual-data-rollback-') && name.endsWith('.json')).sort()
const matchingRollbacks = []
for (const fileName of rollbackFiles) {
  const rollbackAudit = JSON.parse(await readFile(resolve(releaseAuditDir, fileName), 'utf8'))
  if (rollbackAudit?.to_dataset_version !== datasetVersion) continue
  validateManualRollbackAudit(rollbackAudit, {
    datasetVersion,
    cloudEnvId,
    storageBucket: storageBucketId,
    expectedOriginCommitSha: rollbackAudit.commit_sha,
    expectedOriginGithubRunId: rollbackAudit.github_run_id,
    expectedOriginGithubRunAttempt: rollbackAudit.github_run_attempt,
    expectedFinalizerCommitSha: rollbackAudit.finalizer_commit_sha,
    expectedFinalizerGithubRunId: rollbackAudit.finalizer_github_run_id,
    expectedFinalizerGithubRunAttempt: rollbackAudit.finalizer_github_run_attempt,
    expectedFinalizerOrdinaryCiRunId: rollbackAudit.finalizer_ordinary_ci_run_id,
  })
  if (rollbackAudit.to_source_dataset_version !== audit.source_dataset_version
    || rollbackAudit.target_manifest_sha256 !== audit.manifest_sha256) {
    throw new Error(`Manual rollback audit targets different immutable release content: ${fileName}`)
  }
  matchingRollbacks.push({ fileName, audit: rollbackAudit, time: Date.parse(rollbackAudit.rolled_back_at) })
}
matchingRollbacks.sort((left, right) => right.time - left.time || left.fileName.localeCompare(right.fileName, 'en'))
if (matchingRollbacks.length > 1
  && matchingRollbacks[0].time === matchingRollbacks[1].time
  && matchingRollbacks[0].audit.after_sha256 !== matchingRollbacks[1].audit.after_sha256) {
  throw new Error('Manual rollback audits have an ambiguous latest pointer identity')
}
const latestRollback = matchingRollbacks[0] || null
const transitionChain = validateControlAuditTransitions({
  initialSha256: latestRollback?.audit.after_sha256 || audit.current_sha256,
  datasetVersion,
  sourceDatasetVersion: audit.source_dataset_version,
  manifestSha256: audit.manifest_sha256,
  cloudEnvId,
  storageBucket: storageBucketId,
  repairs: latestRollback ? repairs.filter(({ audit: item }) => Date.parse(item.repaired_at || '') >= latestRollback.time) : repairs,
  migrations: latestRollback ? migrations.filter(({ audit: item }) => Date.parse(item.migrated_at || '') >= latestRollback.time) : migrations,
})
const expectedCurrentSha256 = transitionChain.expectedCurrentSha256
const pointerRepairCount = transitionChain.pointerRepairCount
const pointerMigrationCount = transitionChain.pointerMigrationCount
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
validateControlPointer(current, { allowLegacy: false, cloudEnvId, storageBucket: storageBucketId })
const invocation = await scf.Invoke({ FunctionName: 'getHousingDataManifest', Namespace: cloudEnvId, InvocationType: 'RequestResponse' })
validateManifestFunctionOutput(JSON.stringify(invocation), current)
const cloudFunctionValidation = validatePostWriteValidationReceiptInvocation(invocation, current, {
  observedAt: new Date().toISOString(),
})
const cloudFunctionVerified = Boolean(cloudFunctionValidation.receipt_sha256)
const cloudRoot = `housing-data/releases/${datasetVersion}`
await downloadObject(`${cloudRoot}/manifest.json`, resolve(outputRoot, 'manifest.json'))
const manifestText = await readFile(resolve(outputRoot, 'manifest.json'), 'utf8')
if (sha256(manifestText) !== current.manifest_sha256) throw new Error('Monitored manifest hash mismatch')
const manifest = JSON.parse(manifestText)
const isCompleteHistory = manifest.remote_schema_version === COMPLETE_REMOTE_SCHEMA_VERSION
validateMonitoredManifestMetadata({
  manifest,
  audit,
  usedLegacyBinding: monitorAudit.usedLegacyBinding,
})
if (manifest.dataset_version !== audit.dataset_version
  || manifest.source_dataset_version !== audit.source_dataset_version
  || manifest.dataset_as_of !== audit.dataset_as_of
  || (isCompleteHistory
    ? manifest.complete_snapshot_sha256 !== audit.complete_snapshot_sha256
      || manifest.complete_snapshot_bytes !== audit.complete_snapshot_bytes
      || manifest.coverage_start !== completeCoverageStart(manifest.dataset_as_of)
      || manifest.month_count !== COMPLETE_REMOTE_MONTHS
    : manifest.bootstrap_sha256 !== audit.bootstrap_sha256
      || manifest.bootstrap_bytes !== audit.bootstrap_bytes)) {
  throw new Error('Monitored manifest metadata no longer matches the immutable publish audit')
}
const registryKey = `housing-data/control/revocations-${current.revocations_sha256}.json`
const registryText = (await cosCall('getObject', registryKey)).Body.toString('utf8')
if (sha256(registryText) !== current.revocations_sha256) throw new Error('Monitored revocations registry hash mismatch')
const registry = JSON.parse(registryText)
validateControlPointer(current, {
  allowLegacy: false,
  requireContext: true,
  manifest,
  registry,
  cloudEnvId,
  storageBucket: storageBucketId,
})
if (isCompleteHistory) {
  const snapshotPath = resolve(outputRoot, 'complete-snapshot.json')
  await downloadObject(`${cloudRoot}/complete-snapshot.json`, snapshotPath)
  const snapshotText = await readFile(snapshotPath, 'utf8')
  if (sha256(snapshotText) !== manifest.complete_snapshot_sha256 || Buffer.byteLength(snapshotText) !== manifest.complete_snapshot_bytes) throw new Error('Monitored complete snapshot hash or byte size mismatch')
  const completeSnapshot = JSON.parse(snapshotText)
  validateCompleteRemoteSnapshot(completeSnapshot)
  if (completeSnapshot.datasetVersion !== datasetVersion || completeSnapshot.sourceDatasetVersion !== manifest.source_dataset_version) throw new Error('Monitored complete snapshot identity mismatch')
} else {
  await downloadObject(`${cloudRoot}/bootstrap.json`, resolve(outputRoot, 'bootstrap.json'))
  if (manifest.release_type === 'historical_correction') await downloadObject(`${cloudRoot}/revision-manifest.json`, resolve(outputRoot, 'revision-manifest.json'))
  for (const cityId of Object.keys(manifest.city_files || {})) {
    await downloadObject(`${cloudRoot}/cities/${cityId}.json`, resolve(outputRoot, 'cities', `${cityId}.json`))
  }
  if (Object.keys(manifest.city_files || {}).length !== 70) throw new Error('Monitored manifest does not contain 70 cities')
  await copyFile(currentPath, resolve(outputRoot, 'current.candidate.json'))
  await execFileAsync(process.execPath, [resolve(root, 'scripts/miniprogram/verify-remote-data.mjs'), `--dir=${outputRoot}`, '--integrity-only'], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
}
const freshness = integrityOnly
  ? { freshness_status: 'not_evaluated_integrity_only', client_action: 'integrity_verification_only' }
  : classifyRemoteFreshness(manifest, bundledSnapshot)
const finalCurrentText = (await cosCall('getObject', 'housing-data/current.json')).Body.toString('utf8')
assertMonitorPointerStable(currentText, finalCurrentText)
const result = {
  status: 'passed',
  integrity_status: 'passed',
  ...freshness,
  freshness_evaluated: !integrityOnly,
  dataset_version: datasetVersion,
  source_dataset_version: manifest.source_dataset_version,
  revision_id: manifest.revision_id || latestRollback?.audit.rollback_revision_id || null,
  bundled_source_dataset_version: bundledSnapshot?.datasetVersion ?? null,
  dataset_as_of: current.dataset_as_of,
  cloud_env_id: cloudEnvId,
  current_sha256: sha256(currentText),
  manifest_sha256: current.manifest_sha256,
  city_count: 70,
  complete_history_package: isCompleteHistory,
  cloud_function_verified: cloudFunctionVerified,
  cloud_function_validation_receipt_sha256: cloudFunctionValidation.receipt_sha256,
  publish_audit_matched: true,
  pointer_repair_audits_matched: pointerRepairCount,
  pointer_migration_audits_matched: pointerMigrationCount,
  manual_rollback_audit_matched: Boolean(latestRollback),
  full_release_reconstructed: true,
  production_pointer_untouched: true,
  client_success_rate: null,
  client_success_rate_reason: 'no anonymous aggregate client telemetry configured',
  checked_at: new Date().toISOString(),
}
await writeFile(resolve(outputRoot, 'monitor-report.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result))
