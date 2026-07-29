const bundledSnapshot = require('../data/snapshot.js')
const dataConfig = require('../config/data.js')
const versionConfig = require('../config/version.js')
const { sha256, utf8Bytes } = require('./sha256.js')

const POINTER_KEY = 'housing-data-pointer-v4'
const CHECK_KEY = 'housing-data-check-v3'
const REVOKED_SOURCES_KEY = 'housing-data-revoked-sources-v1'
const DATASET_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/
const SHA_PATTERN = /^[a-f0-9]{64}$/
const SERIES_CODES = ['n_a', 'n_s', 'n_m', 'n_l', 'r_a', 'r_s', 'r_m', 'r_l']

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

function unavailableSnapshot(bundled) {
  const snapshot = clone(bundled)
  for (const cityId of snapshot.cityIds || []) {
    for (const code of SERIES_CODES) {
      if (Array.isArray(snapshot.series?.[cityId]?.[code])) snapshot.series[cityId][code] = snapshot.series[cityId][code].map(() => null)
      if (Array.isArray(snapshot.latestSeries?.[cityId]?.[code])) snapshot.latestSeries[cityId][code] = snapshot.latestSeries[cityId][code].map(() => null)
    }
  }
  for (const key of Object.keys(snapshot.breadthSeries || {})) snapshot.breadthSeries[key] = snapshot.breadthSeries[key].map(() => null)
  snapshot.dataStatus = 'unavailable'
  snapshot.statusReason = 'known-revoked-source-has-no-valid-cache'
  return snapshot
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function validateRemoteMonth(current, bundled) {
  assert(current.dataset_as_of >= bundled.datasetAsOf, 'remote data is older than the bundled snapshot')
}

function validateRemoteSource(current, manifest, bundled, revisionManifest = null, activeSourceVersion = bundled.datasetVersion, activeDatasetAsOf = bundled.datasetAsOf) {
  if (current.dataset_as_of > activeDatasetAsOf || manifest.source_dataset_version === activeSourceVersion) return
  assert(manifest.release_type === 'historical_correction' && revisionManifest, 'remote data conflicts with the bundled snapshot for the same month')
  const chain = revisionManifest.source_version_chain
  const activeIndex = chain.indexOf(activeSourceVersion)
  assert(activeIndex >= 0 && activeIndex < chain.length - 1, 'correction source chain does not supersede the active source')
  assert(chain.at(-1) === manifest.source_dataset_version, 'correction source chain does not end at the remote source')
}

function validateCurrent(current, config) {
  assert(current && DATASET_PATTERN.test(current.dataset_version || ''), 'remote current dataset version is invalid')
  assert(/^20\d{2}-(0[1-9]|1[0-2])$/.test(current.dataset_as_of || ''), 'remote current month is invalid')
  assert(major(current.schema_version) === config.remoteSchemaMajor, 'remote current schema is unsupported')
  const root = `cloud://${config.cloudEnvId}.${config.storageBucket}/housing-data/releases/${current.dataset_version}/`
  assert(current.manifest_file_id === `${root}manifest.json`, 'remote manifest path is invalid')
  assert(SHA_PATTERN.test(current.manifest_sha256 || ''), 'remote manifest hash is invalid')
  assert(Number.isFinite(Date.parse(current.next_check_at || '')), 'remote next check time is invalid')
  return current
}

function validateSeries(series, monthCount, label) {
  assert(series && Object.keys(series).length === SERIES_CODES.length, `${label} series codes are invalid`)
  for (const code of SERIES_CODES) assert(Array.isArray(series[code]) && series[code].length === monthCount * 4, `${label}/${code} length is invalid`)
}

function validateManifest(manifest, current, config) {
  assert(manifest?.format === config.remoteFormat, 'remote manifest format is invalid')
  assert(major(manifest.remote_schema_version) === config.remoteSchemaMajor, 'remote manifest schema is unsupported')
  assert(manifest.dataset_version === current.dataset_version && manifest.dataset_as_of === current.dataset_as_of, 'remote manifest version is inconsistent')
  assert(manifest.validation_status === 'passed', 'remote manifest has not passed validation')
  assert([undefined, 'monthly_update', 'historical_correction'].includes(manifest.release_type), 'remote release type is invalid')
  assert(compareVersions(versionConfig.version, manifest.minimum_app_version) >= 0, 'remote data requires a newer mini program version')
  assert(SHA_PATTERN.test(manifest.bootstrap_sha256 || '') && Number.isInteger(manifest.bootstrap_bytes), 'remote bootstrap metadata is invalid')
  const root = `cloud://${config.cloudEnvId}.${config.storageBucket}/housing-data/releases/${current.dataset_version}/`
  assert(manifest.bootstrap_file_id === `${root}bootstrap.json`, 'remote bootstrap path is invalid')
  assert(manifest.city_file_id_template === `${root}cities/{city_id}.json`, 'remote city path template is invalid')
  assert(manifest.city_files && Object.keys(manifest.city_files).length === 70, 'remote city manifest must contain 70 cities')
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

function validateBootstrap(bootstrap, manifest, config) {
  assert(bootstrap?.remoteFormat === config.remoteFormat, 'remote bootstrap format is invalid')
  assert(major(bootstrap.remoteSchemaVersion) === config.remoteSchemaMajor, 'remote bootstrap schema is unsupported')
  assert(bootstrap.datasetVersion === manifest.dataset_version && bootstrap.datasetAsOf === manifest.dataset_as_of, 'remote bootstrap version is inconsistent')
  assert(Array.isArray(bootstrap.cityIds) && bootstrap.cityIds.length === 70 && new Set(bootstrap.cityIds).size === 70, 'remote bootstrap city IDs are invalid')
  assert(Array.isArray(bootstrap.featuredCityIds) && bootstrap.featuredCityIds.length === 6, 'remote bootstrap featured cities are invalid')
  assert(Array.isArray(bootstrap.months) && bootstrap.months.length === 120 && bootstrap.months.at(-1) === bootstrap.datasetAsOf, 'remote bootstrap months are invalid')
  assert(Array.isArray(bootstrap.releaseDates) && bootstrap.releaseDates.length === 120, 'remote release dates are invalid')
  for (const cityId of bootstrap.cityIds) {
    assert(bootstrap.cityMap?.[cityId], `remote city profile is missing: ${cityId}`)
    assert(bootstrap.latestSeries?.[cityId], `remote latest values are missing: ${cityId}`)
    for (const code of SERIES_CODES) assert(Array.isArray(bootstrap.latestSeries[cityId][code]) && bootstrap.latestSeries[cityId][code].length === 4, `remote latest series is invalid: ${cityId}/${code}`)
  }
  for (const cityId of bootstrap.featuredCityIds) validateSeries(bootstrap.series?.[cityId], 120, cityId)
  for (const cityId of bootstrap.cityIds) {
    if (bootstrap.series?.[cityId]) validateSeries(bootstrap.series[cityId], 120, cityId)
  }
  for (const code of SERIES_CODES) {
    for (const metric of ['mom', 'yoy']) assert(Array.isArray(bootstrap.breadthSeries?.[`${code}_${metric}`]) && bootstrap.breadthSeries[`${code}_${metric}`].length === 480, `remote breadth series is invalid: ${code}/${metric}`)
  }
  return bootstrap
}

function validateCityShard(shard, manifest, cityId, config) {
  assert(shard?.remoteFormat === config.remoteFormat, `remote city format is invalid: ${cityId}`)
  assert(major(shard.remoteSchemaVersion) === config.remoteSchemaMajor, `remote city schema is unsupported: ${cityId}`)
  assert(shard.datasetVersion === manifest.dataset_version && shard.cityId === cityId, `remote city version is inconsistent: ${cityId}`)
  validateSeries(shard.series, 120, cityId)
  return shard
}

function createDataRuntime({ wxApi = typeof wx === 'undefined' ? null : wx, bundled = bundledSnapshot, config = dataConfig, now = () => Date.now() } = {}) {
  let activeSnapshot = bundled
  let activeSource = 'bundled'
  let activeManifest = null
  let activeRevisionManifest = null
  let cachedCityIds = []
  const fs = wxApi && typeof wxApi.getFileSystemManager === 'function' ? wxApi.getFileSystemManager() : null
  const userRoot = wxApi?.env?.USER_DATA_PATH ? `${wxApi.env.USER_DATA_PATH}/housing-data` : ''

  function versionRoot(datasetVersion) {
    assert(DATASET_PATTERN.test(datasetVersion), 'unsafe cache dataset version')
    return `${userRoot}/${datasetVersion}`
  }

  function readSync(path) {
    return fs.readFileSync(path, 'utf8')
  }

  function fileHash(text) {
    return sha256(utf8Bytes(text))
  }

  function getRevokedSources() {
    try {
      const value = wxApi?.getStorageSync?.(REVOKED_SOURCES_KEY)
      return Array.isArray(value) ? value.filter((item) => DATASET_PATTERN.test(item)) : []
    } catch (_) { return [] }
  }

  function hydrateCache() {
    if (!fs || !wxApi?.getStorageSync || !userRoot) return false
    try {
      const pointer = wxApi.getStorageSync(POINTER_KEY)
      if (!pointer || !DATASET_PATTERN.test(pointer.datasetVersion || '')) return false
      const root = versionRoot(pointer.datasetVersion)
      const manifestText = readSync(`${root}/manifest.json`)
      assert(fileHash(manifestText) === pointer.manifestSha256, 'cached manifest hash mismatch')
      const current = validateCurrent(pointer.current, config)
      validateRemoteMonth(current, bundled)
      const manifest = validateManifest(safeParse(manifestText), current, config)
      assert(!getRevokedSources().includes(manifest.source_dataset_version), 'cached source has been revoked')
      let revisionManifest = null
      if (manifest.release_type === 'historical_correction') {
        const revisionText = readSync(`${root}/revision-manifest.json`)
        assert(fileHash(revisionText) === manifest.revision_manifest_sha256, 'cached revision manifest hash mismatch')
        revisionManifest = validateRevisionManifest(safeParse(revisionText), manifest)
      }
      validateRemoteSource(current, manifest, bundled, revisionManifest)
      const bootstrapText = readSync(`${root}/bootstrap.json`)
      assert(fileHash(bootstrapText) === manifest.bootstrap_sha256, 'cached bootstrap hash mismatch')
      const bootstrap = validateBootstrap(safeParse(bootstrapText), manifest, config)
      const cities = []
      for (const cityId of pointer.cachedCityIds || []) {
        if (bootstrap.series[cityId]) continue
        const text = readSync(`${root}/cities/${cityId}.json`)
        assert(fileHash(text) === manifest.city_files[cityId].sha256, `cached city hash mismatch: ${cityId}`)
        bootstrap.series[cityId] = validateCityShard(safeParse(text), manifest, cityId, config).series
        cities.push(cityId)
      }
      for (const cityId of bootstrap.cityIds) assert(bootstrap.series[cityId], `cached full city history is missing: ${cityId}`)
      activeSnapshot = bootstrap
      activeSource = 'remote'
      activeManifest = manifest
      activeRevisionManifest = revisionManifest
      cachedCityIds = cities
      return true
    } catch (error) {
      console.error('[data:update] cached data rejected', error)
      return false
    }
  }

  const cacheHydrated = hydrateCache()
  if (!cacheHydrated && getRevokedSources().includes(bundled.datasetVersion)) {
    activeSnapshot = unavailableSnapshot(bundled)
    activeSource = 'unavailable'
  }

  function getSchedule() {
    try { return wxApi?.getStorageSync?.(CHECK_KEY) || null } catch (_) { return null }
  }

  function saveSchedule(nextCheckAt, errorCode = '') {
    try { wxApi?.setStorageSync?.(CHECK_KEY, { nextCheckAt, errorCode }) } catch (_) {}
  }

  function boundedNextCheck(value) {
    const parsed = Date.parse(value || '')
    if (!Number.isFinite(parsed)) return now() + config.failureRetryMs
    return Math.min(parsed, now() + config.maximumCheckDelayMs)
  }

  function callFunction(name) {
    return new Promise((resolve, reject) => wxApi.cloud.callFunction({ name, data: {}, success: resolve, fail: reject }))
  }

  function download(fileID) {
    return new Promise((resolve, reject) => wxApi.cloud.downloadFile({ fileID, success: resolve, fail: reject }))
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

  async function downloadJson(fileID, expectedHash, expectedBytes) {
    const response = await download(fileID)
    const text = await readFile(response.tempFilePath, 'utf8')
    const bytes = utf8Bytes(text)
    const size = bytes.byteLength
    if (Number.isInteger(expectedBytes)) assert(size === expectedBytes, `remote file size mismatch: ${fileID}`)
    assert(sha256(bytes) === expectedHash, `remote file hash mismatch: ${fileID}`)
    return { text, data: safeParse(text) }
  }

  function cityFileId(manifest, cityId) {
    return manifest.city_file_id_template.replace('{city_id}', cityId)
  }

  async function cacheRelease(current, manifestDownload, revisionDownload, bootstrapDownload, cityDownloads, cityIds) {
    const root = versionRoot(current.dataset_version)
    await mkdir(`${root}/cities`)
    await writeFile(`${root}/manifest.json`, manifestDownload.text)
    if (revisionDownload) await writeFile(`${root}/revision-manifest.json`, revisionDownload.text)
    await writeFile(`${root}/bootstrap.json`, bootstrapDownload.text)
    await Promise.all(Object.entries(cityDownloads).map(([cityId, download]) => writeFile(`${root}/cities/${cityId}.json`, download.text)))
    const pointer = {
      datasetVersion: current.dataset_version,
      manifestSha256: current.manifest_sha256,
      current,
      cachedCityIds: [...cityIds],
    }
    const previousPointer = wxApi.getStorageSync(POINTER_KEY)
    const previousRevocations = getRevokedSources()
    try {
      wxApi.setStorageSync(POINTER_KEY, pointer)
      if (revisionDownload) {
        const revoked = [...new Set([...previousRevocations, ...revisionDownload.data.revoked_source_dataset_versions])]
        wxApi.setStorageSync(REVOKED_SOURCES_KEY, revoked)
      }
    } catch (error) {
      if (previousPointer) wxApi.setStorageSync(POINTER_KEY, previousPointer)
      else wxApi.removeStorageSync(POINTER_KEY)
      if (previousRevocations.length) wxApi.setStorageSync(REVOKED_SOURCES_KEY, previousRevocations)
      else wxApi.removeStorageSync(REVOKED_SOURCES_KEY)
      throw error
    }
  }

  async function refresh({ requiredCityIds = [], force = false } = {}) {
    if (!config.enabled || !wxApi?.cloud || !fs) return { updated: false, source: activeSource, reason: 'disabled' }
    const schedule = getSchedule()
    if (!force && Number(schedule?.nextCheckAt) > now()) return { updated: false, source: activeSource, reason: 'not-due' }
    try {
      const response = await callFunction(config.manifestFunctionName)
      const current = validateCurrent(response?.result?.current, config)
      const remoteUnchanged = activeSource === 'remote' && activeSnapshot.datasetVersion === current.dataset_version
      const remoteNextCheck = Date.parse(current.next_check_at)
      saveSchedule(remoteUnchanged && remoteNextCheck <= now()
        ? now() + config.releaseRetryMs
        : boundedNextCheck(current.next_check_at))
      if (remoteUnchanged) return { updated: false, source: activeSource, reason: 'current' }
      validateRemoteMonth(current, bundled)
      assert(current.dataset_as_of >= activeSnapshot.datasetAsOf, 'remote data is older than the active snapshot')
      const manifestDownload = await downloadJson(current.manifest_file_id, current.manifest_sha256, undefined)
      const manifest = validateManifest(manifestDownload.data, current, config)
      assert(!getRevokedSources().includes(manifest.source_dataset_version), 'remote source has been revoked')
      let revisionDownload = null
      let revisionManifest = null
      if (manifest.release_type === 'historical_correction') {
        revisionDownload = await downloadJson(manifest.revision_manifest_file_id, manifest.revision_manifest_sha256, manifest.revision_manifest_bytes)
        revisionManifest = validateRevisionManifest(revisionDownload.data, manifest)
      }
      const activeSourceVersion = activeManifest?.source_dataset_version || bundled.datasetVersion
      validateRemoteSource(current, manifest, bundled, revisionManifest, activeSourceVersion, activeSnapshot.datasetAsOf)
      const bootstrapDownload = await downloadJson(manifest.bootstrap_file_id, manifest.bootstrap_sha256, manifest.bootstrap_bytes)
      const bootstrap = validateBootstrap(bootstrapDownload.data, manifest, config)
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
      for (const cityId of bootstrap.cityIds) assert(bootstrap.series[cityId], `remote full city history is missing: ${cityId}`)
      await cacheRelease(current, manifestDownload, revisionDownload, bootstrapDownload, cityDownloads, bootstrap.cityIds)
      activeSnapshot = bootstrap
      activeSource = 'remote'
      activeManifest = manifest
      activeRevisionManifest = revisionManifest
      cachedCityIds = [...bootstrap.cityIds]
      return { updated: true, source: activeSource, datasetVersion: activeSnapshot.datasetVersion }
    } catch (error) {
      console.error('[data:update] refresh failed', error)
      saveSchedule(now() + config.failureRetryMs, String(error?.message || 'remote-update-failed').slice(0, 120))
      return { updated: false, source: activeSource, reason: 'failed', error }
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
    const pointer = wxApi.getStorageSync(POINTER_KEY)
    wxApi.setStorageSync(POINTER_KEY, { ...pointer, cachedCityIds: [...cachedCityIds] })
    return true
  }

  return {
    getSnapshot: () => activeSnapshot,
    getSource: () => activeSource,
    hasCity: (cityId) => Boolean(activeSnapshot.series?.[cityId]),
    refresh,
    ensureCities,
    clearRemoteCachePointer() {
      try { wxApi?.removeStorageSync?.(POINTER_KEY) } catch (_) {}
      const bundledRevoked = getRevokedSources().includes(bundled.datasetVersion)
      activeSnapshot = bundledRevoked ? unavailableSnapshot(bundled) : bundled
      activeSource = bundledRevoked ? 'unavailable' : 'bundled'
      activeManifest = null
      activeRevisionManifest = null
      cachedCityIds = []
    },
  }
}

const runtime = createDataRuntime()
module.exports = { ...runtime, createDataRuntime, validateCurrent, validateManifest, validateRevisionManifest, validateBootstrap, validateCityShard, POINTER_KEY, CHECK_KEY, REVOKED_SOURCES_KEY }
