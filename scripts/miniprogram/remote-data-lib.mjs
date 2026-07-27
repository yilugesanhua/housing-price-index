import { createHash } from 'node:crypto'

export const REMOTE_FORMAT = 'housing-miniprogram-data'
export const REMOTE_SCHEMA_VERSION = '1.0.0'
export const SERIES_CODES = ['n_a', 'n_s', 'n_m', 'n_l', 'r_a', 'r_s', 'r_m', 'r_l']
export const SIZE_LIMITS = Object.freeze({
  current: 8 * 1024,
  manifest: 16 * 1024,
  bootstrap: 300 * 1024,
  city: 40 * 1024,
  release: 2 * 1024 * 1024,
})

export function stableJson(value) {
  return `${JSON.stringify(value)}\n`
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

export function validateBundledSnapshot(snapshot) {
  assert(snapshot && typeof snapshot === 'object', 'snapshot must be an object')
  assert(Array.isArray(snapshot.cityIds) && snapshot.cityIds.length === 70, 'snapshot must contain 70 cities')
  assert(new Set(snapshot.cityIds).size === 70, 'snapshot city IDs must be unique')
  assert(Array.isArray(snapshot.featuredCityIds) && snapshot.featuredCityIds.length === 6, 'snapshot must contain six featured cities')
  assert(Array.isArray(snapshot.months) && snapshot.months.length === 120, 'snapshot must contain 120 months')
  assert(snapshot.months.at(-1) === snapshot.datasetAsOf, 'snapshot latest month must match datasetAsOf')
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
  const series = Object.fromEntries(snapshot.featuredCityIds.map((cityId) => [cityId, clone(snapshot.series[cityId])]))
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
    datasetAsOf: snapshot.datasetAsOf,
    releaseDate: snapshot.releaseDate,
    coverageStart: snapshot.coverageStart,
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

export function buildRemoteRelease(snapshot, { cloudEnvId, storageBucket, minimumAppVersion, nextCheckAt, sourceBatchIds = [] }) {
  validateBundledSnapshot(snapshot)
  assert(/^cloud[\w-]+$/.test(cloudEnvId), 'invalid cloud environment ID')
  assert(/^[a-z0-9-]+$/.test(storageBucket), 'invalid cloud storage bucket')
  assert(/^v\d+\.\d+\.\d+$/.test(minimumAppVersion), 'invalid minimum app version')
  assert(Number.isFinite(Date.parse(nextCheckAt || '')), 'invalid client next check time')
  const batches = [...new Set(sourceBatchIds)].sort()
  const releaseHash = sha256(stableJson({
    sourceDatasetVersion: snapshot.datasetVersion,
    cloudEnvId,
    storageBucket,
    remoteFormat: REMOTE_FORMAT,
    remoteSchemaVersion: REMOTE_SCHEMA_VERSION,
    minimumAppVersion,
    nextCheckAt,
    sourceBatchIds: batches,
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
  const manifest = {
    format: REMOTE_FORMAT,
    remote_schema_version: REMOTE_SCHEMA_VERSION,
    schema_version: snapshot.schemaVersion,
    dataset_version: datasetVersion,
    source_dataset_version: snapshot.datasetVersion,
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
    source_batch_ids: batches,
    release_note: `更新国家统计局70城住宅价格指数至${snapshot.datasetAsOf}`,
  }
  const manifestText = stableJson(manifest)
  const current = {
    dataset_version: datasetVersion,
    dataset_as_of: snapshot.datasetAsOf,
    schema_version: snapshot.schemaVersion,
    manifest_file_id: `${releaseRoot}/manifest.json`,
    manifest_sha256: sha256(manifestText),
    published_at: null,
    previous_dataset_version: null,
    next_check_at: nextCheckAt,
  }
  const currentText = stableJson(current)
  const totalBytes = byteLength(bootstrapText) + byteLength(manifestText) + Object.values(cities).reduce((sum, item) => sum + item.bytes, 0)
  return { bootstrap, bootstrapText, cities, manifest, manifestText, current, currentText, totalBytes }
}

export function verifyReleaseAgainstSnapshot(snapshot, release) {
  validateBundledSnapshot(snapshot)
  const errors = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  check(release.bootstrap.remoteFormat === REMOTE_FORMAT, 'bootstrap format mismatch')
  check(release.bootstrap.remoteSchemaVersion === REMOTE_SCHEMA_VERSION, 'bootstrap remote schema mismatch')
  check(release.manifest.format === REMOTE_FORMAT, 'manifest format mismatch')
  check(release.manifest.dataset_as_of === snapshot.datasetAsOf, 'manifest dataset month mismatch')
  check(release.manifest.source_dataset_version === snapshot.datasetVersion, 'manifest source dataset version mismatch')
  check(release.current.dataset_version === release.manifest.dataset_version, 'current dataset version mismatch')
  check(release.bootstrap.datasetVersion === release.manifest.dataset_version, 'bootstrap dataset version mismatch')
  check(release.manifest.bootstrap_sha256 === sha256(release.bootstrapText), 'bootstrap SHA-256 mismatch')
  check(release.manifest.bootstrap_bytes === byteLength(release.bootstrapText), 'bootstrap byte size mismatch')
  check(release.current.manifest_sha256 === sha256(release.manifestText), 'manifest SHA-256 mismatch')
  check(byteLength(release.currentText) <= SIZE_LIMITS.current, 'current.json exceeds 8KB')
  check(byteLength(release.manifestText) <= SIZE_LIMITS.manifest, 'manifest.json exceeds 16KB')
  check(byteLength(release.bootstrapText) <= SIZE_LIMITS.bootstrap, 'bootstrap.json exceeds 300KB')
  check(release.totalBytes <= SIZE_LIMITS.release, 'remote release exceeds 2MB')
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
