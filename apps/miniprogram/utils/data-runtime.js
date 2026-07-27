const bundledSnapshot = require('../data/snapshot.js')
const dataConfig = require('../config/data.js')
const versionConfig = require('../config/version.js')
const { sha256, utf8Bytes } = require('./sha256.js')

const POINTER_KEY = 'housing-data-pointer-v3'
const CHECK_KEY = 'housing-data-check-v3'
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
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
  return manifest
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

  function hydrateCache() {
    if (!fs || !wxApi?.getStorageSync || !userRoot) return false
    try {
      const pointer = wxApi.getStorageSync(POINTER_KEY)
      if (!pointer || !DATASET_PATTERN.test(pointer.datasetVersion || '')) return false
      const root = versionRoot(pointer.datasetVersion)
      const manifestText = readSync(`${root}/manifest.json`)
      assert(fileHash(manifestText) === pointer.manifestSha256, 'cached manifest hash mismatch')
      const current = validateCurrent(pointer.current, config)
      const manifest = validateManifest(safeParse(manifestText), current, config)
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
      activeSnapshot = bootstrap
      activeSource = 'remote'
      activeManifest = manifest
      cachedCityIds = cities
      return true
    } catch (error) {
      console.error('[data:update] cached data rejected', error)
      return false
    }
  }

  hydrateCache()

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

  async function cacheRelease(current, manifestDownload, bootstrapDownload, cityDownloads) {
    const root = versionRoot(current.dataset_version)
    await mkdir(`${root}/cities`)
    await writeFile(`${root}/manifest.json`, manifestDownload.text)
    await writeFile(`${root}/bootstrap.json`, bootstrapDownload.text)
    await Promise.all(Object.entries(cityDownloads).map(([cityId, download]) => writeFile(`${root}/cities/${cityId}.json`, download.text)))
    const pointer = {
      datasetVersion: current.dataset_version,
      manifestSha256: current.manifest_sha256,
      current,
      cachedCityIds: Object.keys(cityDownloads),
    }
    wxApi.setStorageSync(POINTER_KEY, pointer)
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
      assert(current.dataset_as_of >= activeSnapshot.datasetAsOf, 'remote data is older than the active snapshot')
      const manifestDownload = await downloadJson(current.manifest_file_id, current.manifest_sha256, undefined)
      const manifest = validateManifest(manifestDownload.data, current, config)
      const bootstrapDownload = await downloadJson(manifest.bootstrap_file_id, manifest.bootstrap_sha256, manifest.bootstrap_bytes)
      const bootstrap = validateBootstrap(bootstrapDownload.data, manifest, config)
      const cityIds = [...new Set(requiredCityIds)].filter((cityId) => bootstrap.cityMap[cityId] && !bootstrap.series[cityId])
      const cityDownloads = Object.fromEntries(await Promise.all(cityIds.map(async (cityId) => {
        const file = manifest.city_files[cityId]
        const item = await downloadJson(cityFileId(manifest, cityId), file.sha256, file.bytes)
        validateCityShard(item.data, manifest, cityId, config)
        return [cityId, item]
      })))
      for (const [cityId, item] of Object.entries(cityDownloads)) bootstrap.series[cityId] = item.data.series
      await cacheRelease(current, manifestDownload, bootstrapDownload, cityDownloads)
      activeSnapshot = bootstrap
      activeSource = 'remote'
      activeManifest = manifest
      cachedCityIds = Object.keys(cityDownloads)
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
      activeSnapshot = bundled
      activeSource = 'bundled'
      activeManifest = null
      cachedCityIds = []
    },
  }
}

const runtime = createDataRuntime()
module.exports = { ...runtime, createDataRuntime, validateCurrent, validateManifest, validateBootstrap, validateCityShard, POINTER_KEY, CHECK_KEY }
