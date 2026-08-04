import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createTencentCloudClient, isMissingObjectError } from './tencent-cloud-sdk.mjs'
import { sha256, stableJson } from './remote-data-lib.mjs'
import { authorizeCiRelease } from './ci-release-authorization.mjs'
import { activatePointerWithRollback } from './guarded-activation.mjs'
import { buildAutomaticRollbackPointer, validateManifestFunctionOutput } from './post-publish-guard.mjs'
import { assertProductionPointerBaseline } from './publish-remote-data-guards.mjs'
import { readRollbackEligibleAudit, rollbackVersionOrNull } from './release-audit-lib.mjs'
import { COMPLETE_REMOTE_MONTHS, COMPLETE_REMOTE_SCHEMA_VERSION, COMPLETE_REMOTE_START, validateCompleteRemoteSnapshot } from './complete-remote-data.mjs'
import { appendFailedReleaseRevocations, assertRollbackClosure, assertTargetNotRevoked, buildControlValidUntil, buildRollbackRevisionId, buildRevocationRegistryArtifact, createRevocationRegistry, validateControlPointer, validateRevocationRegistry } from './control-plane.mjs'

const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const datasetVersion = argument('dataset')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const dryRun = process.argv.includes('--dry-run')
const assert = (condition, message) => { if (!condition) throw new Error(`Complete history publisher rejected: ${message}`) }
assert(/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || ''), 'use --dataset=<YYYY-MM-hash>')
const localRoot = resolve(root, 'work/miniprogram-complete-data', datasetVersion)
const report = JSON.parse(await readFile(resolve(localRoot, 'release-report.json'), 'utf8'))
const manifestText = await readFile(resolve(localRoot, 'manifest.json'), 'utf8')
const snapshotText = await readFile(resolve(localRoot, 'complete-snapshot.json'), 'utf8')
const manifest = JSON.parse(manifestText)
const snapshot = JSON.parse(snapshotText)
assert(report.status === 'staged_not_uploaded' && report.dataset_version === datasetVersion, 'staged report does not match candidate')
assert(manifest.remote_schema_version === COMPLETE_REMOTE_SCHEMA_VERSION && manifest.coverage_start === COMPLETE_REMOTE_START && manifest.month_count === COMPLETE_REMOTE_MONTHS, 'candidate is not the required 180-month complete format')
assert(report.manifest_sha256 === sha256(manifestText) && manifest.complete_snapshot_sha256 === sha256(snapshotText), 'candidate hash gate failed')
validateCompleteRemoteSnapshot(snapshot)
const ciMode = process.env.GITHUB_ACTIONS === 'true'
if (!dryRun && !ciMode) throw new Error('Production publication is allowed only in an authorized GitHub Actions workflow; use --dry-run locally')
const ciGate = dryRun ? null : await authorizeCiRelease({ root, datasetVersion, cloudEnvId })
if (ciGate) assert(ciGate.complete_snapshot_sha256 === sha256(snapshotText), 'attested complete snapshot hash differs from candidate')
const cloudRoot = `housing-data/releases/${datasetVersion}`
if (dryRun) {
  console.log(JSON.stringify({ dry_run: true, dataset_version: datasetVersion, cloud_env_id: cloudEnvId, sdk_operations: [['putObject', `${cloudRoot}/complete-snapshot.json`], ['putObject', `${cloudRoot}/manifest.json`], ['putObject', 'housing-data/current.json', 'after complete-package round-trip verification']] }, null, 2))
  process.exit(0)
}
const cloud = createTencentCloudClient({ cloudEnvId })
const readObjectText = async (key) => (await cloud.getObject(key)).toString('utf8')
const localCurrentCandidate = JSON.parse(await readFile(resolve(localRoot, 'current.candidate.json'), 'utf8'))
let previous = null
let previousText = null
try { previousText = await readObjectText('housing-data/current.json'); previous = JSON.parse(previousText) } catch (error) { if (!isMissingObjectError(error)) throw error }
const previousState = assertProductionPointerBaseline(previous)
let previousManifest = null
if (previous) {
  const text = await readObjectText(`housing-data/releases/${previous.dataset_version}/manifest.json`)
  assert(sha256(text) === previous.manifest_sha256, 'active manifest hash differs from current pointer')
  previousManifest = JSON.parse(text)
}
async function loadRegistry() {
  if (previousState === 'absent') return createRevocationRegistry({ generatedAt: new Date().toISOString() })
  const key = `housing-data/control/revocations-${previous.revocations_sha256}.json`
  const text = await readObjectText(key)
  assert(sha256(text) === previous.revocations_sha256, 'active revocation registry hash differs')
  return validateRevocationRegistry(JSON.parse(text))
}
let registry = await loadRegistry()
let previousDatasetVersion = await rollbackVersionOrNull(root, previous?.dataset_version, cloudEnvId)
let previousAudit = previousDatasetVersion ? await readRollbackEligibleAudit(root, previousDatasetVersion, cloudEnvId) : null
if (previous?.transition_type === 'rollback' && previous.rollback_from_dataset_version === datasetVersion) {
  assertRollbackClosure(registry, { failedDatasetVersion: datasetVersion, failedSourceDatasetVersion: manifest.source_dataset_version, targetDatasetVersion: previous.dataset_version, targetSourceDatasetVersion: previous.source_dataset_version, revisionId: buildRollbackRevisionId(datasetVersion) })
  throw new Error('candidate is already revoked by the active rollback')
}
assertTargetNotRevoked(registry, { datasetVersion, sourceDatasetVersion: manifest.source_dataset_version })
async function uploadImmutable(key, text) {
  if (await cloud.objectExists(key)) { assert(await readObjectText(key) === text, `immutable remote object differs: ${key}`); return }
  const path = resolve(localRoot, `.upload-${key.endsWith('manifest.json') ? 'manifest' : 'snapshot'}.json`)
  await writeFile(path, text, 'utf8'); await cloud.uploadFile(path, key)
  assert(await readObjectText(key) === text, `remote round-trip mismatch: ${key}`)
}
await uploadImmutable(`${cloudRoot}/complete-snapshot.json`, snapshotText)
await uploadImmutable(`${cloudRoot}/manifest.json`, manifestText)
async function verifyRemoteComplete() {
  const remoteManifestText = await readObjectText(`${cloudRoot}/manifest.json`)
  const remoteSnapshotText = await readObjectText(`${cloudRoot}/complete-snapshot.json`)
  assert(remoteManifestText === manifestText && remoteSnapshotText === snapshotText, 'remote immutable package differs from candidate')
  validateCompleteRemoteSnapshot(JSON.parse(remoteSnapshotText))
  assert(JSON.parse(remoteManifestText).complete_snapshot_sha256 === sha256(remoteSnapshotText), 'remote complete snapshot hash mismatch')
}
await verifyRemoteComplete()
const auditDir = resolve(root, 'data/releases'); await mkdir(auditDir, { recursive: true })
async function writeAudit(audit) { await writeFile(resolve(auditDir, `${datasetVersion}.json`), `${JSON.stringify(audit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }).catch(async (error) => { if (error.code !== 'EEXIST') throw error; const existing = JSON.parse(await readFile(resolve(auditDir, `${datasetVersion}.json`), 'utf8')); assert(existing.manifest_sha256 === audit.manifest_sha256 && existing.status === 'published', 'existing publication audit differs') }) }
if (previous?.dataset_version === datasetVersion) {
  assert(previous.manifest_sha256 === sha256(manifestText), 'active dataset version points to different content')
  validateManifestFunctionOutput(JSON.stringify(await cloud.invokeFunction('getHousingDataManifest')), previous)
  await verifyRemoteComplete(); await writeAudit({ ...report, status: 'published', published_at: previous.published_at, previous_dataset_version: previous.previous_dataset_version, current_sha256: sha256(previousText), github_run_id: process.env.GITHUB_RUN_ID, github_run_attempt: process.env.GITHUB_RUN_ATTEMPT, commit_sha: process.env.CI_COMMIT_SHA, release_authorization: ciGate.release_authorization, release_type: 'complete_history' })
  console.log(`Complete history dataset ${datasetVersion} is already active and verified`); process.exit(0)
}
const publishedAt = new Date().toISOString()
const registryArtifact = previousState === 'controlled' ? { currentFields: { revocations_file_id: previous.revocations_file_id, revocations_sha256: previous.revocations_sha256, revocations_generation: previous.revocations_generation } } : buildRevocationRegistryArtifact(registry, { cloudEnvId, storageBucket: cloud.bucket })
if (previousState === 'absent') { await cloud.putObject(registryArtifact.cosKey, Buffer.from(registryArtifact.text, 'utf8')); assert(await readObjectText(registryArtifact.cosKey) === registryArtifact.text, 'new revocation registry round-trip failed') }
const current = { ...localCurrentCandidate, published_at: publishedAt, previous_dataset_version: previousDatasetVersion || null, source_dataset_version: manifest.source_dataset_version, control_schema_version: '1.0.0', control_generation: Number(previous?.control_generation || 0) + 1, ...registryArtifact.currentFields, transition_type: 'publish', data_status: 'current', status_reason: 'complete_history_publish', control_generated_at: publishedAt, control_valid_until: buildControlValidUntil(publishedAt) }
validateControlPointer(current, { allowLegacy: false, requireContext: true, manifest, registry, previousPointer: previous || undefined, cloudEnvId, storageBucket: cloud.bucket })
const currentText = stableJson(current)
const readCurrent = async () => { try { return await readObjectText('housing-data/current.json') } catch (error) { if (isMissingObjectError(error)) return null; throw error } }
await activatePointerWithRollback({
  candidate: current, candidateText: currentText, previous, rollbackEligible: Boolean(previous && previousDatasetVersion && previousAudit),
  writePointer: async (text, label) => { const expected = label === 'candidate' ? previousText : currentText; assert(await readCurrent() === expected, `current pointer changed before ${label}`); const path = resolve(localRoot, `current.${label}.json`); await writeFile(path, text, 'utf8'); await cloud.uploadFile(path, 'housing-data/current.json') },
  readPointerText: async () => await readCurrent(),
  guardCandidate: async () => { validateManifestFunctionOutput(JSON.stringify(await cloud.invokeFunction('getHousingDataManifest')), current); await verifyRemoteComplete() },
  guardRollback: async (pointer) => validateManifestFunctionOutput(JSON.stringify(await cloud.invokeFunction('getHousingDataManifest')), pointer),
  prepareRollback: async ({ failedAt, guardError }) => { const rollbackRegistry = appendFailedReleaseRevocations(registry, { datasetVersion, sourceDatasetVersion: manifest.source_dataset_version, revokedAt: failedAt, replacementDatasetVersion: previous.dataset_version, replacementSourceDatasetVersion: previousManifest.source_dataset_version, revisionId: buildRollbackRevisionId(datasetVersion), reason: String(guardError?.message || guardError).slice(0, 400) }); const artifact = buildRevocationRegistryArtifact(rollbackRegistry, { cloudEnvId, storageBucket: cloud.bucket }); await cloud.putObject(artifact.cosKey, Buffer.from(artifact.text, 'utf8')); assert(await readObjectText(artifact.cosKey) === artifact.text, 'rollback revocation registry round-trip failed'); return buildAutomaticRollbackPointer(previous, datasetVersion, { rolledBackAt: failedAt, controlGeneration: current.control_generation + 1, registryArtifact: artifact, failedSourceDatasetVersion: manifest.source_dataset_version, rollbackRevisionId: buildRollbackRevisionId(datasetVersion), targetSourceDatasetVersion: previousManifest.source_dataset_version, targetManifest: previousManifest }) },
  recordRollback: async ({ failedAt, rollbackPointer, rollbackText, guardError }) => writeFile(resolve(auditDir, `rollback-${failedAt.replace(/[:.]/g, '-')}.json`), `${JSON.stringify({ status: 'automatically_rolled_back', rolled_back_at: failedAt, from_dataset_version: datasetVersion, to_dataset_version: rollbackPointer.dataset_version, cloud_env_id: cloudEnvId, trigger_error: String(guardError?.message || guardError), current_sha256: sha256(rollbackText), github_run_id: process.env.GITHUB_RUN_ID, github_run_attempt: process.env.GITHUB_RUN_ATTEMPT, commit_sha: process.env.CI_COMMIT_SHA }, null, 2)}\n`, { flag: 'wx' }),
  recordFailure: async ({ failedAt, guardError, rollbackStatus, rollbackError }) => writeFile(resolve(auditDir, `failed-publish-${failedAt.replace(/[:.]/g, '-')}.json`), `${JSON.stringify({ status: 'post_publish_guard_failed', failed_at: failedAt, dataset_version: datasetVersion, previous_dataset_version: previousDatasetVersion, cloud_env_id: cloudEnvId, guard_error: String(guardError?.message || guardError), rollback_status: rollbackStatus, rollback_error: rollbackError ? String(rollbackError) : null, github_run_id: process.env.GITHUB_RUN_ID, github_run_attempt: process.env.GITHUB_RUN_ATTEMPT, commit_sha: process.env.CI_COMMIT_SHA }, null, 2)}\n`, { flag: 'wx' }),
})
await writeAudit({ ...report, status: 'published', published_at: publishedAt, previous_dataset_version: current.previous_dataset_version, current_sha256: sha256(currentText), github_run_id: process.env.GITHUB_RUN_ID, github_run_attempt: process.env.GITHUB_RUN_ATTEMPT, commit_sha: process.env.CI_COMMIT_SHA, release_authorization: ciGate.release_authorization, release_type: 'complete_history' })
console.log(`Published complete 15-year dataset ${datasetVersion}; remote package and current pointer passed round-trip verification`)
