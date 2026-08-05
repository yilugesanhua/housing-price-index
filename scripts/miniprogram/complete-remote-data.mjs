import { byteLength, sha256, stableJson } from './remote-data-lib.mjs'

export const COMPLETE_REMOTE_SCHEMA_VERSION = '2.1.0'
export const COMPLETE_REMOTE_FORMAT = 'housing-miniprogram-data'
export const COMPLETE_REMOTE_MONTHS = 180
const COMPLETE_AUDIT_VERSION = 'full-record-audit-v7'

const SERIES_CODES = ['n_a', 'n_s', 'n_m', 'n_l', 'r_a', 'r_s', 'r_m', 'r_l']

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function nextMonth(month) {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 7)
}

export function completeCoverageStart(datasetAsOf) {
  assert(/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(datasetAsOf || ''), 'complete remote dataset month is invalid')
  const date = new Date(`${datasetAsOf}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() - (COMPLETE_REMOTE_MONTHS - 1))
  return date.toISOString().slice(0, 7)
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isIsoDate(value) {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value || '')) return false
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function hasAtMostOneDecimal(value) {
  return Math.abs(value * 10 - Math.round(value * 10)) < Number.EPSILON * 100
}

function directionCounts(values) {
  return values.reduce((result, value) => {
    result[value === null ? 3 : value > 0 ? 0 : value < 0 ? 2 : 1] += 1
    return result
  }, [0, 0, 0, 0])
}

function validateAuditIdentity(auditIdentity) {
  assert(auditIdentity?.auditVersion === COMPLETE_AUDIT_VERSION, 'complete remote audit version is invalid')
  assert(typeof auditIdentity.auditMethod === 'string' && auditIdentity.auditMethod.startsWith('automated-full-record-audit-v7:'), 'complete remote audit method is invalid')
  assert(/^[a-f0-9]{40}$/.test(auditIdentity.repositoryCommitSha || ''), 'complete remote audit commit is invalid')
  for (const field of ['auditCodeSha256', 'reportSha256', 'recordsSha256', 'sourceIndexSha256']) assert(/^[a-f0-9]{64}$/.test(auditIdentity[field] || ''), `complete remote ${field} is invalid`)
  assert(Array.isArray(auditIdentity.parserVersions) && auditIdentity.parserVersions.length > 0 && new Set(auditIdentity.parserVersions).size === auditIdentity.parserVersions.length, 'complete remote parser versions are invalid')
  assert(JSON.stringify(auditIdentity.parserVersions) === JSON.stringify([...auditIdentity.parserVersions].sort()), 'complete remote parser versions are not canonical')
  return auditIdentity
}

function validateSourceBatchIds(sourceBatchIds, months) {
  const batches = [...new Set(sourceBatchIds)].sort()
  assert(batches.length === COMPLETE_REMOTE_MONTHS, 'complete remote source batch count is invalid')
  const batchMonths = batches.map((batchId) => {
    const match = batchId.match(/^official-html-(20\d{2}-(?:0[1-9]|1[0-2]))-[a-f0-9]{12}$/)
    assert(match, `complete remote source batch is invalid: ${batchId}`)
    return match[1]
  }).sort()
  assert(sameValues(batchMonths, months), 'complete remote source batches do not cover every month')
  return batches
}

function snapshotContentSha256(snapshot) {
  return sha256(stableJson(snapshot))
}

function buildDatasetVersion(snapshot, { minimumAppVersion, sourceBatchIds, auditIdentity }) {
  const identity = sha256(stableJson({
    sourceDatasetVersion: snapshot.sourceDatasetVersion,
    sourceSnapshotDatasetVersion: snapshot.datasetVersion,
    snapshotContentSha256: snapshotContentSha256(snapshot),
    coverageStart: snapshot.coverageStart,
    schemaVersion: snapshot.schemaVersion,
    remoteSchemaVersion: COMPLETE_REMOTE_SCHEMA_VERSION,
    minimumAppVersion,
    sourceBatchIds,
    auditIdentity,
  })).slice(0, 12)
  return `${snapshot.datasetAsOf}-${identity}`
}

export function validateCompleteRemoteSnapshot(snapshot) {
  assert(snapshot && typeof snapshot === 'object', 'complete remote snapshot is invalid')
  assert(/^1\.\d+\.\d+$/.test(snapshot.schemaVersion || ''), 'complete remote schema is invalid')
  assert(/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(snapshot.datasetVersion || ''), 'complete remote dataset version is invalid')
  assert(/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(snapshot.sourceDatasetVersion || ''), 'complete remote source version is invalid')
  assert(snapshot.datasetVersion.startsWith(`${snapshot.datasetAsOf}-`) && snapshot.sourceDatasetVersion.startsWith(`${snapshot.datasetAsOf}-`), 'complete remote version month is invalid')
  const expectedCoverageStart = completeCoverageStart(snapshot.datasetAsOf)
  assert(snapshot.coverageStart === expectedCoverageStart && snapshot.sourceCoverageStart === expectedCoverageStart, 'complete remote coverage start is invalid')
  assert(Array.isArray(snapshot.months) && snapshot.months.length === COMPLETE_REMOTE_MONTHS, 'complete remote month count is invalid')
  assert(snapshot.months[0] === expectedCoverageStart && snapshot.months.at(-1) === snapshot.datasetAsOf, 'complete remote month bounds are invalid')
  for (let index = 1; index < snapshot.months.length; index += 1) assert(snapshot.months[index] === nextMonth(snapshot.months[index - 1]), 'complete remote months are not continuous')
  assert(Array.isArray(snapshot.releaseDates) && snapshot.releaseDates.length === COMPLETE_REMOTE_MONTHS, 'complete remote release dates are invalid')
  assert(snapshot.releaseDates.every(isIsoDate), 'complete remote release date is invalid')
  assert(snapshot.releaseDate === snapshot.releaseDates.at(-1), 'complete remote latest release date is invalid')
  assert(Array.isArray(snapshot.cityIds) && snapshot.cityIds.length === 70 && new Set(snapshot.cityIds).size === 70, 'complete remote cities are invalid')
  assert(Array.isArray(snapshot.featuredCityIds) && snapshot.featuredCityIds.length === 6 && new Set(snapshot.featuredCityIds).size === 6 && snapshot.featuredCityIds.every((cityId) => snapshot.cityIds.includes(cityId)), 'complete remote featured cities are invalid')
  assert(snapshot.cityIds.every((cityId) => snapshot.cityMap?.[cityId] && snapshot.series?.[cityId] && snapshot.latestSeries?.[cityId]), 'complete remote city data is incomplete')
  for (const cityId of snapshot.cityIds) {
    assert(sameValues(Object.keys(snapshot.series[cityId]).sort(), [...SERIES_CODES].sort()), `complete remote series codes are invalid: ${cityId}`)
    assert(sameValues(Object.keys(snapshot.latestSeries[cityId]).sort(), [...SERIES_CODES].sort()), `complete remote latest series codes are invalid: ${cityId}`)
    for (const code of SERIES_CODES) {
      const values = snapshot.series[cityId][code]
      assert(Array.isArray(values) && values.length === COMPLETE_REMOTE_MONTHS * 4, `complete remote series length is invalid: ${cityId}/${code}`)
      assert(values.every((value) => value === null || (typeof value === 'number' && Number.isFinite(value))), `complete remote series value is invalid: ${cityId}/${code}`)
      for (let monthIndex = 0; monthIndex < COMPLETE_REMOTE_MONTHS; monthIndex += 1) {
        const offset = monthIndex * 4
        for (const [indexOffset, changeOffset, metric] of [[0, 2, 'mom'], [1, 3, 'yoy']]) {
          const index = values[offset + indexOffset]
          const change = values[offset + changeOffset]
          assert((index === null) === (change === null), `complete remote ${metric} nullability is invalid: ${cityId}/${code}/${monthIndex}`)
          if (index !== null) {
            assert(index > 0 && index <= 1000 && hasAtMostOneDecimal(index), `complete remote ${metric} index is invalid: ${cityId}/${code}/${monthIndex}`)
            assert(hasAtMostOneDecimal(change) && change === Math.round((index - 100) * 10) / 10, `complete remote ${metric} change is invalid: ${cityId}/${code}/${monthIndex}`)
          }
        }
      }
      assert(sameValues(snapshot.latestSeries[cityId][code], values.slice(-4)), `complete remote latest series differs: ${cityId}/${code}`)
    }
  }
  for (const code of SERIES_CODES) {
    for (const [metric, offset] of [['mom', 2], ['yoy', 3]]) {
      const expected = snapshot.months.flatMap((_month, monthIndex) => directionCounts(snapshot.cityIds.map((cityId) => snapshot.series[cityId][code][monthIndex * 4 + offset])))
      assert(sameValues(snapshot.breadthSeries?.[`${code}_${metric}`], expected), `complete remote breadth is invalid: ${code}/${metric}`)
    }
  }
  return snapshot
}

export function buildCompleteRemoteRelease(snapshot, { cloudEnvId, storageBucket, minimumAppVersion, nextCheckAt, sourceBatchIds = [], auditIdentity, dataRoot = 'housing-data' }) {
  validateCompleteRemoteSnapshot(snapshot)
  assert(/^cloud[\w-]+$/.test(cloudEnvId), 'complete remote cloud environment is invalid')
  assert(/^[a-z0-9-]+$/.test(storageBucket), 'complete remote storage bucket is invalid')
  assert(['housing-data', 'housing-data/preview'].includes(dataRoot), 'complete remote data root is invalid')
  assert(/^v\d+\.\d+\.\d+$/.test(minimumAppVersion || ''), 'complete remote minimum app version is invalid')
  assert(Number.isFinite(Date.parse(nextCheckAt || '')), 'complete remote next check time is invalid')
  const batches = validateSourceBatchIds(sourceBatchIds, snapshot.months)
  const audit = validateAuditIdentity(auditIdentity)
  const sourceSnapshotSha256 = snapshotContentSha256(snapshot)
  const datasetVersion = buildDatasetVersion(snapshot, { minimumAppVersion, sourceBatchIds: batches, auditIdentity: audit })
  const completeSnapshot = { ...snapshot, datasetVersion }
  const completeSnapshotText = stableJson(completeSnapshot)
  const releaseRoot = `cloud://${cloudEnvId}.${storageBucket}/${dataRoot}/releases/${datasetVersion}`
  const manifest = {
    format: COMPLETE_REMOTE_FORMAT,
    remote_schema_version: COMPLETE_REMOTE_SCHEMA_VERSION,
    schema_version: snapshot.schemaVersion,
    dataset_version: datasetVersion,
    source_dataset_version: snapshot.sourceDatasetVersion,
    dataset_as_of: snapshot.datasetAsOf,
    release_date: snapshot.releaseDate,
    generated_at: snapshot.generatedAt,
    data_status: snapshot.dataStatus,
    status_reason: snapshot.statusReason,
    latest_official_url: snapshot.latestOfficialUrl,
    next_check_at: nextCheckAt,
    complete_snapshot_file_id: `${releaseRoot}/complete-snapshot.json`,
    complete_snapshot_sha256: sha256(completeSnapshotText),
    complete_snapshot_bytes: byteLength(completeSnapshotText),
    snapshot_content_sha256: sourceSnapshotSha256,
    coverage_start: snapshot.coverageStart,
    month_count: COMPLETE_REMOTE_MONTHS,
    minimum_app_version: minimumAppVersion,
    validation_status: 'passed',
    release_type: 'monthly_update',
    source_batch_ids: batches,
    audit_version: audit.auditVersion,
    audit_method: audit.auditMethod,
    audit_repository_commit_sha: audit.repositoryCommitSha,
    audit_code_sha256: audit.auditCodeSha256,
    audit_report_sha256: audit.reportSha256,
    parser_versions: audit.parserVersions,
    source_records_sha256: audit.recordsSha256,
    source_index_sha256: audit.sourceIndexSha256,
  }
  const manifestText = stableJson(manifest)
  const current = {
    dataset_version: datasetVersion,
    source_dataset_version: snapshot.sourceDatasetVersion,
    dataset_as_of: snapshot.datasetAsOf,
    schema_version: snapshot.schemaVersion,
    manifest_file_id: `${releaseRoot}/manifest.json`,
    manifest_sha256: sha256(manifestText),
    published_at: null,
    previous_dataset_version: null,
    next_check_at: nextCheckAt,
  }
  return { completeSnapshot, completeSnapshotText, manifest, manifestText, current, currentText: stableJson(current), totalBytes: byteLength(completeSnapshotText) + byteLength(manifestText) }
}

export function verifyCompleteRemoteRelease(snapshot, release) {
  const errors = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  try { validateCompleteRemoteSnapshot(snapshot) } catch (error) { errors.push(error.message) }
  try { validateCompleteRemoteSnapshot(release.completeSnapshot) } catch (error) { errors.push(error.message) }
  check(release.manifest?.remote_schema_version === COMPLETE_REMOTE_SCHEMA_VERSION, 'complete manifest schema is invalid')
  check(release.manifest?.coverage_start === completeCoverageStart(snapshot.datasetAsOf) && release.manifest?.month_count === COMPLETE_REMOTE_MONTHS, 'complete manifest coverage is invalid')
  check(release.manifest?.complete_snapshot_sha256 === sha256(release.completeSnapshotText), 'complete snapshot SHA-256 mismatch')
  check(release.manifest?.complete_snapshot_bytes === byteLength(release.completeSnapshotText), 'complete snapshot byte size mismatch')
  check(release.manifest?.snapshot_content_sha256 === snapshotContentSha256(snapshot), 'complete source snapshot identity mismatch')
  check(release.current?.manifest_sha256 === sha256(release.manifestText), 'complete manifest SHA-256 mismatch')
  check(release.completeSnapshot?.datasetVersion === release.manifest?.dataset_version, 'complete snapshot dataset version mismatch')
  check(release.completeSnapshot?.sourceDatasetVersion === release.manifest?.source_dataset_version, 'complete snapshot source version mismatch')
  check(release.completeSnapshot?.datasetAsOf === release.manifest?.dataset_as_of, 'complete snapshot month mismatch')
  try {
    const auditIdentity = validateAuditIdentity({
      auditVersion: release.manifest?.audit_version,
      auditMethod: release.manifest?.audit_method,
      repositoryCommitSha: release.manifest?.audit_repository_commit_sha,
      auditCodeSha256: release.manifest?.audit_code_sha256,
      reportSha256: release.manifest?.audit_report_sha256,
      parserVersions: release.manifest?.parser_versions,
      recordsSha256: release.manifest?.source_records_sha256,
      sourceIndexSha256: release.manifest?.source_index_sha256,
    })
    const sourceBatchIds = validateSourceBatchIds(release.manifest?.source_batch_ids || [], snapshot.months)
    const expectedDatasetVersion = buildDatasetVersion(snapshot, { minimumAppVersion: release.manifest?.minimum_app_version, sourceBatchIds, auditIdentity })
    check(release.manifest?.dataset_version === expectedDatasetVersion, 'complete dataset identity mismatch')
  } catch (error) {
    errors.push(error.message)
  }
  const comparable = structuredClone(snapshot)
  comparable.datasetVersion = release.completeSnapshot?.datasetVersion
  check(sameValues(release.completeSnapshot, comparable), 'complete snapshot differs from its generated source')
  return errors
}
