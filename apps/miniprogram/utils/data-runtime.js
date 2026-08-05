const bundledSnapshot = require('../data/snapshot.js')
const dataConfig = require('../config/data.js')
const versionConfig = require('../config/version.js')
const { sha256, sha256Async, utf8Bytes } = require('./sha256.js')
const {
  AUDITED_LEGACY_MIGRATIONS,
  CONTROL_VALIDATOR_ID,
  CONTROL_SCHEMA_VERSION,
  MAX_VALIDATION_RECEIPT_MS,
  VALIDATION_RECEIPT_SCHEMA_VERSION,
  validateCurrent: validateControlPointer,
  validateRegistry: validateControlRegistry,
} = require('../cloudfunctions/getHousingDataManifest/validate-current.js')
const { SERIES_CODES, validateBundledSnapshot, validateCompleteSnapshot } = require('./data-integrity.js')

const STATE_KEY = 'housing-data-runtime-state-v1'
const CONTROL_TOMBSTONE_KEY = 'housing-data-control-tombstone-v1'
const POINTER_KEY = 'housing-data-pointer-v4'
const CHECK_KEY = 'housing-data-check-v3'
const REVOKED_SOURCES_KEY = 'housing-data-revoked-sources-v1'
const REGISTRY_SCHEMA_VERSION = '1.0.0'
const DATASET_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const SHA_PATTERN = /^[a-f0-9]{64}$/
const REVISION_ID_PATTERN = /^revision-[a-z0-9][a-z0-9-]{5,80}$/
const DATASET_REVOCATION_FIELDS = ['dataset_version', 'reason', 'replacement_dataset_version', 'revision_id', 'revoked_at']
const SOURCE_REVOCATION_FIELDS = ['reason', 'replacement_source_dataset_version', 'revision_id', 'revoked_at', 'source_dataset_version']
const VALIDATION_RECEIPT_FIELDS = [
  'receipt_schema_version',
  'validator_id',
  'validated_at',
  'valid_until',
  'current_fingerprint',
  'manifest_sha256',
  'revocations_sha256',
  'control_generation',
  'revocations_generation',
]
const MAX_RECEIPT_CLOCK_SKEW_MS = 60 * 1000
const STATE_SCHEMA_VERSION = 3

function major(version) {
  return Number(String(version || '').replace(/^v/, '').split('.')[0])
}

function compareVersions(left, right) {
  const a = String(left || '').replace(/^v/, '').split('.').map(Number)
  const b = String(right || '').replace(/^v/, '').split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0)
  }
  return 0
}

function safeParse(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/, ''))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function fingerprint(value) {
  return sha256(utf8Bytes(JSON.stringify(canonicalize(value))))
}

function uniqueDatasetVersions(values) {
  return [...new Set((values || []).filter((value) => DATASET_PATTERN.test(value)))].sort()
}

function hasExactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
}

function normalizeStoredRevocationEntries(entries, fields, versionField) {
  if (!Array.isArray(entries)) return []
  return entries
    .filter((entry) => hasExactFields(entry, fields) && DATASET_PATTERN.test(entry[versionField] || ''))
    .map(clone)
    .sort((left, right) => left[versionField].localeCompare(right[versionField], 'en'))
}

function unavailableSnapshot(bundled, reason = 'control-state-untrusted') {
  return {
    schemaVersion: bundled.schemaVersion,
    datasetVersion: bundled.datasetVersion,
    sourceDatasetVersion: bundled.sourceDatasetVersion,
    datasetAsOf: bundled.datasetAsOf,
    releaseDate: bundled.releaseDate,
    generatedAt: bundled.generatedAt,
    sourceCoverageStart: bundled.sourceCoverageStart,
    coverageStart: bundled.coverageStart,
    latestOfficialUrl: bundled.latestOfficialUrl,
    nextCheckDueAt: bundled.nextCheckDueAt,
    months: [],
    releaseDates: [],
    cityIds: [],
    featuredCityIds: [],
    cityMap: {},
    series: {},
    latestSeries: {},
    breadthSeries: {},
    dataStatus: 'unavailable',
    statusReason: reason,
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function validateRemoteMonth(current, bundled) {
  assert(current.dataset_as_of >= bundled.datasetAsOf, 'remote data is older than the bundled snapshot')
}

function validateRemoteSource(current, manifest, bundled, revisionManifest = null, activeSourceVersion = bundled.sourceDatasetVersion, activeDatasetAsOf = bundled.datasetAsOf) {
  if (current.dataset_as_of > activeDatasetAsOf || manifest.source_dataset_version === activeSourceVersion) return
  assert(manifest.release_type === 'historical_correction' && revisionManifest, 'remote data conflicts with the bundled snapshot for the same month')
  const chain = revisionManifest.source_version_chain
  const activeIndex = chain.indexOf(activeSourceVersion)
  assert(activeIndex >= 0 && activeIndex < chain.length - 1, 'correction source chain does not supersede the active source')
  assert(chain.at(-1) === manifest.source_dataset_version, 'correction source chain does not end at the remote source')
}

function bundledSupersedesRemoteManifest(manifest, bundled, control, config = dataConfig) {
  if (!manifest || !bundled || !control) return false
  if (control.revokedDatasetVersions.includes(bundled.datasetVersion)
    || control.revokedSourceDatasetVersions.includes(bundled.sourceDatasetVersion)) return false
  const exactLegacySupersession = (config.bundledLegacySupersession || []).some((entry) => {
    const descriptor = AUDITED_LEGACY_MIGRATIONS[entry?.migrationId]
    return descriptor
      && bundled.datasetVersion === entry.bundledDatasetVersion
      && bundled.sourceDatasetVersion === entry.bundledSourceDatasetVersion
      && manifest.dataset_version === descriptor.dataset_version
      && manifest.source_dataset_version === descriptor.source_dataset_version
      && manifest.dataset_as_of === descriptor.dataset_as_of
  })
  return manifest.dataset_as_of === bundled.datasetAsOf
    && (manifest.source_dataset_version === bundled.sourceDatasetVersion || exactLegacySupersession)
    && Date.parse(bundled.generatedAt) > Date.parse(manifest.generated_at)
}

function completeCoverageStart(datasetAsOf, monthCount) {
  assert(/^20\d{2}-(0[1-9]|1[0-2])$/.test(datasetAsOf || ''), 'complete remote dataset month is invalid')
  assert(Number.isInteger(monthCount) && monthCount > 0, 'complete remote month count is invalid')
  const date = new Date(`${datasetAsOf}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() - (monthCount - 1))
  return date.toISOString().slice(0, 7)
}

function validateCurrent(current, config, options = {}) {
  return validateControlPointer(current, { config, ...options })
}

function canonicalTimestamp(value, label) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${label} is invalid`)
  assert(new Date(value).toISOString() === value, `${label} is not canonical ISO 8601`)
  return Date.parse(value)
}

function validateValidationReceipt(receipt, current, nowValue = Date.now()) {
  assert(hasExactFields(receipt, VALIDATION_RECEIPT_FIELDS), 'remote validation receipt fields are invalid')
  assert(receipt.receipt_schema_version === VALIDATION_RECEIPT_SCHEMA_VERSION, 'remote validation receipt schema is unsupported')
  assert(receipt.validator_id === CONTROL_VALIDATOR_ID, 'remote validation receipt validator is not trusted')
  const validatedAt = canonicalTimestamp(receipt.validated_at, 'remote validation receipt timestamp')
  const validUntil = canonicalTimestamp(receipt.valid_until, 'remote validation receipt expiry')
  assert(validUntil > validatedAt && validUntil - validatedAt <= MAX_VALIDATION_RECEIPT_MS, 'remote validation receipt window is invalid')
  assert(validatedAt >= Date.parse(current.control_generated_at), 'remote validation receipt predates the control pointer')
  assert(validatedAt <= nowValue + MAX_RECEIPT_CLOCK_SKEW_MS, 'remote validation receipt timestamp is too far in the future')
  assert(receipt.current_fingerprint === fingerprint(current), 'remote validation receipt current identity is invalid')
  assert(receipt.manifest_sha256 === current.manifest_sha256, 'remote validation receipt manifest identity is invalid')
  assert(receipt.revocations_sha256 === current.revocations_sha256, 'remote validation receipt revocations identity is invalid')
  assert(receipt.control_generation === current.control_generation, 'remote validation receipt control generation is invalid')
  assert(receipt.revocations_generation === current.revocations_generation, 'remote validation receipt revocations generation is invalid')
  return {
    activationAuthorized: validatedAt <= nowValue + MAX_RECEIPT_CLOCK_SKEW_MS && validUntil > nowValue,
    receipt,
    validatedAt,
    validUntil,
  }
}

function validateRevocationsRegistry(registry, current) {
  validateControlRegistry(registry)
  assert(registry?.registry_schema_version === REGISTRY_SCHEMA_VERSION, 'remote revocations schema is unsupported')
  assert(Number.isInteger(registry.generation) && registry.generation === current.revocations_generation, 'remote revocations generation is inconsistent')
  assert(Number.isFinite(Date.parse(registry.generated_at || '')), 'remote revocations timestamp is invalid')
  assert(Array.isArray(registry.revoked_dataset_versions) && Array.isArray(registry.revoked_source_dataset_versions), 'remote revocations lists are invalid')
  const validateEntries = (entries, fields, field, replacementField, label, revisionRequired) => {
    const values = []
    for (const entry of entries) {
      assert(hasExactFields(entry, fields), `remote revoked ${label} fields are invalid`)
      assert(DATASET_PATTERN.test(entry[field] || ''), `remote revoked ${label} version is invalid`)
      assert(Number.isFinite(Date.parse(entry.revoked_at || '')), `remote revoked ${label} timestamp is invalid`)
      assert(typeof entry.reason === 'string' && entry.reason.length >= 3, `remote revoked ${label} reason is invalid`)
      if (revisionRequired) assert(REVISION_ID_PATTERN.test(entry.revision_id || ''), `remote revoked ${label} revision is invalid`)
      else assert(entry.revision_id === null || REVISION_ID_PATTERN.test(entry.revision_id || ''), `remote revoked ${label} revision is invalid`)
      if (entry[replacementField] !== null && entry[replacementField] !== undefined) {
        assert(DATASET_PATTERN.test(entry[replacementField]), `remote revoked ${label} replacement is invalid`)
        assert(entry[replacementField] !== entry[field], `remote revoked ${label} replaces itself`)
      }
      values.push(entry[field])
    }
    assert(new Set(values).size === values.length, `remote revoked ${label} versions contain duplicates`)
    return {
      entries: entries.map(clone).sort((left, right) => left[field].localeCompare(right[field], 'en')),
      versions: values.sort(),
    }
  }
  const datasets = validateEntries(registry.revoked_dataset_versions, DATASET_REVOCATION_FIELDS, 'dataset_version', 'replacement_dataset_version', 'dataset', false)
  const sources = validateEntries(registry.revoked_source_dataset_versions, SOURCE_REVOCATION_FIELDS, 'source_dataset_version', 'replacement_source_dataset_version', 'source', true)
  const revokedDatasetVersions = datasets.versions
  const revokedSourceDatasetVersions = sources.versions
  assert(!revokedDatasetVersions.includes(current.dataset_version), 'remote target dataset has been revoked')
  assert(!revokedSourceDatasetVersions.includes(current.source_dataset_version), 'remote target source has been revoked')
  if (current.transition_type === 'rollback') {
    assert(revokedDatasetVersions.includes(current.rollback_from_dataset_version), 'remote rollback source is not revoked')
  }
  return {
    registry,
    revokedDatasetVersions,
    revokedSourceDatasetVersions,
    revokedDatasetEntries: datasets.entries,
    revokedSourceDatasetEntries: sources.entries,
  }
}

function validateSeries(series, monthCount, label) {
  assert(series && Object.keys(series).length === SERIES_CODES.length, `${label} series codes are invalid`)
  for (const code of SERIES_CODES) assert(Array.isArray(series[code]) && series[code].length === monthCount * 4, `${label}/${code} length is invalid`)
}

function exactStringSet(actual, expected, label) {
  const left = [...actual].sort((a, b) => a.localeCompare(b, 'en'))
  const right = [...expected].sort((a, b) => a.localeCompare(b, 'en'))
  assert(left.length === right.length && left.every((value, index) => value === right[index]), label)
}

function remoteReleaseRoot(config, datasetVersion) {
  const dataRoot = config.remoteDataRoot || 'housing-data'
  assert(['housing-data', 'housing-data/preview'].includes(dataRoot), 'remote data root is invalid')
  return `cloud://${config.cloudEnvId}.${config.storageBucket}/${dataRoot}/releases/${datasetVersion}/`
}

function validateManifest(manifest, current, config, expectedCityIds = bundledSnapshot.cityIds) {
  assert(manifest?.format === config.remoteFormat, 'remote manifest format is invalid')
  const schemaMajor = major(manifest.remote_schema_version)
  const acceptedMajors = config.acceptedRemoteSchemaMajors || [config.remoteSchemaMajor]
  assert(acceptedMajors.includes(schemaMajor), 'remote manifest schema is unsupported')
  assert(manifest.dataset_version === current.dataset_version && manifest.dataset_as_of === current.dataset_as_of, 'remote manifest version is inconsistent')
  assert(manifest.validation_status === 'passed', 'remote manifest has not passed validation')
  if (schemaMajor === 2) {
    const root = remoteReleaseRoot(config, current.dataset_version)
    assert(manifest.release_type === 'monthly_update', 'complete remote release type is invalid')
    assert(manifest.source_dataset_version === current.source_dataset_version, 'complete remote source version is inconsistent')
    assert(manifest.coverage_start === completeCoverageStart(manifest.dataset_as_of, config.completeRemoteMonthCount), 'complete remote coverage start is invalid')
    assert(manifest.month_count === config.completeRemoteMonthCount, 'complete remote month count is invalid')
    assert(manifest.complete_snapshot_file_id === `${root}complete-snapshot.json`, 'complete remote snapshot path is invalid')
    assert(SHA_PATTERN.test(manifest.complete_snapshot_sha256 || '') && Number.isInteger(manifest.complete_snapshot_bytes) && manifest.complete_snapshot_bytes > 0, 'complete remote snapshot metadata is invalid')
    assert(SHA_PATTERN.test(manifest.snapshot_content_sha256 || ''), 'complete remote source snapshot identity is invalid')
    assert(manifest.audit_version === 'full-record-audit-v7' && typeof manifest.audit_method === 'string' && manifest.audit_method.startsWith('automated-full-record-audit-v7:'), 'complete remote audit version is invalid')
    assert(SHA_PATTERN.test(manifest.audit_report_sha256 || '') && SHA_PATTERN.test(manifest.audit_code_sha256 || '') && SHA_PATTERN.test(manifest.source_records_sha256 || '') && SHA_PATTERN.test(manifest.source_index_sha256 || '') && /^[a-f0-9]{40}$/.test(manifest.audit_repository_commit_sha || ''), 'complete remote audit identity is invalid')
    assert(Array.isArray(manifest.parser_versions) && manifest.parser_versions.length > 0 && new Set(manifest.parser_versions).size === manifest.parser_versions.length && manifest.parser_versions.every((value) => typeof value === 'string' && value), 'complete remote parser identity is invalid')
    assert(Array.isArray(manifest.source_batch_ids) && manifest.source_batch_ids.length === config.completeRemoteMonthCount && new Set(manifest.source_batch_ids).size === manifest.source_batch_ids.length && manifest.source_batch_ids.every((value) => /^official-html-20\d{2}-(?:0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(value)), 'complete remote source batches are invalid')
    assert(compareVersions(versionConfig.version, manifest.minimum_app_version) >= 0, 'remote data requires a newer mini program version')
    return manifest
  }
  assert([undefined, 'monthly_update', 'historical_correction'].includes(manifest.release_type), 'remote release type is invalid')
  assert(compareVersions(versionConfig.version, manifest.minimum_app_version) >= 0, 'remote data requires a newer mini program version')
  assert(SHA_PATTERN.test(manifest.bootstrap_sha256 || '') && Number.isInteger(manifest.bootstrap_bytes), 'remote bootstrap metadata is invalid')
  const root = remoteReleaseRoot(config, current.dataset_version)
  assert(manifest.bootstrap_file_id === `${root}bootstrap.json`, 'remote bootstrap path is invalid')
  assert(manifest.city_file_id_template === `${root}cities/{city_id}.json`, 'remote city path template is invalid')
  assert(manifest.city_files && Object.keys(manifest.city_files).length === 70, 'remote city manifest must contain 70 cities')
  exactStringSet(Object.keys(manifest.city_files), expectedCityIds, 'remote city manifest differs from the authoritative 70-city set')
  for (const [cityId, file] of Object.entries(manifest.city_files)) {
    assert(/^[a-z]+$/.test(cityId), `remote city ID is invalid: ${cityId}`)
    assert(SHA_PATTERN.test(file.sha256 || '') && Number.isInteger(file.bytes), `remote city file metadata is invalid: ${cityId}`)
  }
  if (manifest.release_type === 'historical_correction') {
    assert(/^revision-[a-z0-9][a-z0-9-]{5,80}$/.test(manifest.revision_id || ''), 'remote revision ID is invalid')
    assert(DATASET_PATTERN.test(manifest.supersedes_source_dataset_version || ''), 'remote superseded source is invalid')
    assert(manifest.revision_manifest_file_id === `${root}revision-manifest.json`, 'remote revision manifest path is invalid')
    assert(SHA_PATTERN.test(manifest.revision_manifest_sha256 || '') && Number.isInteger(manifest.revision_manifest_bytes), 'remote revision manifest metadata is invalid')
  }
  return manifest
}

function isCompleteRemoteManifest(manifest) {
  return major(manifest?.remote_schema_version) === 2
}

function validateCompleteSourceEvidence(manifest, snapshot) {
  const sourceMonths = manifest.source_batch_ids.map((value) => value.match(/^official-html-(20\d{2}-(?:0[1-9]|1[0-2]))-[a-f0-9]{12}$/)?.[1]).sort()
  assert(sourceMonths.every(Boolean) && JSON.stringify(sourceMonths) === JSON.stringify(snapshot.months), 'complete remote source batches do not match snapshot months')
}

function validateRevisionManifest(revision, manifest) {
  assert(revision?.format === 'housing-historical-correction' && revision.schema_version === '1.0.0', 'remote revision manifest format is invalid')
  assert(revision.revision_id === manifest.revision_id && revision.revision_type === 'historical_data_correction', 'remote revision identity is invalid')
  assert(revision.approval_status === 'approved', 'remote revision is not approved')
  assert(revision.dataset_as_of === manifest.dataset_as_of && revision.source_dataset_version === manifest.source_dataset_version, 'remote revision dataset is inconsistent')
  assert(revision.supersedes_source_dataset_version === manifest.supersedes_source_dataset_version, 'remote revision superseded source is inconsistent')
  assert(Array.isArray(revision.source_version_chain) && revision.source_version_chain.length >= 2, 'remote revision source chain is invalid')
  assert(revision.source_version_chain.at(-2) === revision.supersedes_source_dataset_version && revision.source_version_chain.at(-1) === revision.source_dataset_version, 'remote revision source chain endpoints are invalid')
  assert(new Set(revision.source_version_chain).size === revision.source_version_chain.length, 'remote revision source chain contains duplicates')
  assert(Array.isArray(revision.revoked_source_dataset_versions) && revision.revoked_source_dataset_versions.includes(revision.supersedes_source_dataset_version), 'remote revision revocations are invalid')
  assert(revision.revoked_source_dataset_versions.every((value) => revision.source_version_chain.includes(value) && value !== revision.source_dataset_version), 'remote revision revokes an invalid source')
  assert(typeof revision.reason === 'string' && revision.reason.trim().length >= 10, 'remote revision reason is invalid')
  assert(Array.isArray(revision.official_urls) && revision.official_urls.length > 0 && revision.official_urls.every((url) => /^https:\/\/(?:www\.)?stats\.gov\.cn\//.test(url)), 'remote revision official URLs are invalid')
  assert(Array.isArray(revision.source_batch_ids) && revision.source_batch_ids.length > 0, 'remote revision source batches are invalid')
  assert(typeof revision.parser_version === 'string' && revision.parser_version && typeof revision.audit_version === 'string' && revision.audit_version, 'remote revision audit metadata is invalid')
  assert(SHA_PATTERN.test(revision.audit_report_sha256 || '') && /^[a-f0-9]{40}$/.test(revision.commit_sha || '') && /^\d+$/.test(String(revision.github_run_id || '')), 'remote revision build identity is invalid')
  assert(Number.isFinite(Date.parse(revision.approved_at || '')) && typeof revision.approved_by === 'string' && revision.approved_by, 'remote revision approval metadata is invalid')
  assert(Array.isArray(revision.changes) && revision.changes.length > 0, 'remote revision changes are missing')
  const keys = revision.changes.map((item) => `${item.record_key}|${item.field}`)
  assert(new Set(keys).size === keys.length, 'remote revision contains duplicate changed fields')
  assert(new Set(revision.changes.map((item) => item.record_key)).size === manifest.changed_record_count, 'remote revision changed record count is inconsistent')
  for (const item of revision.changes) {
    assert(/^20\d{2}-(0[1-9]|1[0-2])\|[a-z]+\|(new|resale)\|(all|le90|90_144|gt144)$/.test(item.record_key || ''), 'remote revision record key is invalid')
    assert(typeof item.field === 'string' && item.field && /^https:\/\/(?:www\.)?stats\.gov\.cn\//.test(item.source_url || '') && typeof item.source_record_locator === 'string' && item.source_record_locator, 'remote revision change evidence is invalid')
  }
  return revision
}

function interpretAuditedLegacyBootstrap(bootstrap, manifest, current) {
  if (current?.transition_type !== 'migration') return bootstrap
  const descriptor = AUDITED_LEGACY_MIGRATIONS[current.migration_id]
  assert(descriptor, 'remote migration bootstrap is not approved')
  assert(current.manifest_sha256 === descriptor.legacy_manifest_sha256, 'remote migration manifest identity is invalid')
  assert(manifest.bootstrap_sha256 === descriptor.legacy_bootstrap_sha256, 'remote migration bootstrap hash is invalid')
  assert(manifest.bootstrap_bytes === descriptor.legacy_bootstrap_bytes, 'remote migration bootstrap size is invalid')
  assert(bootstrap.sourceCoverageStart === undefined, 'remote migration bootstrap unexpectedly contains source coverage')
  assert(bootstrap.coverageStart === descriptor.legacy_source_coverage_start, 'remote migration legacy coverage start is invalid')
  assert(bootstrap.months?.[0] === descriptor.client_coverage_start, 'remote migration client coverage start is invalid')
  return {
    ...bootstrap,
    sourceDatasetVersion: manifest.source_dataset_version,
    sourceCoverageStart: descriptor.legacy_source_coverage_start,
    coverageStart: descriptor.client_coverage_start,
  }
}

function validateBootstrap(rawBootstrap, manifest, config, expectedCityIds = bundledSnapshot.cityIds, expectedFeaturedCityIds = bundledSnapshot.featuredCityIds, current = null) {
  const bootstrap = interpretAuditedLegacyBootstrap(rawBootstrap, manifest, current)
  assert(bootstrap?.remoteFormat === config.remoteFormat, 'remote bootstrap format is invalid')
  assert((config.acceptedRemoteSchemaMajors || [config.remoteSchemaMajor]).includes(major(bootstrap.remoteSchemaVersion)), 'remote bootstrap schema is unsupported')
  assert(bootstrap.datasetVersion === manifest.dataset_version
    && bootstrap.sourceDatasetVersion === manifest.source_dataset_version
    && bootstrap.datasetAsOf === manifest.dataset_as_of, 'remote bootstrap version is inconsistent')
  assert(Array.isArray(bootstrap.cityIds) && bootstrap.cityIds.length === 70 && new Set(bootstrap.cityIds).size === 70, 'remote bootstrap city IDs are invalid')
  exactStringSet(bootstrap.cityIds, expectedCityIds, 'remote bootstrap differs from the authoritative 70-city set')
  assert(Array.isArray(bootstrap.featuredCityIds) && bootstrap.featuredCityIds.length === 6, 'remote bootstrap featured cities are invalid')
  assert(JSON.stringify(bootstrap.featuredCityIds) === JSON.stringify(expectedFeaturedCityIds), 'remote bootstrap featured cities differ from the product baseline')
  assert(Array.isArray(bootstrap.months) && bootstrap.months.length === 120 && bootstrap.months.at(-1) === bootstrap.datasetAsOf, 'remote bootstrap months are invalid')
  assert(bootstrap.coverageStart === bootstrap.months[0], 'remote bootstrap coverage start is inconsistent')
  for (let index = 1; index < bootstrap.months.length; index += 1) {
    const previous = new Date(`${bootstrap.months[index - 1]}-01T00:00:00Z`)
    previous.setUTCMonth(previous.getUTCMonth() + 1)
    assert(bootstrap.months[index] === previous.toISOString().slice(0, 7), 'remote bootstrap months are not continuous')
  }
  assert(/^20\d{2}-(0[1-9]|1[0-2])$/.test(bootstrap.sourceCoverageStart), 'remote bootstrap source coverage start is invalid')
  assert(bootstrap.sourceCoverageStart <= bootstrap.months.at(-1), 'remote bootstrap source coverage cannot start after the client window')
  const sourceCoverageIndex = Math.max(0, bootstrap.months.indexOf(bootstrap.sourceCoverageStart))
  assert(Array.isArray(bootstrap.releaseDates) && bootstrap.releaseDates.length === 120, 'remote release dates are invalid')
  bootstrap.releaseDates.forEach((value, index) => {
    if (index < sourceCoverageIndex) assert(value === '', `remote bootstrap pre-source release date must be empty: ${index}`)
    else assert(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)), `remote bootstrap release date is invalid: ${index}`)
  })
  for (const cityId of bootstrap.cityIds) {
    assert(bootstrap.cityMap?.[cityId], `remote city profile is missing: ${cityId}`)
    assert(bootstrap.latestSeries?.[cityId], `remote latest values are missing: ${cityId}`)
    for (const code of SERIES_CODES) assert(Array.isArray(bootstrap.latestSeries[cityId][code]) && bootstrap.latestSeries[cityId][code].length === 4, `remote latest series is invalid: ${cityId}/${code}`)
  }
  for (const cityId of bootstrap.featuredCityIds) {
    validateSeries(bootstrap.series?.[cityId], 120, cityId)
    for (const values of Object.values(bootstrap.series[cityId] || {})) assert(values.slice(0, sourceCoverageIndex * 4).every((value) => value === null), `remote bootstrap pre-source padding must be null: ${cityId}`)
  }
  for (const cityId of bootstrap.cityIds) {
    if (bootstrap.series?.[cityId]) {
      validateSeries(bootstrap.series[cityId], 120, cityId)
      for (const values of Object.values(bootstrap.series[cityId])) assert(values.slice(0, sourceCoverageIndex * 4).every((value) => value === null), `remote bootstrap pre-source padding must be null: ${cityId}`)
    }
  }
  for (const code of SERIES_CODES) {
    for (const metric of ['mom', 'yoy']) assert(Array.isArray(bootstrap.breadthSeries?.[`${code}_${metric}`]) && bootstrap.breadthSeries[`${code}_${metric}`].length === 480, `remote breadth series is invalid: ${code}/${metric}`)
  }
  return bootstrap
}

function validateCityShard(shard, manifest, cityId, config) {
  assert(shard?.remoteFormat === config.remoteFormat, `remote city format is invalid: ${cityId}`)
  assert((config.acceptedRemoteSchemaMajors || [config.remoteSchemaMajor]).includes(major(shard.remoteSchemaVersion)), `remote city schema is unsupported: ${cityId}`)
  assert(shard.datasetVersion === manifest.dataset_version && shard.cityId === cityId, `remote city version is inconsistent: ${cityId}`)
  validateSeries(shard.series, 120, cityId)
  return shard
}

function createDataRuntime({ wxApi = typeof wx === 'undefined' ? null : wx, bundled = bundledSnapshot, config = dataConfig, now = () => Date.now() } = {}) {
  const diagnosticEnabled = config.previewMode === true

  function diagnostic(stage, details = {}) {
    if (!diagnosticEnabled) return
    try {
      console.info('[data:update:diag]', JSON.stringify({ stage, ...details }))
    } catch (_) {}
  }

  function diagnosticError(error) {
    return String(error?.errMsg || error?.message || error || 'unknown-error')
      .replace(/cloud:\/\/\S+/g, 'cloud://[redacted]')
      .slice(0, 160)
  }

  let bundledValidationError = null
  try {
    validateBundledSnapshot(bundled, {
      cityIds: bundledSnapshot.cityIds,
      featuredCityIds: bundledSnapshot.featuredCityIds,
    })
  } catch (error) {
    bundledValidationError = error
    console.error('[data:update] bundled data rejected', error)
  }
  let activeSnapshot = bundledValidationError ? unavailableSnapshot(bundled, 'bundled-data-invalid') : bundled
  let activeSource = bundledValidationError ? 'unavailable' : 'bundled'
  let activeManifest = null
  let activeRevisionManifest = null
  let cachedCityIds = []
  let controlRecoveryError = null
  const fs = wxApi && typeof wxApi.getFileSystemManager === 'function' ? wxApi.getFileSystemManager() : null
  const userRoot = wxApi?.env?.USER_DATA_PATH ? `${wxApi.env.USER_DATA_PATH}/housing-data` : ''

  function emptyState() {
    return {
      stateSchemaVersion: STATE_SCHEMA_VERSION,
      status: 'idle',
      active: null,
      fallback: null,
      cacheDirectories: [],
      control: {
        generation: 0,
        fingerprint: '',
        registryGeneration: 0,
        registrySha256: '',
        revokedDatasetVersions: [],
        revokedSourceDatasetVersions: [],
        revokedDatasetEntries: [],
        revokedSourceDatasetEntries: [],
        registryGeneratedAt: '',
        validatorId: '',
        checkedAt: 0,
        validUntil: 0,
      },
      schedule: { dataNextCheckAt: 0, controlNextCheckAt: 0, errorCode: '' },
      pendingRollback: null,
    }
  }

  function normalizeControl(value) {
    const revokedDatasetEntries = normalizeStoredRevocationEntries(value?.revokedDatasetEntries, DATASET_REVOCATION_FIELDS, 'dataset_version')
    const revokedSourceDatasetEntries = normalizeStoredRevocationEntries(value?.revokedSourceDatasetEntries, SOURCE_REVOCATION_FIELDS, 'source_dataset_version')
    return {
      generation: Number.isInteger(value?.generation) && value.generation >= 0 ? value.generation : 0,
      fingerprint: SHA_PATTERN.test(value?.fingerprint || '') ? value.fingerprint : '',
      registryGeneration: Number.isInteger(value?.registryGeneration) && value.registryGeneration >= 0 ? value.registryGeneration : 0,
      registrySha256: SHA_PATTERN.test(value?.registrySha256 || '') ? value.registrySha256 : '',
      revokedDatasetVersions: uniqueDatasetVersions([
        ...(Array.isArray(value?.revokedDatasetVersions) ? value.revokedDatasetVersions : []),
        ...revokedDatasetEntries.map((entry) => entry.dataset_version),
      ]),
      revokedSourceDatasetVersions: uniqueDatasetVersions([
        ...(Array.isArray(value?.revokedSourceDatasetVersions) ? value.revokedSourceDatasetVersions : []),
        ...revokedSourceDatasetEntries.map((entry) => entry.source_dataset_version),
      ]),
      revokedDatasetEntries,
      revokedSourceDatasetEntries,
      registryGeneratedAt: Number.isFinite(Date.parse(value?.registryGeneratedAt || '')) ? value.registryGeneratedAt : '',
      validatorId: value?.validatorId === CONTROL_VALIDATOR_ID ? value.validatorId : '',
      checkedAt: Number.isFinite(Number(value?.checkedAt)) ? Number(value.checkedAt) : 0,
      validUntil: Number.isFinite(Number(value?.validUntil)) ? Number(value.validUntil) : 0,
    }
  }

  function normalizePendingRollback(value) {
    if (!value
      || !DATASET_PATTERN.test(value.fromDatasetVersion || '')
      || !DATASET_PATTERN.test(value.targetDatasetVersion || '')
      || !Number.isInteger(value.controlGeneration)
      || value.controlGeneration <= 0) return null
    const controlFingerprint = SHA_PATTERN.test(value.controlFingerprint || '') ? value.controlFingerprint : ''
    return {
      fromDatasetVersion: value.fromDatasetVersion,
      targetDatasetVersion: value.targetDatasetVersion,
      controlGeneration: value.controlGeneration,
      controlFingerprint,
    }
  }

  function structurallyVerifiedControl(control) {
    return control
      && control.generation > 0
      && SHA_PATTERN.test(control.fingerprint)
      && control.registryGeneration > 0
      && SHA_PATTERN.test(control.registrySha256)
      && Boolean(control.registryGeneratedAt)
      && control.validatorId === CONTROL_VALIDATOR_ID
      && control.checkedAt > 0
      && control.validUntil > control.checkedAt
      && control.validUntil <= control.checkedAt + MAX_VALIDATION_RECEIPT_MS
      && hasIdentityForEvery(control.revokedDatasetEntries, control.revokedDatasetVersions, 'dataset_version')
      && hasIdentityForEvery(control.revokedSourceDatasetEntries, control.revokedSourceDatasetVersions, 'source_dataset_version')
  }

  function mergeRevocationKnowledge(left, right) {
    const mergeEntries = (first, second, versionField) => {
      const entries = new Map(first.map((entry) => [entry[versionField], entry]))
      for (const entry of second) if (!entries.has(entry[versionField])) entries.set(entry[versionField], entry)
      return [...entries.values()]
    }
    return normalizeControl({
      revokedDatasetVersions: [...left.revokedDatasetVersions, ...right.revokedDatasetVersions],
      revokedSourceDatasetVersions: [...left.revokedSourceDatasetVersions, ...right.revokedSourceDatasetVersions],
      revokedDatasetEntries: mergeEntries(left.revokedDatasetEntries, right.revokedDatasetEntries, 'dataset_version'),
      revokedSourceDatasetEntries: mergeEntries(left.revokedSourceDatasetEntries, right.revokedSourceDatasetEntries, 'source_dataset_version'),
    })
  }

  function normalizeState(value) {
    const state = emptyState()
    if (!value || ![1, 2, STATE_SCHEMA_VERSION].includes(value.stateSchemaVersion)) return state
    if (['idle', 'active', 'pending-rollback'].includes(value.status)) state.status = value.status
    const normalizePointer = (pointer) => pointer
      && DATASET_PATTERN.test(pointer.datasetVersion || '')
      && SHA_PATTERN.test(pointer.manifestSha256 || '')
      && pointer.current
      ? clone(pointer)
      : null
    state.active = normalizePointer(value.active)
    state.fallback = normalizePointer(value.fallback)
    if (state.active?.datasetVersion === state.fallback?.datasetVersion) state.fallback = null
    state.control = normalizeControl(value.control)
    state.schedule = {
      dataNextCheckAt: Number.isFinite(Number(value.schedule?.dataNextCheckAt)) ? Number(value.schedule.dataNextCheckAt) : 0,
      controlNextCheckAt: Number.isFinite(Number(value.schedule?.controlNextCheckAt)) ? Number(value.schedule.controlNextCheckAt) : 0,
      errorCode: String(value.schedule?.errorCode || '').slice(0, 120),
    }
    state.pendingRollback = normalizePendingRollback(value.pendingRollback)
    if (state.status === 'active' && !state.active) state.status = 'idle'
    if (state.status === 'pending-rollback' && !state.pendingRollback) state.status = 'idle'
    state.cacheDirectories = uniqueDatasetVersions([state.active?.datasetVersion, state.fallback?.datasetVersion])
    return state
  }

  function loadState() {
    let state
    try {
      const current = wxApi?.getStorageSync?.(STATE_KEY)
      if ([1, 2, STATE_SCHEMA_VERSION].includes(current?.stateSchemaVersion)) {
        state = normalizeState(current)
      } else {
        const legacyPointer = wxApi?.getStorageSync?.(POINTER_KEY)
        const legacySchedule = wxApi?.getStorageSync?.(CHECK_KEY)
        const legacySources = wxApi?.getStorageSync?.(REVOKED_SOURCES_KEY)
        state = emptyState()
        if (legacyPointer && DATASET_PATTERN.test(legacyPointer.datasetVersion || '') && SHA_PATTERN.test(legacyPointer.manifestSha256 || '')) {
          state.active = clone(legacyPointer)
          state.status = 'active'
        }
        state.control.revokedSourceDatasetVersions = uniqueDatasetVersions(legacySources)
        state.schedule.dataNextCheckAt = Number(legacySchedule?.nextCheckAt) || 0
        state.schedule.errorCode = String(legacySchedule?.errorCode || '').slice(0, 120)
      }
    } catch (_) {
      state = emptyState()
    }
    let tombstone = null
    try {
      tombstone = wxApi?.getStorageSync?.(CONTROL_TOMBSTONE_KEY)
      if (tombstone !== undefined && tombstone !== null && tombstone !== '') {
        assert(tombstone.schemaVersion === 1, 'stored control tombstone schema is invalid')
        assert(SHA_PATTERN.test(tombstone.integritySha256 || '')
          && tombstone.integritySha256 === fingerprint({
            schemaVersion: tombstone.schemaVersion,
            control: tombstone.control,
            pendingRollback: tombstone.pendingRollback || null,
          }), 'stored control tombstone integrity is invalid')
        const control = normalizeControl(tombstone.control)
        const pendingRollback = normalizePendingRollback(tombstone.pendingRollback)
        if (!control.validatorId) {
          state.control = mergeRevocationKnowledge(state.control, control)
          state.status = 'idle'
          state.active = null
          state.fallback = null
          state.pendingRollback = null
          return state
        }
        assert(structurallyVerifiedControl(control), 'stored control tombstone is invalid')
        assert(!tombstone.pendingRollback || (pendingRollback
          && pendingRollback.controlGeneration === control.generation
          && pendingRollback.controlFingerprint === control.fingerprint), 'stored rollback tombstone is invalid')
        const stateControl = state.control
        const stateIsNewerOrEqual = stateControl.generation >= control.generation
          && stateControl.registryGeneration >= control.registryGeneration
        const tombstoneIsNewerOrEqual = control.generation >= stateControl.generation
          && control.registryGeneration >= stateControl.registryGeneration
        assert(stateIsNewerOrEqual || tombstoneIsNewerOrEqual, 'stored control generations are incomparable')
        if (stateIsNewerOrEqual && (stateControl.generation > control.generation || stateControl.registryGeneration > control.registryGeneration)) {
          assert(structurallyVerifiedControl(stateControl), 'newer stored main control is invalid')
          assert(containsEvery(stateControl.revokedDatasetVersions, control.revokedDatasetVersions), 'stored main control removed a dataset revocation')
          assert(containsEvery(stateControl.revokedSourceDatasetVersions, control.revokedSourceDatasetVersions), 'stored main control removed a source revocation')
          assertImmutableEntries(stateControl.revokedDatasetEntries, control.revokedDatasetEntries, 'dataset_version', 'dataset')
          assertImmutableEntries(stateControl.revokedSourceDatasetEntries, control.revokedSourceDatasetEntries, 'source_dataset_version', 'source')
        } else {
          assert(containsEvery(control.revokedDatasetVersions, stateControl.revokedDatasetVersions), 'stored control tombstone removed a dataset revocation')
          assert(containsEvery(control.revokedSourceDatasetVersions, stateControl.revokedSourceDatasetVersions), 'stored control tombstone removed a source revocation')
          assertImmutableEntries(control.revokedDatasetEntries, stateControl.revokedDatasetEntries, 'dataset_version', 'dataset')
          assertImmutableEntries(control.revokedSourceDatasetEntries, stateControl.revokedSourceDatasetEntries, 'source_dataset_version', 'source')
          if (control.generation === stateControl.generation && stateControl.generation > 0) {
            assert(control.fingerprint === stateControl.fingerprint, 'stored control identity differs at the same generation')
          }
          if (control.registryGeneration === stateControl.registryGeneration && stateControl.registryGeneration > 0) {
            assert(control.registrySha256 === stateControl.registrySha256, 'stored revocations differ at the same generation')
          }
          const targetAlreadyActive = state.status === 'active'
            && state.active?.datasetVersion === pendingRollback?.targetDatasetVersion
            && stateControl.generation === control.generation
            && stateControl.fingerprint === control.fingerprint
          state.control = control
          if (pendingRollback && !targetAlreadyActive) {
            state.status = 'pending-rollback'
            state.active = null
            state.pendingRollback = pendingRollback
          }
        }
      }
    } catch (error) {
      console.error('[data:update] stored control tombstone rejected', error)
      controlRecoveryError = error
      const tombstoneControl = normalizeControl(tombstone?.control)
      state.control = mergeRevocationKnowledge(state.control, tombstoneControl)
    }
    return state
  }

  let localState = loadState()

  function persistState(next) {
    const normalized = normalizeState(next)
    wxApi?.setStorageSync?.(STATE_KEY, normalized)
    localState = normalized
    try {
      wxApi?.removeStorageSync?.(POINTER_KEY)
      wxApi?.removeStorageSync?.(CHECK_KEY)
      wxApi?.removeStorageSync?.(REVOKED_SOURCES_KEY)
    } catch (_) {}
    return localState
  }

  function getRevokedSources() {
    return localState.control.revokedSourceDatasetVersions
  }

  function getRevokedDatasets() {
    return localState.control.revokedDatasetVersions
  }

  function controlIsTrusted(control = localState.control) {
    return controlWasVerified(control)
      && control.validUntil > now()
  }

  function controlWasVerified(control = localState.control) {
    return !controlRecoveryError && structurallyVerifiedControl(control)
  }

  function storedRegistry(control = localState.control) {
    if (!control.registryGeneratedAt || control.registryGeneration <= 0) return null
    return {
      registry_schema_version: REGISTRY_SCHEMA_VERSION,
      generation: control.registryGeneration,
      generated_at: control.registryGeneratedAt,
      revoked_dataset_versions: control.revokedDatasetEntries.map(clone),
      revoked_source_dataset_versions: control.revokedSourceDatasetEntries.map(clone),
    }
  }

  function activateSafeFallback(control = localState.control, unavailableReason = 'known-revoked-source-has-no-valid-cache') {
    if (controlRecoveryError) {
      activeSnapshot = unavailableSnapshot(bundled, 'stored-control-state-invalid')
      activeSource = 'unavailable'
      activeManifest = null
      activeRevisionManifest = null
      cachedCityIds = []
      return
    }
    if (controlWasVerified(control) && localState.fallback) {
      try {
        useCachedPointer(localState.fallback, control)
        return
      } catch (error) {
        console.error('[data:update] cached safe fallback rejected', error)
      }
    }
    if (bundledValidationError) {
      activeSnapshot = unavailableSnapshot(bundled, 'bundled-data-invalid')
      activeSource = 'unavailable'
      activeManifest = null
      activeRevisionManifest = null
      cachedCityIds = []
      return
    }
    const bundledRevoked = control.revokedSourceDatasetVersions.includes(bundled.sourceDatasetVersion)
      || control.revokedDatasetVersions.includes(bundled.datasetVersion)
    activeSnapshot = bundledRevoked ? unavailableSnapshot(bundled, 'known-revoked-source-has-no-valid-cache') : bundled
    activeSource = bundledRevoked ? 'unavailable' : 'bundled'
    activeManifest = null
    activeRevisionManifest = null
    cachedCityIds = []
  }

  function versionRoot(datasetVersion) {
    assert(DATASET_PATTERN.test(datasetVersion), 'unsafe cache dataset version')
    return `${userRoot}/${datasetVersion}`
  }

  function temporaryRoot(datasetVersion) {
    assert(DATASET_PATTERN.test(datasetVersion), 'unsafe temporary cache dataset version')
    return `${userRoot}/.tmp-${datasetVersion}`
  }

  function readSync(path) {
    return fs.readFileSync(path, 'utf8')
  }

  function fileHash(text) {
    return sha256(utf8Bytes(text))
  }

  function removeDirectorySync(path) {
    if (!fs || typeof fs.rmdirSync !== 'function') return false
    try {
      fs.rmdirSync(path, true)
      return true
    } catch (error) {
      if (/ENOENT|not found|no such/i.test(String(error?.errMsg || error?.message || error))) return true
      return false
    }
  }

  function cleanupOrphanCaches(state = localState) {
    if (!fs || !userRoot || typeof fs.readdirSync !== 'function') return false
    const keep = new Set([state.active?.datasetVersion, state.fallback?.datasetVersion].filter(Boolean))
    let entries = []
    try { entries = fs.readdirSync(userRoot) || [] } catch (_) { return false }
    let removed = true
    for (const name of entries) {
      const temporary = /^\.tmp-(20\d{2}-(?:0[1-9]|1[0-2])-[a-f0-9]{12})$/.test(name)
      const version = DATASET_PATTERN.test(name)
      if ((temporary || version) && !keep.has(name)) removed = removeDirectorySync(`${userRoot}/${name}`) && removed
    }
    return removed
  }

  function invalidateCachedRelease(datasetVersion) {
    if (!fs || !userRoot || !DATASET_PATTERN.test(datasetVersion || '')) return true
    const manifestPath = `${versionRoot(datasetVersion)}/manifest.json`
    if (typeof fs.unlinkSync === 'function') {
      try {
        fs.unlinkSync(manifestPath)
        return true
      } catch (error) {
        if (/ENOENT|not found|no such/i.test(String(error?.errMsg || error?.message || error))) return true
      }
    }
    if (typeof fs.writeFileSync === 'function') {
      try {
        fs.writeFileSync(manifestPath, '', 'utf8')
        return true
      } catch (_) {}
    }
    return false
  }

  function persistedRollbackAuthorized(current, control = localState.control) {
    if (current.transition_type !== 'rollback') return false
    const entry = control.revokedDatasetEntries.find((item) => item.dataset_version === current.rollback_from_dataset_version)
    return entry?.replacement_dataset_version === current.dataset_version
      && control.generation === current.control_generation
      && control.fingerprint === fingerprint(current)
      && control.registryGeneration === current.revocations_generation
      && control.registrySha256 === current.revocations_sha256
  }

  function readReleaseAtRoot(root, pointer, control = localState.control) {
    assert(controlWasVerified(control), 'cached data has no previously verified control state')
    assert(pointer && DATASET_PATTERN.test(pointer.datasetVersion || ''), 'cached pointer is invalid')
    assert(!control.revokedDatasetVersions.includes(pointer.datasetVersion), 'cached dataset has been revoked')
    const manifestText = readSync(`${root}/manifest.json`)
    assert(fileHash(manifestText) === pointer.manifestSha256, 'cached manifest hash mismatch')
    const current = validateCurrent(pointer.current, config, { allowLegacy: false })
    const isCurrentPointer = control.fingerprint === fingerprint(current)
    const rollbackAuthorized = isCurrentPointer && persistedRollbackAuthorized(current, control)
    if (isCurrentPointer && !rollbackAuthorized) validateRemoteMonth(current, bundled)
    const manifest = validateManifest(safeParse(manifestText), current, config, bundled.cityIds)
    assert(!control.revokedSourceDatasetVersions.includes(manifest.source_dataset_version), 'cached source has been revoked')
    if (isCompleteRemoteManifest(manifest)) {
      assert(manifest.release_type === 'monthly_update', 'cached complete remote release type is invalid')
      const snapshotText = readSync(`${root}/complete-snapshot.json`)
      assert(utf8Bytes(snapshotText).byteLength === manifest.complete_snapshot_bytes, 'cached complete snapshot size mismatch')
      assert(fileHash(snapshotText) === manifest.complete_snapshot_sha256, 'cached complete snapshot hash mismatch')
      const completeSnapshot = safeParse(snapshotText)
      validateCompleteSnapshot(completeSnapshot, {
        cityIds: bundled.cityIds,
        featuredCityIds: bundled.featuredCityIds,
        expectedMonthCount: config.completeRemoteMonthCount,
        expectedCoverageStart: completeCoverageStart(manifest.dataset_as_of, config.completeRemoteMonthCount),
      })
      validateCompleteSourceEvidence(manifest, completeSnapshot)
      assert(completeSnapshot.datasetVersion === manifest.dataset_version && completeSnapshot.sourceDatasetVersion === manifest.source_dataset_version && completeSnapshot.datasetAsOf === manifest.dataset_as_of, 'cached complete snapshot identity is invalid')
      if (isCurrentPointer) validateCurrent(current, config, { allowLegacy: false, requireContext: true, manifest, registry: storedRegistry(control) })
      return { snapshot: completeSnapshot, manifest, revisionManifest: null, cachedCityIds: [...completeSnapshot.cityIds] }
    }
    let revisionManifest = null
    if (manifest.release_type === 'historical_correction') {
      const revisionText = readSync(`${root}/revision-manifest.json`)
      assert(utf8Bytes(revisionText).byteLength === manifest.revision_manifest_bytes, 'cached revision manifest size mismatch')
      assert(fileHash(revisionText) === manifest.revision_manifest_sha256, 'cached revision manifest hash mismatch')
      revisionManifest = validateRevisionManifest(safeParse(revisionText), manifest)
    }
    if (!rollbackAuthorized) validateRemoteSource(current, manifest, bundled, revisionManifest)
    const registry = storedRegistry(control)
    if (isCurrentPointer) validateCurrent(current, config, { allowLegacy: false, requireContext: true, manifest, registry })
    const bootstrapText = readSync(`${root}/bootstrap.json`)
    assert(utf8Bytes(bootstrapText).byteLength === manifest.bootstrap_bytes, 'cached bootstrap size mismatch')
    assert(fileHash(bootstrapText) === manifest.bootstrap_sha256, 'cached bootstrap hash mismatch')
    const bootstrap = validateBootstrap(safeParse(bootstrapText), manifest, config, bundled.cityIds, bundled.featuredCityIds, current)
    for (const cityId of bootstrap.cityIds) {
      if (bootstrap.series[cityId]) continue
      const text = readSync(`${root}/cities/${cityId}.json`)
      assert(utf8Bytes(text).byteLength === manifest.city_files[cityId].bytes, `cached city size mismatch: ${cityId}`)
      assert(fileHash(text) === manifest.city_files[cityId].sha256, `cached city hash mismatch: ${cityId}`)
      bootstrap.series[cityId] = validateCityShard(safeParse(text), manifest, cityId, config).series
    }
    validateCompleteSnapshot(bootstrap, { cityIds: bundled.cityIds, featuredCityIds: bundled.featuredCityIds })
    return { snapshot: bootstrap, manifest, revisionManifest, cachedCityIds: [...bootstrap.cityIds] }
  }

  // The first validation after downloading a complete package must yield to
  // iOS AppService while reading and hashing the roughly 2 MB snapshot.
  async function readCompleteReleaseAtRootAsync(root, pointer, control = localState.control) {
    assert(controlWasVerified(control), 'cached data has no previously verified control state')
    assert(pointer && DATASET_PATTERN.test(pointer.datasetVersion || ''), 'cached pointer is invalid')
    assert(!control.revokedDatasetVersions.includes(pointer.datasetVersion), 'cached dataset has been revoked')
    const manifestText = await readFile(`${root}/manifest.json`, 'utf8')
    assert(fileHash(manifestText) === pointer.manifestSha256, 'cached manifest hash mismatch')
    const current = validateCurrent(pointer.current, config, { allowLegacy: false })
    const isCurrentPointer = control.fingerprint === fingerprint(current)
    const rollbackAuthorized = isCurrentPointer && persistedRollbackAuthorized(current, control)
    if (isCurrentPointer && !rollbackAuthorized) validateRemoteMonth(current, bundled)
    const manifest = validateManifest(safeParse(manifestText), current, config, bundled.cityIds)
    assert(!control.revokedSourceDatasetVersions.includes(manifest.source_dataset_version), 'cached source has been revoked')
    assert(isCompleteRemoteManifest(manifest), 'cached release is not a complete remote release')
    assert(manifest.release_type === 'monthly_update', 'cached complete remote release type is invalid')
    const snapshotText = await readFile(`${root}/complete-snapshot.json`, 'utf8')
    const snapshotBytes = utf8Bytes(snapshotText)
    diagnostic('cache-validation-snapshot-read', { bytes: snapshotBytes.byteLength })
    assert(snapshotBytes.byteLength === manifest.complete_snapshot_bytes, 'cached complete snapshot size mismatch')
    await yieldToAppService()
    const snapshotHash = await sha256Async(snapshotBytes, { yieldFn: yieldToAppService })
    assert(snapshotHash === manifest.complete_snapshot_sha256, 'cached complete snapshot hash mismatch')
    diagnostic('cache-validation-hash-ok', { bytes: snapshotBytes.byteLength })
    await yieldToAppService()
    const completeSnapshot = safeParse(snapshotText)
    diagnostic('cache-validation-parse-ok', { monthCount: completeSnapshot.months?.length })
    validateCompleteSnapshot(completeSnapshot, {
      cityIds: bundled.cityIds,
      featuredCityIds: bundled.featuredCityIds,
      expectedMonthCount: config.completeRemoteMonthCount,
      expectedCoverageStart: completeCoverageStart(manifest.dataset_as_of, config.completeRemoteMonthCount),
    })
    validateCompleteSourceEvidence(manifest, completeSnapshot)
    diagnostic('cache-validation-data-ok', { cityCount: completeSnapshot.cityIds?.length })
    assert(completeSnapshot.datasetVersion === manifest.dataset_version
      && completeSnapshot.sourceDatasetVersion === manifest.source_dataset_version
      && completeSnapshot.datasetAsOf === manifest.dataset_as_of, 'cached complete snapshot identity is invalid')
    if (isCurrentPointer) validateCurrent(current, config, { allowLegacy: false, requireContext: true, manifest, registry: storedRegistry(control) })
    return { snapshot: completeSnapshot, manifest, revisionManifest: null, cachedCityIds: [...completeSnapshot.cityIds] }
  }

  function readCachedPointer(pointer, control = localState.control) {
    return readReleaseAtRoot(versionRoot(pointer.datasetVersion), pointer, control)
  }

  function useCachedPointer(pointer, control = localState.control) {
    const cached = readCachedPointer(pointer, control)
    activeSnapshot = cached.snapshot
    activeSource = 'remote'
    activeManifest = cached.manifest
    activeRevisionManifest = cached.revisionManifest
    cachedCityIds = cached.cachedCityIds
    return true
  }

  function cachedPointerIsSupersededByBundled(pointer, control = localState.control) {
    if (!pointer || !controlWasVerified(control)) return false
    try {
      const manifestText = readSync(`${versionRoot(pointer.datasetVersion)}/manifest.json`)
      if (fileHash(manifestText) !== pointer.manifestSha256) return false
        return bundledSupersedesRemoteManifest(safeParse(manifestText), bundled, control, config)
    } catch (_) {
      return false
    }
  }

  function hydrateCache() {
    if (!fs || !wxApi?.getStorageSync || !userRoot || !controlWasVerified()) return false
    const active = cachedPointerIsSupersededByBundled(localState.active) ? null : localState.active
    const fallback = cachedPointerIsSupersededByBundled(localState.fallback) ? null : localState.fallback
    if (active !== localState.active || fallback !== localState.fallback) {
      persistState({ ...localState, status: active ? localState.status : 'idle', active, fallback })
      cleanupOrphanCaches()
    }
    if (localState.status !== 'pending-rollback') {
      try {
        if (localState.active && useCachedPointer(localState.active)) return true
      } catch (error) {
        console.error('[data:update] cached data rejected', error)
      }
    }
    try {
      if (!localState.fallback || !useCachedPointer(localState.fallback)) return false
      if (localState.status === 'pending-rollback') return true
      persistState({ ...localState, status: 'active', active: localState.fallback, fallback: null })
      cleanupOrphanCaches()
      return true
    } catch (error) {
      console.error('[data:update] cached fallback rejected', error)
      return false
    }
  }

  cleanupOrphanCaches()
  const cacheHydrated = hydrateCache()
  if (!cacheHydrated) activateSafeFallback()

  function getSchedule() {
    return localState.schedule
  }

  function saveSchedule(nextCheckAt, errorCode = '') {
    try {
      persistState({
        ...localState,
        schedule: { ...localState.schedule, dataNextCheckAt: nextCheckAt, errorCode },
      })
    } catch (_) {}
  }

  function saveControlCheck(nextCheckAt, errorCode = '') {
    try {
      persistState({
        ...localState,
        schedule: { ...localState.schedule, controlNextCheckAt: nextCheckAt, errorCode },
      })
    } catch (_) {}
  }

  function persistControlTombstone(control, pendingRollback = null) {
    const normalized = normalizeControl(control)
    const normalizedPending = normalizePendingRollback(pendingRollback)
    assert(structurallyVerifiedControl(normalized), 'verified control tombstone is invalid')
    assert(!pendingRollback || (normalizedPending
      && normalizedPending.controlGeneration === normalized.generation
      && normalizedPending.controlFingerprint === normalized.fingerprint), 'verified rollback tombstone is invalid')
    const tombstone = {
      schemaVersion: 1,
      control: normalized,
      pendingRollback: normalizedPending,
    }
    tombstone.integritySha256 = fingerprint(tombstone)
    wxApi?.setStorageSync?.(CONTROL_TOMBSTONE_KEY, tombstone)
    controlRecoveryError = null
  }

  function boundedNextCheck(value) {
    const parsed = Date.parse(value || '')
    if (!Number.isFinite(parsed)) return now() + config.failureRetryMs
    return Math.min(parsed, now() + config.maximumCheckDelayMs)
  }

  function settleWxRequest(invoke, request) {
    diagnostic('request-start', { request })
    return new Promise((resolve, reject) => {
      let settled = false
      const succeed = (value) => {
        if (settled) return
        settled = true
        diagnostic('request-success', { request })
        resolve(value)
      }
      const fail = (error) => {
        if (settled) return
        settled = true
        diagnostic('request-fail', { request, error: diagnosticError(error) })
        reject(error instanceof Error ? error : new Error(String(error?.errMsg || error || 'WeChat request failed')))
      }
      try {
        const request = invoke(succeed, fail)
        // Recent WeChat clients return a Promise even when callbacks are supplied.
        // Consume it so an iOS timeout reaches refresh() instead of becoming unhandled.
        if (request && typeof request.then === 'function') request.then(succeed, fail)
      } catch (error) {
        fail(error)
      }
    })
  }

  function callFunction(name) {
    return settleWxRequest((success, fail) => wxApi.cloud.callFunction({ name, data: {}, success, fail }), 'manifest-function')
  }

  function download(fileID, fileKind) {
    return settleWxRequest((success, fail) => wxApi.cloud.downloadFile({ fileID, success, fail }), `download:${fileKind}`)
  }

  function yieldToAppService() {
    return new Promise((resolve) => {
      if (typeof wxApi?.nextTick === 'function') return wxApi.nextTick(resolve)
      setTimeout(resolve, 0)
    })
  }

  function readFile(path, encoding) {
    return new Promise((resolve, reject) => fs.readFile({ filePath: path, encoding, success: ({ data }) => resolve(data), fail: reject }))
  }

  function writeFile(path, data) {
    return new Promise((resolve, reject) => fs.writeFile({ filePath: path, data, encoding: 'utf8', success: resolve, fail: reject }))
  }

  function mkdir(path) {
    return new Promise((resolve, reject) => fs.mkdir({ dirPath: path, recursive: true, success: resolve, fail: (error) => /exist/i.test(error?.errMsg || '') ? resolve() : reject(error) }))
  }

  function directoryExists(path) {
    if (typeof fs.access !== 'function') return Promise.resolve(null)
    return new Promise((resolve) => fs.access({
      path,
      success: () => resolve(true),
      // WeChat iOS may return only `access:fail` for an absent path. In either
      // case, the directory is not safe to remove and can be recreated below.
      fail: () => resolve(false),
    }))
  }

  async function removeDirectory(path) {
    const exists = await directoryExists(path)
    if (exists === false) return false
    if (typeof fs.rmdir !== 'function') return removeDirectorySync(path)
    return new Promise((resolve, reject) => fs.rmdir({
      dirPath: path,
      recursive: true,
      success: resolve,
      fail: (error) => /ENOENT|not found|no such/i.test(String(error?.errMsg || error?.message || error)) ? resolve() : reject(error),
    }))
  }

  function renameDirectory(oldPath, newPath) {
    return new Promise((resolve, reject) => fs.rename({ oldPath, newPath, success: resolve, fail: reject }))
  }

  async function downloadJson(fileID, expectedHash, expectedBytes, fileKind = 'remote-file') {
    diagnostic('download-start', { file: fileKind })
    const response = await download(fileID, fileKind)
    const text = await readFile(response.tempFilePath, 'utf8')
    const bytes = utf8Bytes(text)
    const size = bytes.byteLength
    diagnostic('download-received', { file: fileKind, bytes: size })
    if (Number.isInteger(expectedBytes)) assert(size === expectedBytes, `remote file size mismatch: ${fileID}`)
    const actualHash = size >= 128 * 1024
      ? await sha256Async(bytes, { yieldFn: yieldToAppService })
      : sha256(bytes)
    assert(actualHash === expectedHash, `remote file hash mismatch: ${fileID}`)
    diagnostic('download-hash-ok', { file: fileKind, bytes: size })
    return { text, data: safeParse(text), bytes: size }
  }

  function cityFileId(manifest, cityId) {
    return manifest.city_file_id_template.replace('{city_id}', cityId)
  }

  async function cacheRelease(current, manifestDownload, revisionDownload, bootstrapDownload, cityDownloads, cityIds) {
    const root = versionRoot(current.dataset_version)
    const tempRoot = temporaryRoot(current.dataset_version)
    const pointer = {
      datasetVersion: current.dataset_version,
      sourceDatasetVersion: current.source_dataset_version,
      manifestSha256: current.manifest_sha256,
      current,
      cachedCityIds: [...cityIds],
      verifiedAt: now(),
    }
    const revokedSourceDatasetVersions = revisionDownload
      ? uniqueDatasetVersions([...getRevokedSources(), ...revisionDownload.data.revoked_source_dataset_versions])
      : getRevokedSources()
    const previousState = localState
    let renamed = false
    try {
      await removeDirectory(tempRoot)
      await mkdir(`${tempRoot}/cities`)
      await writeFile(`${tempRoot}/manifest.json`, manifestDownload.text)
      if (revisionDownload) await writeFile(`${tempRoot}/revision-manifest.json`, revisionDownload.text)
      await writeFile(`${tempRoot}/bootstrap.json`, bootstrapDownload.text)
      await Promise.all(Object.entries(cityDownloads).map(([cityId, item]) => writeFile(`${tempRoot}/cities/${cityId}.json`, item.text)))
      readReleaseAtRoot(tempRoot, pointer, localState.control)

      await removeDirectory(root)
      await renameDirectory(tempRoot, root)
      renamed = true
      readReleaseAtRoot(root, pointer, localState.control)

      let fallback = null
      for (const candidate of [previousState.active, previousState.fallback]) {
        if (!candidate
          || candidate.datasetVersion === pointer.datasetVersion
          || getRevokedDatasets().includes(candidate.datasetVersion)
          || getRevokedSources().includes(candidate.sourceDatasetVersion || candidate.current?.source_dataset_version)) continue
        try {
          readCachedPointer(candidate, localState.control)
          fallback = candidate
          break
        } catch (_) {}
      }
      persistState({
        ...localState,
        status: 'active',
        active: pointer,
        fallback,
        pendingRollback: null,
        control: { ...localState.control, revokedSourceDatasetVersions },
      })
      cleanupOrphanCaches()
    } catch (error) {
      await removeDirectory(tempRoot).catch(() => {})
      if (renamed && previousState.active?.datasetVersion !== current.dataset_version && previousState.fallback?.datasetVersion !== current.dataset_version) {
        await removeDirectory(root).catch(() => {})
      }
      throw error
    }
  }

  async function cacheCompleteRelease(current, manifestDownload, completeSnapshotDownload) {
    const root = versionRoot(current.dataset_version)
    const tempRoot = temporaryRoot(current.dataset_version)
    const pointer = {
      datasetVersion: current.dataset_version,
      sourceDatasetVersion: current.source_dataset_version,
      manifestSha256: current.manifest_sha256,
      current,
      cachedCityIds: [...completeSnapshotDownload.data.cityIds],
      verifiedAt: now(),
    }
    const previousState = localState
    let renamed = false
    let cacheStep = 'remove-temporary-directory'
    try {
      diagnostic('cache-step-start', { step: cacheStep })
      await removeDirectory(tempRoot)
      diagnostic('cache-step-ok', { step: cacheStep })
      cacheStep = 'create-temporary-directory'
      diagnostic('cache-step-start', { step: cacheStep })
      await mkdir(tempRoot)
      diagnostic('cache-step-ok', { step: cacheStep })
      cacheStep = 'write-manifest'
      diagnostic('cache-step-start', { step: cacheStep })
      await writeFile(`${tempRoot}/manifest.json`, manifestDownload.text)
      diagnostic('cache-step-ok', { step: cacheStep })
      cacheStep = 'write-complete-snapshot'
      diagnostic('cache-step-start', { step: cacheStep })
      await writeFile(`${tempRoot}/complete-snapshot.json`, completeSnapshotDownload.text)
      diagnostic('cache-step-ok', { step: cacheStep })
      cacheStep = 'validate-temporary-release'
      diagnostic('cache-step-start', { step: cacheStep })
      await readCompleteReleaseAtRootAsync(tempRoot, pointer, localState.control)
      diagnostic('cache-step-ok', { step: cacheStep })

      cacheStep = 'remove-old-release-directory'
      diagnostic('cache-step-start', { step: cacheStep })
      await removeDirectory(root)
      diagnostic('cache-step-ok', { step: cacheStep })
      cacheStep = 'rename-temporary-directory'
      diagnostic('cache-step-start', { step: cacheStep })
      await renameDirectory(tempRoot, root)
      renamed = true
      diagnostic('cache-step-ok', { step: cacheStep })
      cacheStep = 'validate-active-release'
      diagnostic('cache-step-start', { step: cacheStep })
      await readCompleteReleaseAtRootAsync(root, pointer, localState.control)
      diagnostic('cache-step-ok', { step: cacheStep })

      cacheStep = 'persist-active-pointer'
      diagnostic('cache-step-start', { step: cacheStep })
      let fallback = null
      for (const candidate of [previousState.active, previousState.fallback]) {
        if (!candidate
          || candidate.datasetVersion === pointer.datasetVersion
          || getRevokedDatasets().includes(candidate.datasetVersion)
          || getRevokedSources().includes(candidate.sourceDatasetVersion || candidate.current?.source_dataset_version)) continue
        try {
          readCachedPointer(candidate, localState.control)
          fallback = candidate
          break
        } catch (_) {}
      }
      persistState({ ...localState, status: 'active', active: pointer, fallback, pendingRollback: null })
      diagnostic('cache-step-ok', { step: cacheStep })
      cleanupOrphanCaches()
    } catch (error) {
      diagnostic('cache-step-failed', { step: cacheStep, error: diagnosticError(error) })
      await removeDirectory(tempRoot).catch(() => {})
      if (renamed && previousState.active?.datasetVersion !== current.dataset_version && previousState.fallback?.datasetVersion !== current.dataset_version) {
        await removeDirectory(root).catch(() => {})
      }
      throw error
    }
  }

  function currentHasControl(current) {
    return current.control_schema_version === CONTROL_SCHEMA_VERSION
  }

  function containsEvery(values, required) {
    const available = new Set(values)
    return required.every((value) => available.has(value))
  }

  function hasIdentityForEvery(entries, versions, versionField) {
    const identities = new Set(entries.map((entry) => entry[versionField]))
    return versions.every((version) => identities.has(version))
  }

  function assertImmutableEntries(incomingEntries, previousEntries, versionField, label) {
    const incoming = new Map(incomingEntries.map((entry) => [entry[versionField], fingerprint(entry)]))
    for (const entry of previousEntries) {
      assert(incoming.get(entry[versionField]) === fingerprint(entry), `remote control rewrote a ${label} revocation entry`)
    }
  }

  async function applyRemoteControl(current, validationReceipt) {
    assert(currentHasControl(current), 'legacy remote control is not trusted')
    const receipt = validateValidationReceipt(validationReceipt, current, now())
    diagnostic('registry-download-start', { datasetVersion: current.dataset_version })
    const registryDownload = await downloadJson(current.revocations_file_id, current.revocations_sha256, undefined, 'revocations-registry')
    const validated = validateRevocationsRegistry(registryDownload.data, current)
    diagnostic('registry-ok', { generation: current.revocations_generation })
    const previousControl = localState.control
    const incomingFingerprint = fingerprint(current)
    assert(current.control_generation >= previousControl.generation, 'remote control generation moved backwards')
    assert(current.revocations_generation >= previousControl.registryGeneration, 'remote revocations generation moved backwards')
    assert(containsEvery(validated.revokedDatasetVersions, previousControl.revokedDatasetVersions), 'remote control removed a dataset revocation')
    assert(containsEvery(validated.revokedSourceDatasetVersions, previousControl.revokedSourceDatasetVersions), 'remote control removed a source revocation')
    if (current.revocations_generation === previousControl.registryGeneration && previousControl.registryGeneration > 0) {
      assert(current.revocations_sha256 === previousControl.registrySha256, 'remote revocations changed without increasing their generation')
    }
    if (current.control_generation === previousControl.generation && previousControl.generation > 0) {
      assert(incomingFingerprint === previousControl.fingerprint, 'remote control changed without increasing its generation')
      assert(current.revocations_generation === previousControl.registryGeneration, 'remote revocations changed without increasing control generation')
    }
    const previousIdentityComplete = hasIdentityForEvery(previousControl.revokedDatasetEntries, previousControl.revokedDatasetVersions, 'dataset_version')
      && hasIdentityForEvery(previousControl.revokedSourceDatasetEntries, previousControl.revokedSourceDatasetVersions, 'source_dataset_version')
    if (previousControl.registryGeneration > 0 && !previousIdentityComplete) {
      assert(current.revocations_generation === previousControl.registryGeneration
        && current.revocations_sha256 === previousControl.registrySha256, 'remote revocation identities are missing for a newer registry')
    } else {
      assertImmutableEntries(validated.revokedDatasetEntries, previousControl.revokedDatasetEntries, 'dataset_version', 'dataset')
      assertImmutableEntries(validated.revokedSourceDatasetEntries, previousControl.revokedSourceDatasetEntries, 'source_dataset_version', 'source')
    }

    const priorDatasetVersion = localState.active?.datasetVersion
      || localState.pendingRollback?.fromDatasetVersion
      || (activeSource === 'remote' ? activeSnapshot.datasetVersion : null)
      || bundled.datasetVersion
    const priorSourceVersion = activeManifest?.source_dataset_version
      || bundled.sourceDatasetVersion
    const datasetRevoked = Boolean(priorDatasetVersion && validated.revokedDatasetVersions.includes(priorDatasetVersion))
    const sourceRevoked = Boolean(priorSourceVersion && validated.revokedSourceDatasetVersions.includes(priorSourceVersion))
    const activeWasRevoked = datasetRevoked || sourceRevoked
    const pendingMatches = localState.status === 'pending-rollback'
      && localState.pendingRollback?.fromDatasetVersion === current.rollback_from_dataset_version
      && localState.pendingRollback?.targetDatasetVersion === current.dataset_version
      && incomingFingerprint === previousControl.fingerprint
    const rollbackEntry = validated.revokedDatasetEntries.find((entry) => entry.dataset_version === current.rollback_from_dataset_version)
    const rollbackBindingValid = rollbackEntry?.replacement_dataset_version === current.dataset_version
    const sameVerifiedControl = current.control_generation === previousControl.generation
      && incomingFingerprint === previousControl.fingerprint
      && current.revocations_generation === previousControl.registryGeneration
      && current.revocations_sha256 === previousControl.registrySha256
    const rollbackAlreadyApplied = localState.status === 'active'
      && localState.active?.datasetVersion === current.dataset_version
      && sameVerifiedControl
    const durablePendingRecovery = localState.status === 'active'
      && localState.active?.datasetVersion === current.rollback_from_dataset_version
      && activeWasRevoked
      && sameVerifiedControl
    const freshRollback = previousControl.generation === 0
      && localState.status === 'idle'
      && !localState.active
      && activeSource !== 'remote'
    const authorizedRollback = current.transition_type === 'rollback'
      && rollbackBindingValid
      && ((current.rollback_from_dataset_version === priorDatasetVersion
        && (current.control_generation > previousControl.generation || pendingMatches))
        || rollbackAlreadyApplied
        || durablePendingRecovery
        || freshRollback)

    const nextControl = {
      generation: current.control_generation,
      fingerprint: incomingFingerprint,
      registryGeneration: current.revocations_generation,
      registrySha256: current.revocations_sha256,
      revokedDatasetVersions: validated.revokedDatasetVersions,
      revokedSourceDatasetVersions: validated.revokedSourceDatasetVersions,
      revokedDatasetEntries: validated.revokedDatasetEntries,
      revokedSourceDatasetEntries: validated.revokedSourceDatasetEntries,
      registryGeneratedAt: validated.registry.generated_at,
      validatorId: CONTROL_VALIDATOR_ID,
      checkedAt: receipt.validatedAt,
      validUntil: receipt.validUntil,
    }
    if (activeWasRevoked) {
      const rollbackOriginDatasetVersion = current.transition_type === 'rollback' && authorizedRollback
        ? current.rollback_from_dataset_version
        : priorDatasetVersion
      const pendingRollback = {
        fromDatasetVersion: rollbackOriginDatasetVersion,
        targetDatasetVersion: current.dataset_version,
        controlGeneration: current.control_generation,
        controlFingerprint: incomingFingerprint,
      }
      const pendingState = {
        ...localState,
        status: 'pending-rollback',
        active: null,
        fallback: localState.fallback
          && !validated.revokedDatasetVersions.includes(localState.fallback.datasetVersion)
          && !validated.revokedSourceDatasetVersions.includes(localState.fallback.sourceDatasetVersion || localState.fallback.current?.source_dataset_version)
          ? localState.fallback
          : null,
        control: nextControl,
        pendingRollback,
      }
      const invalidated = localState.active?.datasetVersion === priorDatasetVersion
        ? invalidateCachedRelease(priorDatasetVersion)
        : true
      localState = normalizeState(pendingState)
      activateSafeFallback(nextControl)
      let tombstoneError = null
      try {
        persistControlTombstone(nextControl, pendingRollback)
      } catch (error) {
        tombstoneError = error
      }
      if (activeSource === 'unavailable') activateSafeFallback(nextControl)
      let stateError = null
      try {
        persistState(pendingState)
      } catch (error) {
        stateError = error
      }
      if (tombstoneError || stateError) {
        if (tombstoneError && stateError && !invalidated) {
          let stateRemoved = false
          try {
            wxApi?.removeStorageSync?.(STATE_KEY)
            stateRemoved = true
          } catch (_) {}
          if (!stateRemoved) {
            const failClosedError = new Error(`revoked cache could not be durably disabled: ${stateError?.message || tombstoneError?.message}`)
            failClosedError.cause = stateError || tombstoneError
            throw failClosedError
          }
        }
        if (tombstoneError && stateError) {
          const persistenceError = new Error(`revocation persistence failed: ${tombstoneError.message}; ${stateError.message}`)
          persistenceError.cause = stateError
          throw persistenceError
        }
        throw tombstoneError || stateError
      }
    } else {
      persistControlTombstone(nextControl)
      const active = receipt.activationAuthorized && localState.active?.datasetVersion === current.dataset_version
        ? { ...localState.active, current, sourceDatasetVersion: current.source_dataset_version }
        : localState.active
      persistState({ ...localState, active, control: nextControl })
      if (activeSource === 'unavailable') activateSafeFallback(nextControl)
    }
    return {
      activationAuthorized: receipt.activationAuthorized,
      authorizedRollback,
      activeWasRevoked,
      priorDatasetVersion,
      registry: validated.registry,
    }
  }

  async function refresh({ requiredCityIds = [], force = false } = {}) {
    if (!config.enabled || !wxApi?.cloud || !fs) return { updated: false, source: activeSource, reason: 'disabled' }
    const schedule = getSchedule()
    const controlDue = !controlIsTrusted() || localState.status === 'pending-rollback' || Number(schedule?.controlNextCheckAt) <= now()
    const dataDue = Number(schedule?.dataNextCheckAt) <= now()
    if (!force && !controlDue && !dataDue) return { updated: false, source: activeSource, reason: 'not-due' }
    const sourceBefore = activeSource
    const snapshotBefore = activeSnapshot
    let activeWasRevoked = false
    let stage = 'refresh-start'
    diagnostic(stage, { force: Boolean(force), requiredCityCount: requiredCityIds.length, source: sourceBefore })
    try {
      const activeDatasetAsOfBeforeControl = localState.active?.datasetVersion?.slice(0, 7)
        || localState.pendingRollback?.fromDatasetVersion?.slice(0, 7)
        || activeSnapshot.datasetAsOf
      const activeSourceVersionBeforeControl = activeManifest?.source_dataset_version || bundled.sourceDatasetVersion
      stage = 'manifest-function-start'
      diagnostic(stage)
      const response = await callFunction(config.manifestFunctionName)
      const current = validateCurrent(response?.result?.current, config, { allowLegacy: false })
      diagnostic('manifest-function-ok', { datasetVersion: current.dataset_version, datasetAsOf: current.dataset_as_of })
      stage = 'control-start'
      diagnostic(stage, { datasetVersion: current.dataset_version })
      const control = await applyRemoteControl(current, response?.result?.validation_receipt)
      activeWasRevoked = control.activeWasRevoked
      diagnostic('control-ok', { activationAuthorized: control.activationAuthorized, activeWasRevoked })
      if (current.transition_type === 'rollback') assert(control.authorizedRollback, 'remote rollback target is not authorized')
      saveControlCheck(now() + (config.controlCheckIntervalMs || 15 * 60 * 1000))
      const remoteUnchanged = activeSource === 'remote'
        && localState.active?.datasetVersion === current.dataset_version
        && activeSnapshot.datasetVersion === current.dataset_version
      const remoteNextCheck = Date.parse(current.next_check_at)
      saveSchedule(remoteUnchanged && remoteNextCheck <= now()
        ? now() + config.releaseRetryMs
        : boundedNextCheck(current.next_check_at))
      if (remoteUnchanged) return { updated: false, source: activeSource, reason: 'current' }
      if (!control.activationAuthorized) {
        return {
          updated: activeWasRevoked || sourceBefore !== activeSource || snapshotBefore !== activeSnapshot,
          source: activeSource,
          reason: 'activation-not-authorized',
        }
      }
      if (!control.authorizedRollback) validateRemoteMonth(current, bundled)
      if (current.dataset_as_of < activeDatasetAsOfBeforeControl) {
        assert(control.authorizedRollback, 'remote data is older than the active snapshot without an authorized rollback')
      }
      stage = 'manifest-download-start'
      diagnostic(stage, { datasetVersion: current.dataset_version })
      const manifestDownload = await downloadJson(current.manifest_file_id, current.manifest_sha256, undefined, 'manifest')
      const manifest = validateManifest(manifestDownload.data, current, config, bundled.cityIds)
      diagnostic('manifest-ok', { releaseType: manifest.release_type, monthCount: manifest.month_count })
      if (currentHasControl(current)) assert(manifest.source_dataset_version === current.source_dataset_version, 'remote current source differs from its manifest')
      assert(!getRevokedDatasets().includes(manifest.dataset_version), 'remote dataset has been revoked')
      assert(!getRevokedSources().includes(manifest.source_dataset_version), 'remote source has been revoked')
      let revisionDownload = null
      let revisionManifest = null
      if (manifest.release_type === 'historical_correction') {
        stage = 'revision-download-start'
        diagnostic(stage)
        revisionDownload = await downloadJson(manifest.revision_manifest_file_id, manifest.revision_manifest_sha256, manifest.revision_manifest_bytes, 'revision-manifest')
        revisionManifest = validateRevisionManifest(revisionDownload.data, manifest)
        diagnostic('revision-ok')
      }
      validateCurrent(current, config, {
        allowLegacy: false,
        requireContext: true,
        manifest,
        registry: control.registry,
      })
      if (activeSource === 'bundled' && bundledSupersedesRemoteManifest(manifest, bundled, localState.control, config)) {
        return { updated: false, source: activeSource, reason: 'bundled-source-is-newer' }
      }
      if (!control.authorizedRollback) {
        validateRemoteSource(current, manifest, bundled, revisionManifest, activeSourceVersionBeforeControl, activeDatasetAsOfBeforeControl)
      }
      if (isCompleteRemoteManifest(manifest)) {
        stage = 'complete-download-start'
        diagnostic(stage, { expectedBytes: manifest.complete_snapshot_bytes, expectedMonthCount: manifest.month_count })
        const completeSnapshotDownload = await downloadJson(
          manifest.complete_snapshot_file_id,
          manifest.complete_snapshot_sha256,
          manifest.complete_snapshot_bytes,
          'complete-snapshot',
        )
        diagnostic('complete-received', { bytes: completeSnapshotDownload.bytes })
        validateCompleteSnapshot(completeSnapshotDownload.data, {
          cityIds: bundled.cityIds,
          featuredCityIds: bundled.featuredCityIds,
          expectedMonthCount: config.completeRemoteMonthCount,
          expectedCoverageStart: completeCoverageStart(manifest.dataset_as_of, config.completeRemoteMonthCount),
        })
        validateCompleteSourceEvidence(manifest, completeSnapshotDownload.data)
        assert(completeSnapshotDownload.data.datasetVersion === manifest.dataset_version
          && completeSnapshotDownload.data.sourceDatasetVersion === manifest.source_dataset_version
          && completeSnapshotDownload.data.datasetAsOf === manifest.dataset_as_of, 'complete remote snapshot identity is invalid')
        diagnostic('complete-validated', { monthCount: completeSnapshotDownload.data.months.length, cityCount: completeSnapshotDownload.data.cityIds.length })
        stage = 'cache-start'
        diagnostic(stage, { datasetVersion: current.dataset_version })
        await cacheCompleteRelease(current, manifestDownload, completeSnapshotDownload)
        diagnostic('cache-ok', { datasetVersion: current.dataset_version })
        activeSnapshot = completeSnapshotDownload.data
        activeSource = 'remote'
        activeManifest = manifest
        activeRevisionManifest = null
        cachedCityIds = [...activeSnapshot.cityIds]
        diagnostic('activated-remote', { datasetVersion: activeSnapshot.datasetVersion, monthCount: activeSnapshot.months.length })
        return { updated: true, source: activeSource, datasetVersion: activeSnapshot.datasetVersion }
      }
      const bootstrapDownload = await downloadJson(manifest.bootstrap_file_id, manifest.bootstrap_sha256, manifest.bootstrap_bytes)
      const bootstrap = validateBootstrap(bootstrapDownload.data, manifest, config, bundled.cityIds, bundled.featuredCityIds, current)
      const cityIds = bootstrap.cityIds.filter((cityId) => !bootstrap.series[cityId])
      const cityDownloads = {}
      for (let offset = 0; offset < cityIds.length; offset += 8) {
        const batch = await Promise.all(cityIds.slice(offset, offset + 8).map(async (cityId) => {
          const file = manifest.city_files[cityId]
          const item = await downloadJson(cityFileId(manifest, cityId), file.sha256, file.bytes)
          validateCityShard(item.data, manifest, cityId, config)
          return [cityId, item]
        }))
        for (const [cityId, item] of batch) cityDownloads[cityId] = item
      }
      for (const [cityId, item] of Object.entries(cityDownloads)) bootstrap.series[cityId] = item.data.series
      validateCompleteSnapshot(bootstrap, { cityIds: bundled.cityIds, featuredCityIds: bundled.featuredCityIds })
      await cacheRelease(current, manifestDownload, revisionDownload, bootstrapDownload, cityDownloads, bootstrap.cityIds)
      activeSnapshot = bootstrap
      activeSource = 'remote'
      activeManifest = manifest
      activeRevisionManifest = revisionManifest
      cachedCityIds = [...bootstrap.cityIds]
      return { updated: true, source: activeSource, datasetVersion: activeSnapshot.datasetVersion }
    } catch (error) {
      diagnostic('refresh-failed', { failedStage: stage, error: diagnosticError(error) })
      console.error('[data:update] refresh failed', error)
      saveSchedule(now() + config.failureRetryMs, String(error?.message || 'remote-update-failed').slice(0, 120))
      saveControlCheck(now() + Math.min(config.failureRetryMs, config.controlCheckIntervalMs || 15 * 60 * 1000), String(error?.message || 'remote-control-failed').slice(0, 120))
      return { updated: activeWasRevoked || sourceBefore !== activeSource || snapshotBefore !== activeSnapshot, source: activeSource, reason: 'failed', error }
    }
  }

  async function ensureCities(cityIds) {
    const missing = [...new Set(cityIds)].filter((cityId) => activeSnapshot.cityMap[cityId] && !activeSnapshot.series[cityId])
    if (!missing.length) return true
    assert(activeSource === 'remote' && activeManifest, 'city data is unavailable')
    const root = versionRoot(activeSnapshot.datasetVersion)
    await mkdir(`${root}/cities`)
    for (const cityId of missing) {
      const file = activeManifest.city_files[cityId]
      let text
      try {
        text = readSync(`${root}/cities/${cityId}.json`)
        assert(fileHash(text) === file.sha256, `cached city hash mismatch: ${cityId}`)
      } catch (_) {
        const item = await downloadJson(cityFileId(activeManifest, cityId), file.sha256, file.bytes)
        text = item.text
        await writeFile(`${root}/cities/${cityId}.json`, text)
      }
      const shard = validateCityShard(safeParse(text), activeManifest, cityId, config)
      activeSnapshot.series[cityId] = shard.series
      if (!cachedCityIds.includes(cityId)) cachedCityIds.push(cityId)
    }
    if (localState.active) {
      persistState({
        ...localState,
        active: { ...localState.active, cachedCityIds: [...cachedCityIds] },
      })
    }
    return true
  }

  return {
    getSnapshot: () => activeSnapshot,
    getSource: () => activeSource,
    hasCity: (cityId) => Boolean(activeSnapshot.series?.[cityId]),
    refresh,
    ensureCities,
    clearRemoteCachePointer() {
      try {
        persistState({ ...localState, status: 'idle', active: null, fallback: null, pendingRollback: null })
        const removed = cleanupOrphanCaches()
        activateSafeFallback()
        return removed
      } catch (error) {
        console.error('[data:update] remote cache pointer clear failed', error)
        return false
      }
    },
  }
}

const runtime = createDataRuntime()
module.exports = {
  ...runtime,
  createDataRuntime,
  interpretAuditedLegacyBootstrap,
  validateCurrent,
  validateRevocationsRegistry,
  validateManifest,
  validateRevisionManifest,
  validateBootstrap,
  validateCityShard,
  validateValidationReceipt,
  STATE_KEY,
  CONTROL_TOMBSTONE_KEY,
  POINTER_KEY,
  CHECK_KEY,
  REVOKED_SOURCES_KEY,
}
