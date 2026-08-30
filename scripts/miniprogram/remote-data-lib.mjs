import { createHash } from 'node:crypto'
import { validatePublicationIdentity } from './publication-identity.mjs'

export const REMOTE_FORMAT = 'housing-miniprogram-data'
export const REMOTE_SCHEMA_VERSION = '1.0.0'
export const SERIES_CODES = ['n_a', 'n_s', 'n_m', 'n_l', 'r_a', 'r_s', 'r_m', 'r_l']
export const RELEASE_TYPES = Object.freeze({ monthly: 'monthly_update', correction: 'historical_correction' })
export const CORRECTION_REASON_TYPES = Object.freeze(['official_revision', 'parser_error', 'transform_error', 'mapping_error'])
export const CORRECTION_FORMAT = 'housing-historical-correction'
export const CORRECTION_SCHEMA_VERSION = '1.0.0'
const COMPLETE_BOOTSTRAP_MINIMUM_APP_VERSION = [2, 3, 0]
const LEGACY_CONTROL_MIGRATION_ID = 'legacy-control-2026-06-e9788d0bddf3'
const OFFICIAL_SOURCE_BATCH_ID_PATTERN = /^official-html-20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
export const SIZE_LIMITS = Object.freeze({
  current: 8 * 1024,
  manifest: 16 * 1024,
  bootstrap: 2 * 1024 * 1024,
  city: 40 * 1024,
  revisionManifest: 512 * 1024,
  release: 4 * 1024 * 1024,
})

export function stableJson(value) {
  return `${JSON.stringify(value)}\n`
}

function requiresCompleteBootstrap(version) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version || '')
  if (!match) return true
  const parts = match.slice(1).map(Number)
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== COMPLETE_BOOTSTRAP_MINIMUM_APP_VERSION[index]) {
      return parts[index] > COMPLETE_BOOTSTRAP_MINIMUM_APP_VERSION[index]
    }
  }
  return true
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function byteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

export function clientNextCheckAt(calendar, datasetAsOf, delayMinutes = 10) {
  assert(Number.isInteger(delayMinutes) && delayMinutes >= 5 && delayMinutes <= 15, 'client check delay must be 5 to 15 minutes')
  const entry = calendar?.entries?.find((item) => item.expected_stat_month > datasetAsOf)
  assert(entry && Number.isFinite(Date.parse(entry.scheduled_at)), `release calendar has no next entry after ${datasetAsOf}`)
  return new Date(Date.parse(entry.scheduled_at) + delayMinutes * 60 * 1000).toISOString()
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function countDirections(values) {
  return values.reduce((result, value) => {
    if (value === null || value === undefined) result[3] += 1
    else if (value > 0) result[0] += 1
    else if (value < 0) result[2] += 1
    else result[1] += 1
    return result
  }, [0, 0, 0, 0])
}

function nextMonth(value) {
  const date = new Date(`${value}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 7)
}

export function validateBundledSnapshot(snapshot) {
  assert(snapshot && typeof snapshot === 'object', 'snapshot must be an object')
  assert(Array.isArray(snapshot.cityIds) && snapshot.cityIds.length === 70, 'snapshot must contain 70 cities')
  assert(new Set(snapshot.cityIds).size === 70, 'snapshot city IDs must be unique')
  assert(Array.isArray(snapshot.featuredCityIds) && snapshot.featuredCityIds.length === 6, 'snapshot must contain six featured cities')
  assert(Array.isArray(snapshot.months) && snapshot.months.length === 120, 'snapshot must contain 120 months')
  assert(snapshot.months.every((month) => /^20\d{2}-(0[1-9]|1[0-2])$/.test(month)), 'snapshot months must use YYYY-MM')
  for (let index = 1; index < snapshot.months.length; index += 1) {
    assert(snapshot.months[index] === nextMonth(snapshot.months[index - 1]), 'snapshot months must be continuous')
  }
  assert(snapshot.months.at(-1) === snapshot.datasetAsOf, 'snapshot latest month must match datasetAsOf')
  assert(snapshot.coverageStart === snapshot.months[0], 'snapshot coverageStart must match the first client-window month')
  if (snapshot.sourceCoverageStart !== undefined) {
    assert(/^20\d{2}-(0[1-9]|1[0-2])$/.test(snapshot.sourceCoverageStart), 'snapshot sourceCoverageStart is invalid')
    assert(snapshot.sourceCoverageStart <= snapshot.months.at(-1), 'snapshot source coverage cannot start after the client window')
    const sourceCoverageIndex = Math.max(0, snapshot.months.indexOf(snapshot.sourceCoverageStart))
    for (const cityId of snapshot.cityIds) {
      for (const [code, values] of Object.entries(snapshot.series?.[cityId] || {})) {
        assert(values.slice(0, sourceCoverageIndex * 4).every((value) => value === null), `snapshot pre-source padding must be null: ${cityId}/${code}`)
      }
    }
  }
  assert(Array.isArray(snapshot.releaseDates) && snapshot.releaseDates.length === snapshot.months.length, 'release dates must align with months')
  for (const cityId of snapshot.cityIds) {
    assert(snapshot.cityMap?.[cityId], `missing city profile: ${cityId}`)
    assert(snapshot.series?.[cityId], `missing city series: ${cityId}`)
    assert(Object.keys(snapshot.series[cityId]).sort().join(',') === [...SERIES_CODES].sort().join(','), `unexpected series codes: ${cityId}`)
    for (const code of SERIES_CODES) {
      const values = snapshot.series[cityId][code]
      assert(Array.isArray(values) && values.length === snapshot.months.length * 4, `${cityId}/${code} must contain ${snapshot.months.length * 4} values`)
    }
  }
}

export function buildBootstrap(snapshot) {
  validateBundledSnapshot(snapshot)
  const series = Object.fromEntries(snapshot.cityIds.map((cityId) => [cityId, clone(snapshot.series[cityId])]))
  const latestSeries = Object.fromEntries(snapshot.cityIds.map((cityId) => [cityId, Object.fromEntries(SERIES_CODES.map((code) => [code, snapshot.series[cityId][code].slice(-4)]))]))
  const breadthSeries = {}
  for (const code of SERIES_CODES) {
    for (const [metric, offset] of [['mom', 2], ['yoy', 3]]) {
      const values = []
      for (let monthIndex = 0; monthIndex < snapshot.months.length; monthIndex += 1) {
        values.push(...countDirections(snapshot.cityIds.map((cityId) => snapshot.series[cityId][code][monthIndex * 4 + offset])))
      }
      breadthSeries[`${code}_${metric}`] = values
    }
  }
  return {
    remoteFormat: REMOTE_FORMAT,
    remoteSchemaVersion: REMOTE_SCHEMA_VERSION,
    schemaVersion: snapshot.schemaVersion,
    datasetVersion: snapshot.datasetVersion,
    sourceDatasetVersion: snapshot.sourceDatasetVersion,
    datasetAsOf: snapshot.datasetAsOf,
    releaseDate: snapshot.releaseDate,
    coverageStart: snapshot.coverageStart,
    sourceCoverageStart: snapshot.sourceCoverageStart,
    latestOfficialUrl: snapshot.latestOfficialUrl,
    generatedAt: snapshot.generatedAt,
    dataStatus: snapshot.dataStatus,
    statusReason: snapshot.statusReason,
    nextCheckDueAt: snapshot.nextCheckDueAt,
    months: clone(snapshot.months),
    releaseDates: clone(snapshot.releaseDates),
    cityIds: clone(snapshot.cityIds),
    featuredCityIds: clone(snapshot.featuredCityIds),
    cityMap: clone(snapshot.cityMap),
    series,
    latestSeries,
    breadthSeries,
  }
}

export function buildCityShard(snapshot, cityId) {
  assert(snapshot.cityIds.includes(cityId), `unknown city: ${cityId}`)
  return {
    remoteFormat: REMOTE_FORMAT,
    remoteSchemaVersion: REMOTE_SCHEMA_VERSION,
    datasetVersion: snapshot.datasetVersion,
    cityId,
    series: clone(snapshot.series[cityId]),
  }
}

export function buildRemoteRelease(snapshot, {
  cloudEnvId,
  storageBucket,
  minimumAppVersion,
  nextCheckAt,
  sourceBatchIds = [],
  latestSourceBatchIds = sourceBatchIds,
  publicationIdentity,
  correction = null,
}) {
  validateBundledSnapshot(snapshot)
  assert(/^cloud[\w-]+$/.test(cloudEnvId), 'invalid cloud environment ID')
  assert(/^[a-z0-9-]+$/.test(storageBucket), 'invalid cloud storage bucket')
  assert(/^v\d+\.\d+\.\d+$/.test(minimumAppVersion), 'invalid minimum app version')
  assert(Number.isFinite(Date.parse(nextCheckAt || '')), 'invalid client next check time')
  validatePublicationIdentity(publicationIdentity)
  if (correction) validateCorrectionDescriptor(correction, snapshot)
  const batches = [...new Set(latestSourceBatchIds)].sort()
  assert(batches.length > 0 && batches.every((value) => OFFICIAL_SOURCE_BATCH_ID_PATTERN.test(value)), 'invalid latest source batch IDs')
  assert(JSON.stringify(batches) === JSON.stringify(latestSourceBatchIds), 'latest source batch IDs must be sorted and unique')
  if (correction) assert(JSON.stringify(batches) === JSON.stringify(correction.latest_source_batch_ids), 'correction latest source batches differ from release')
  const releaseHash = sha256(stableJson({
    sourceDatasetVersion: snapshot.sourceDatasetVersion,
    cloudEnvId,
    storageBucket,
    remoteFormat: REMOTE_FORMAT,
    remoteSchemaVersion: REMOTE_SCHEMA_VERSION,
    minimumAppVersion,
    nextCheckAt,
    latestSourceBatchIds: batches,
    publicationIdentity,
    correction: correction ? {
      revisionId: correction.revision_id,
      releaseType: correction.release_type,
      reasonType: correction.reason_type,
      supersedesSourceDatasetVersion: correction.supersedes_source_dataset_version,
      sourceVersionChain: correction.source_version_chain,
      revokedSourceDatasetVersions: correction.revoked_source_dataset_versions,
      latestSourceBatchIds: correction.latest_source_batch_ids,
      revisionSourceBatchIds: correction.revision_source_batch_ids,
      changes: correction.changes,
      candidateRecordsSha256: correction.candidate_records_sha256,
      auditRecordsSha256: correction.audit_records_sha256,
      sourceIndexSha256: correction.source_index_sha256,
      auditReportSha256: correction.audit_report_sha256,
      auditCommitSha: correction.audit_commit_sha,
      auditCodeSha256: correction.audit_code_sha256,
      ledgerBeforeSha256: correction.ledger_before_sha256,
      ledgerAfterSha256: correction.ledger_after_sha256,
      ledgerAppendStart: correction.ledger_append_start,
      ledgerAppendCount: correction.ledger_append_count,
      ledgerAppendSha256: correction.ledger_append_sha256,
      commitSha: correction.commit_sha,
      githubRunId: correction.github_run_id,
      approvedAt: correction.approved_at,
      approvedBy: correction.approved_by,
    } : null,
  })).slice(0, 12)
  const datasetVersion = `${snapshot.datasetAsOf}-${releaseHash}`
  const releaseSnapshot = { ...snapshot, datasetVersion }
  const releaseRoot = `cloud://${cloudEnvId}.${storageBucket}/housing-data/releases/${datasetVersion}`
  const bootstrap = buildBootstrap(releaseSnapshot)
  const bootstrapText = stableJson(bootstrap)
  const cities = Object.fromEntries(snapshot.cityIds.map((cityId) => {
    const data = buildCityShard(releaseSnapshot, cityId)
    const text = stableJson(data)
    return [cityId, { data, text, sha256: sha256(text), bytes: byteLength(text), fileId: `${releaseRoot}/cities/${cityId}.json` }]
  }))
  const cityFiles = Object.fromEntries(snapshot.cityIds.map((cityId) => [cityId, {
    sha256: cities[cityId].sha256,
    bytes: cities[cityId].bytes,
  }]))
  const revisionManifest = correction ? {
    format: CORRECTION_FORMAT,
    schema_version: CORRECTION_SCHEMA_VERSION,
    revision_id: correction.revision_id,
    release_type: correction.release_type,
    reason_type: correction.reason_type,
    approval_status: correction.approval_status,
    dataset_as_of: snapshot.datasetAsOf,
    supersedes_source_dataset_version: correction.supersedes_source_dataset_version,
    source_dataset_version: snapshot.sourceDatasetVersion,
    source_version_chain: clone(correction.source_version_chain),
    revoked_source_dataset_versions: clone(correction.revoked_source_dataset_versions),
    reason: correction.reason,
    official_urls: clone(correction.official_urls),
    latest_source_batch_ids: clone(correction.latest_source_batch_ids),
    revision_source_batch_ids: clone(correction.revision_source_batch_ids),
    parser_version: correction.parser_version,
    audit_version: correction.audit_version,
    candidate_records_sha256: correction.candidate_records_sha256,
    audit_records_sha256: correction.audit_records_sha256,
    source_index_sha256: correction.source_index_sha256,
    audit_report_sha256: correction.audit_report_sha256,
    audit_commit_sha: correction.audit_commit_sha,
    audit_code_sha256: correction.audit_code_sha256,
    ledger_before_sha256: correction.ledger_before_sha256,
    ledger_after_sha256: correction.ledger_after_sha256,
    ledger_append_start: correction.ledger_append_start,
    ledger_append_count: correction.ledger_append_count,
    ledger_append_sha256: correction.ledger_append_sha256,
    commit_sha: correction.commit_sha,
    github_run_id: correction.github_run_id,
    approved_at: correction.approved_at,
    approved_by: correction.approved_by,
    changes: clone(correction.changes),
    changed_record_count: new Set(correction.changes.map((item) => item.record_key)).size,
    changed_field_count: correction.changes.length,
  } : null
  const revisionManifestText = revisionManifest ? stableJson(revisionManifest) : null
  const manifest = {
    format: REMOTE_FORMAT,
    remote_schema_version: REMOTE_SCHEMA_VERSION,
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
    bootstrap_file_id: `${releaseRoot}/bootstrap.json`,
    bootstrap_sha256: sha256(bootstrapText),
    bootstrap_bytes: byteLength(bootstrapText),
    city_file_id_template: `${releaseRoot}/cities/{city_id}.json`,
    city_files: cityFiles,
    supported_client_data_major: 1,
    minimum_app_version: minimumAppVersion,
    validation_status: 'passed',
    latest_source_batch_ids: batches,
    candidate_records_sha256: publicationIdentity.candidate_records_sha256,
    audit_records_sha256: publicationIdentity.audit_records_sha256,
    source_index_sha256: publicationIdentity.source_index_sha256,
    audit_report_sha256: publicationIdentity.audit_report_sha256,
    audit_commit_sha: publicationIdentity.audit_commit_sha,
    audit_code_sha256: publicationIdentity.audit_code_sha256,
    audit_version: publicationIdentity.audit_version,
    parser_versions: clone(publicationIdentity.parser_versions),
    release_type: correction ? RELEASE_TYPES.correction : RELEASE_TYPES.monthly,
    release_note: `更新国家统计局70城住宅价格指数至${snapshot.datasetAsOf}`,
  }
  if (revisionManifest) Object.assign(manifest, {
    revision_id: revisionManifest.revision_id,
    supersedes_source_dataset_version: revisionManifest.supersedes_source_dataset_version,
    revision_source_batch_ids: clone(revisionManifest.revision_source_batch_ids),
    revision_manifest_file_id: `${releaseRoot}/revision-manifest.json`,
    revision_manifest_sha256: sha256(revisionManifestText),
    revision_manifest_bytes: byteLength(revisionManifestText),
    changed_record_count: revisionManifest.changed_record_count,
    ledger_before_sha256: revisionManifest.ledger_before_sha256,
    ledger_after_sha256: revisionManifest.ledger_after_sha256,
    ledger_append_start: revisionManifest.ledger_append_start,
    ledger_append_count: revisionManifest.ledger_append_count,
    ledger_append_sha256: revisionManifest.ledger_append_sha256,
  })
  else manifest.source_batch_ids = batches
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
  const currentText = stableJson(current)
  const totalBytes = byteLength(bootstrapText) + byteLength(manifestText) + (revisionManifestText ? byteLength(revisionManifestText) : 0) + Object.values(cities).reduce((sum, item) => sum + item.bytes, 0)
  return { bootstrap, bootstrapText, cities, manifest, manifestText, revisionManifest, revisionManifestText, current, currentText, totalBytes }
}

function assertCanonicalBatchIds(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} are missing`)
  assert(values.every((value) => OFFICIAL_SOURCE_BATCH_ID_PATTERN.test(value)), `${label} are invalid`)
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify([...values].sort()), `${label} must be sorted and unique`)
}

export function validateCorrectionRequest(correction, snapshot = null) {
  assert(correction && typeof correction === 'object', 'correction descriptor is required')
  assert(/^revision-[a-z0-9][a-z0-9-]{5,80}$/.test(correction.revision_id || ''), 'invalid correction revision ID')
  assert(correction.release_type === RELEASE_TYPES.correction, 'invalid correction release type')
  assert(CORRECTION_REASON_TYPES.includes(correction.reason_type), 'invalid correction reason type')
  assert(correction.revision_type === undefined, 'legacy revision_type is forbidden')
  assert(correction.approval_status === 'approved', 'correction is not approved')
  const sourcePattern = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
  assert(sourcePattern.test(correction.supersedes_source_dataset_version || ''), 'invalid superseded source dataset version')
  assert(sourcePattern.test(correction.source_dataset_version || ''), 'invalid correction source dataset version')
  if (snapshot) {
    assert(correction.dataset_as_of === snapshot.datasetAsOf, 'correction month differs from snapshot')
    assert(correction.source_dataset_version === snapshot.sourceDatasetVersion, 'correction source differs from snapshot')
  }
  assert(Array.isArray(correction.source_version_chain) && correction.source_version_chain.length >= 2, 'correction source chain is invalid')
  assert(correction.source_version_chain.at(-2) === correction.supersedes_source_dataset_version, 'correction source chain does not directly supersede the prior source')
  assert(correction.source_version_chain.at(-1) === correction.source_dataset_version, 'correction source chain does not end at new source')
  assert(new Set(correction.source_version_chain).size === correction.source_version_chain.length, 'correction source chain contains duplicates')
  assert(Array.isArray(correction.revoked_source_dataset_versions) && correction.revoked_source_dataset_versions.includes(correction.supersedes_source_dataset_version), 'superseded source is not revoked')
  assert(correction.revoked_source_dataset_versions.every((value) => correction.source_version_chain.includes(value) && value !== correction.source_dataset_version), 'correction revocation list is invalid')
  assert(typeof correction.reason === 'string' && correction.reason.trim().length >= 10, 'correction reason is too short')
  assert(Array.isArray(correction.official_urls) && correction.official_urls.length > 0 && correction.official_urls.every((url) => /^https:\/\/(?:www\.)?stats\.gov\.cn\//.test(url)), 'correction official URLs are invalid')
  assertCanonicalBatchIds(correction.latest_source_batch_ids, 'correction latest source batches')
  assertCanonicalBatchIds(correction.revision_source_batch_ids, 'correction revision source batches')
  assert(typeof correction.parser_version === 'string' && correction.parser_version.length > 0, 'correction parser version is missing')
  assert(typeof correction.audit_version === 'string' && correction.audit_version.length > 0, 'correction audit version is missing')
  assert(Number.isFinite(Date.parse(correction.approved_at || '')) && typeof correction.approved_by === 'string' && correction.approved_by.trim(), 'correction approval metadata is invalid')
  assert(Array.isArray(correction.changes) && correction.changes.length > 0, 'correction changes are missing')
  const keys = correction.changes.map((item) => `${item.record_key}|${item.field}`)
  assert(new Set(keys).size === keys.length, 'correction contains duplicate changed fields')
  for (const item of correction.changes) {
    assert(/^20\d{2}-(0[1-9]|1[0-2])\|[a-z]+\|(new|resale)\|(all|le90|90_144|gt144)$/.test(item.record_key || ''), `invalid correction record key: ${item.record_key}`)
    assert(typeof item.field === 'string' && item.field.length > 0, `invalid correction field: ${item.record_key}`)
    assert(/^https:\/\/(?:www\.)?stats\.gov\.cn\//.test(item.source_url || ''), `invalid correction source URL: ${item.record_key}`)
    assert(typeof item.source_record_locator === 'string' && item.source_record_locator.length > 0, `missing correction source locator: ${item.record_key}`)
  }
  return correction
}

export function validateCorrectionDescriptor(correction, snapshot = null) {
  validateCorrectionRequest(correction, snapshot)
  for (const field of [
    'candidate_records_sha256', 'audit_records_sha256', 'source_index_sha256',
    'audit_report_sha256', 'audit_code_sha256', 'ledger_before_sha256',
    'ledger_after_sha256', 'ledger_append_sha256',
  ]) assert(/^[a-f0-9]{64}$/.test(correction[field] || ''), `invalid correction ${field}`)
  assert(/^[a-f0-9]{40}$/.test(correction.audit_commit_sha || ''), 'invalid correction audit commit SHA')
  assert(/^[a-f0-9]{40}$/.test(correction.commit_sha || ''), 'invalid correction commit SHA')
  assert(/^\d+$/.test(String(correction.github_run_id || '')), 'invalid correction GitHub run ID')
  assert(Number.isInteger(correction.ledger_append_start) && correction.ledger_append_start >= 0, 'invalid correction ledger append start')
  assert(Number.isInteger(correction.ledger_append_count) && correction.ledger_append_count > 0, 'invalid correction ledger append count')
  return correction
}

export function verifyRevisionManifest(manifest, revisionManifest) {
  const errors = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  if ((manifest?.release_type || RELEASE_TYPES.monthly) !== RELEASE_TYPES.correction) {
    check(!revisionManifest, 'monthly release must not contain a revision manifest')
    return errors
  }
  try { validateCorrectionDescriptor(revisionManifest) } catch (error) { errors.push(error.message) }
  check(revisionManifest?.format === CORRECTION_FORMAT, 'revision manifest format mismatch')
  check(revisionManifest?.schema_version === CORRECTION_SCHEMA_VERSION, 'revision manifest schema mismatch')
  check(revisionManifest?.revision_id === manifest?.revision_id, 'revision ID mismatch')
  check(revisionManifest?.dataset_as_of === manifest?.dataset_as_of, 'revision month mismatch')
  check(revisionManifest?.source_dataset_version === manifest?.source_dataset_version, 'revision source dataset mismatch')
  check(revisionManifest?.supersedes_source_dataset_version === manifest?.supersedes_source_dataset_version, 'superseded source dataset mismatch')
  check(revisionManifest?.release_type === RELEASE_TYPES.correction, 'revision release type mismatch')
  check(revisionManifest?.reason_type && CORRECTION_REASON_TYPES.includes(revisionManifest.reason_type), 'revision reason type mismatch')
  check(JSON.stringify(revisionManifest?.latest_source_batch_ids) === JSON.stringify(manifest?.latest_source_batch_ids), 'revision latest source batches mismatch')
  check(JSON.stringify(revisionManifest?.revision_source_batch_ids) === JSON.stringify(manifest?.revision_source_batch_ids), 'revision source batches mismatch')
  for (const field of ['candidate_records_sha256', 'audit_records_sha256', 'source_index_sha256', 'audit_report_sha256', 'audit_commit_sha', 'audit_code_sha256']) {
    check(revisionManifest?.[field] === manifest?.[field], `revision ${field} mismatch`)
  }
  check(revisionManifest?.audit_version === manifest?.audit_version, 'revision audit version mismatch')
  for (const field of ['ledger_before_sha256', 'ledger_after_sha256', 'ledger_append_start', 'ledger_append_count', 'ledger_append_sha256']) {
    check(revisionManifest?.[field] === manifest?.[field], `revision ${field} mismatch`)
  }
  check(revisionManifest?.changed_record_count === manifest?.changed_record_count, 'changed record count mismatch')
  check(/^[a-f0-9]{64}$/.test(revisionManifest?.audit_report_sha256 || ''), 'revision audit report hash is invalid')
  check(/^[a-f0-9]{40}$/.test(revisionManifest?.commit_sha || ''), 'revision commit SHA is invalid')
  check(/^\d+$/.test(String(revisionManifest?.github_run_id || '')), 'revision GitHub run ID is invalid')
  return errors
}

function verifyPublicationIdentityManifest(manifest) {
  const fields = [
    'candidate_records_sha256', 'audit_records_sha256', 'source_index_sha256',
    'audit_report_sha256', 'audit_commit_sha', 'audit_code_sha256',
    'audit_version', 'parser_versions',
  ]
  const present = fields.filter((field) => manifest?.[field] !== undefined)
  if (present.length === 0) return [] // Read-only compatibility for pre-gate releases.
  if (present.length !== fields.length) return ['publication identity is incomplete']
  try {
    validatePublicationIdentity(Object.fromEntries(fields.map((field) => [field, manifest[field]])))
    return []
  } catch (error) {
    return [error.message]
  }
}

export function verifyReleaseAgainstSnapshot(snapshot, release) {
  validateBundledSnapshot(snapshot)
  const errors = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  check(release.bootstrap.remoteFormat === REMOTE_FORMAT, 'bootstrap format mismatch')
  check(release.bootstrap.remoteSchemaVersion === REMOTE_SCHEMA_VERSION, 'bootstrap remote schema mismatch')
  check(release.manifest.format === REMOTE_FORMAT, 'manifest format mismatch')
  check(release.manifest.dataset_as_of === snapshot.datasetAsOf, 'manifest dataset month mismatch')
  check(release.manifest.source_dataset_version === snapshot.sourceDatasetVersion, 'manifest source dataset version mismatch')
  check(release.current.dataset_version === release.manifest.dataset_version, 'current dataset version mismatch')
  check(release.bootstrap.datasetVersion === release.manifest.dataset_version, 'bootstrap dataset version mismatch')
  check(release.bootstrap.sourceDatasetVersion === release.manifest.source_dataset_version, 'bootstrap source dataset version mismatch')
  check(release.manifest.bootstrap_sha256 === sha256(release.bootstrapText), 'bootstrap SHA-256 mismatch')
  check(release.manifest.bootstrap_bytes === byteLength(release.bootstrapText), 'bootstrap byte size mismatch')
  check(release.current.manifest_sha256 === sha256(release.manifestText), 'manifest SHA-256 mismatch')
  check([undefined, RELEASE_TYPES.monthly, RELEASE_TYPES.correction].includes(release.manifest.release_type), 'manifest release type is invalid')
  for (const error of verifyPublicationIdentityManifest(release.manifest)) errors.push(error)
  for (const error of verifyRevisionManifest(release.manifest, release.revisionManifest)) errors.push(error)
  if (release.revisionManifestText) {
    check(release.manifest.revision_manifest_sha256 === sha256(release.revisionManifestText), 'revision manifest SHA-256 mismatch')
    check(release.manifest.revision_manifest_bytes === byteLength(release.revisionManifestText), 'revision manifest byte size mismatch')
    check(byteLength(release.revisionManifestText) <= SIZE_LIMITS.revisionManifest, 'revision-manifest.json exceeds 512KB')
  }
  check(byteLength(release.currentText) <= SIZE_LIMITS.current, 'current.json exceeds 8KB')
  check(byteLength(release.manifestText) <= SIZE_LIMITS.manifest, 'manifest.json exceeds 16KB')
  check(byteLength(release.bootstrapText) <= SIZE_LIMITS.bootstrap, 'bootstrap.json exceeds 2MB')
  check(release.totalBytes <= SIZE_LIMITS.release, 'remote release exceeds 4MB')
  check(Object.keys(release.cities).length === 70, 'release must contain 70 city shards')
  const reconstructedSeries = { ...clone(release.bootstrap.series) }
  for (const cityId of snapshot.cityIds) {
    const item = release.cities[cityId]
    check(Boolean(item), `missing city shard: ${cityId}`)
    if (!item) continue
    check(item.data.datasetVersion === release.manifest.dataset_version, `${cityId}: dataset version mismatch`)
    check(item.data.cityId === cityId, `${cityId}: city ID mismatch`)
    check(item.sha256 === sha256(item.text), `${cityId}: SHA-256 mismatch`)
    check(item.bytes === byteLength(item.text), `${cityId}: byte size mismatch`)
    check(item.bytes <= SIZE_LIMITS.city, `${cityId}: shard exceeds 40KB`)
    const manifestItem = release.manifest.city_files[cityId]
    check(manifestItem?.sha256 === item.sha256, `${cityId}: manifest SHA-256 mismatch`)
    check(manifestItem?.bytes === item.bytes, `${cityId}: manifest byte size mismatch`)
    reconstructedSeries[cityId] = item.data.series
  }
  for (const cityId of snapshot.cityIds) {
    if (requiresCompleteBootstrap(release.manifest.minimum_app_version)) {
      check(JSON.stringify(release.bootstrap.series[cityId]) === JSON.stringify(snapshot.series[cityId]), `${cityId}: full bootstrap series differ from bundled snapshot`)
    }
    check(JSON.stringify(reconstructedSeries[cityId]) === JSON.stringify(snapshot.series[cityId]), `${cityId}: reconstructed series differ from bundled snapshot`)
  }
  for (const cityId of snapshot.cityIds) {
    for (const code of SERIES_CODES) {
      check(JSON.stringify(release.bootstrap.latestSeries[cityId][code]) === JSON.stringify(snapshot.series[cityId][code].slice(-4)), `${cityId}/${code}: latest values mismatch`)
    }
  }
  const expectedBootstrap = buildBootstrap(snapshot)
  check(JSON.stringify(release.bootstrap.breadthSeries) === JSON.stringify(expectedBootstrap.breadthSeries), 'breadth series mismatch')
  return errors
}

export function verifyReleaseIntegrity(release) {
  const errors = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  const { bootstrap, bootstrapText, manifest, manifestText, revisionManifest, revisionManifestText, current, currentText, cities } = release
  const usesApprovedLegacyCoverage = current?.transition_type === 'migration'
    && current?.migration_id === LEGACY_CONTROL_MIGRATION_ID
    && current?.migrated_from_manifest_sha256 === current?.manifest_sha256
    && bootstrap?.sourceCoverageStart === undefined
    && typeof bootstrap?.coverageStart === 'string'
    && Array.isArray(bootstrap?.months)
    && bootstrap.coverageStart < bootstrap.months[0]

  check(bootstrap?.remoteFormat === REMOTE_FORMAT, 'bootstrap format mismatch')
  check(bootstrap?.remoteSchemaVersion === REMOTE_SCHEMA_VERSION, 'bootstrap remote schema mismatch')
  check(manifest?.format === REMOTE_FORMAT, 'manifest format mismatch')
  check(manifest?.remote_schema_version === REMOTE_SCHEMA_VERSION, 'manifest remote schema mismatch')
  check(current?.dataset_version === manifest?.dataset_version, 'current dataset version mismatch')
  check(bootstrap?.datasetVersion === manifest?.dataset_version, 'bootstrap dataset version mismatch')
  check(bootstrap?.sourceDatasetVersion === manifest?.source_dataset_version
    || (usesApprovedLegacyCoverage && bootstrap?.sourceDatasetVersion === undefined), 'bootstrap source dataset version mismatch')
  check(current?.dataset_as_of === manifest?.dataset_as_of, 'current dataset month mismatch')
  check(bootstrap?.datasetAsOf === manifest?.dataset_as_of, 'bootstrap dataset month mismatch')
  check(manifest?.bootstrap_sha256 === sha256(bootstrapText), 'bootstrap SHA-256 mismatch')
  check(manifest?.bootstrap_bytes === byteLength(bootstrapText), 'bootstrap byte size mismatch')
  check(current?.manifest_sha256 === sha256(manifestText), 'manifest SHA-256 mismatch')
  check([undefined, RELEASE_TYPES.monthly, RELEASE_TYPES.correction].includes(manifest?.release_type), 'manifest release type is invalid')
  for (const error of verifyPublicationIdentityManifest(manifest)) errors.push(error)
  for (const error of verifyRevisionManifest(manifest, revisionManifest)) errors.push(error)
  if (revisionManifestText) {
    check(manifest?.revision_manifest_sha256 === sha256(revisionManifestText), 'revision manifest SHA-256 mismatch')
    check(manifest?.revision_manifest_bytes === byteLength(revisionManifestText), 'revision manifest byte size mismatch')
    check(byteLength(revisionManifestText) <= SIZE_LIMITS.revisionManifest, 'revision-manifest.json exceeds 512KB')
  }
  check(byteLength(currentText) <= SIZE_LIMITS.current, 'current.json exceeds 8KB')
  check(byteLength(manifestText) <= SIZE_LIMITS.manifest, 'manifest.json exceeds 16KB')
  check(byteLength(bootstrapText) <= SIZE_LIMITS.bootstrap, 'bootstrap.json exceeds 2MB')
  check(release.totalBytes <= SIZE_LIMITS.release, 'remote release exceeds 4MB')

  const bootstrapCityIds = Array.isArray(bootstrap?.cityIds) ? bootstrap.cityIds : []
  const manifestCityIds = Object.keys(manifest?.city_files || {})
  const shardCityIds = Object.keys(cities || {})
  check(bootstrapCityIds.length === 70 && new Set(bootstrapCityIds).size === 70, 'bootstrap must contain 70 unique city IDs')
  check(manifestCityIds.length === 70, 'manifest must contain 70 city shards')
  check(shardCityIds.length === 70, 'release must contain 70 city shards')
  check(JSON.stringify([...manifestCityIds].sort()) === JSON.stringify([...bootstrapCityIds].sort()), 'manifest city IDs differ from bootstrap')
  check(JSON.stringify([...shardCityIds].sort()) === JSON.stringify([...bootstrapCityIds].sort()), 'shard city IDs differ from bootstrap')

  const reconstructedSeries = { ...(bootstrap?.series ? clone(bootstrap.series) : {}) }
  for (const cityId of bootstrapCityIds) {
    const item = cities?.[cityId]
    check(Boolean(item), `missing city shard: ${cityId}`)
    if (!item) continue
    check(item.data?.datasetVersion === manifest?.dataset_version, `${cityId}: dataset version mismatch`)
    check(item.data?.cityId === cityId, `${cityId}: city ID mismatch`)
    check(item.sha256 === sha256(item.text), `${cityId}: SHA-256 mismatch`)
    check(item.bytes === byteLength(item.text), `${cityId}: byte size mismatch`)
    check(item.bytes <= SIZE_LIMITS.city, `${cityId}: shard exceeds 40KB`)
    check(manifest?.city_files?.[cityId]?.sha256 === item.sha256, `${cityId}: manifest SHA-256 mismatch`)
    check(manifest?.city_files?.[cityId]?.bytes === item.bytes, `${cityId}: manifest byte size mismatch`)
    if (bootstrap?.series?.[cityId]) {
      check(JSON.stringify(bootstrap.series[cityId]) === JSON.stringify(item.data?.series), `${cityId}: bootstrap and shard series differ`)
    }
    reconstructedSeries[cityId] = item.data?.series
  }

  // The one approved legacy migration preserves the historical bootstrap bytes.
  // Its old coverageStart means source coverage; normalize that meaning only in
  // the verifier's in-memory reconstruction, never in the stored release.
  const integrityBootstrap = usesApprovedLegacyCoverage
    ? { ...bootstrap, sourceDatasetVersion: manifest.source_dataset_version, coverageStart: bootstrap.months[0], sourceCoverageStart: bootstrap.coverageStart }
    : bootstrap
  const reconstructedSnapshot = { ...integrityBootstrap, series: reconstructedSeries }
  try {
    validateBundledSnapshot(reconstructedSnapshot)
    const expectedBootstrap = buildBootstrap(reconstructedSnapshot)
    check(JSON.stringify(bootstrap.latestSeries) === JSON.stringify(expectedBootstrap.latestSeries), 'latest series mismatch')
    check(JSON.stringify(bootstrap.breadthSeries) === JSON.stringify(expectedBootstrap.breadthSeries), 'breadth series mismatch')
  } catch (error) {
    errors.push(`reconstructed snapshot invalid: ${error.message}`)
  }
  return errors
}

export function classifyRemoteFreshness(remoteManifest, bundledSnapshot) {
  if (remoteManifest.dataset_as_of > bundledSnapshot.datasetAsOf) {
    return { freshness_status: 'newer_month', client_action: 'eligible_after_full_validation' }
  }
  if (remoteManifest.dataset_as_of < bundledSnapshot.datasetAsOf) {
    return { freshness_status: 'stale_month', client_action: 'keep_bundled_snapshot' }
  }
  if (remoteManifest.source_dataset_version === bundledSnapshot.sourceDatasetVersion) {
    return { freshness_status: 'matches_bundled_source', client_action: 'eligible_after_full_validation' }
  }
  if (remoteManifest.release_type === RELEASE_TYPES.correction) {
    return { freshness_status: 'audited_historical_correction', client_action: 'eligible_after_revision_chain_validation' }
  }
  return { freshness_status: 'known_stale_source', client_action: 'reject_remote_and_keep_bundled_snapshot' }
}
