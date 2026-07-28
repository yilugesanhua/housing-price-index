import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { buildRemoteRelease } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const bundled = require(resolve(root, 'apps/miniprogram/data/snapshot.js'))
const config = require(resolve(root, 'apps/miniprogram/config/data.js'))
const versionConfig = require(resolve(root, 'apps/miniprogram/config/version.js'))
const { sha256, utf8Bytes } = require(resolve(root, 'apps/miniprogram/utils/sha256.js'))
const { createDataRuntime, POINTER_KEY, CHECK_KEY } = require(resolve(root, 'apps/miniprogram/utils/data-runtime.js'))
const { validateCurrent } = require(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifest/validate-current.js'))

function makeRelease(minimumAppVersion = versionConfig.version) {
  return buildRemoteRelease(bundled, {
    cloudEnvId: config.cloudEnvId,
    storageBucket: config.storageBucket,
    minimumAppVersion,
    nextCheckAt: '2026-08-17T01:40:00.000Z',
    sourceBatchIds: ['official-html-test'],
  })
}

function cloudFiles(release) {
  return new Map([
    [release.current.manifest_file_id, release.manifestText],
    [release.manifest.bootstrap_file_id, release.bootstrapText],
    ...Object.values(release.cities).map((item) => [release.manifest.city_file_id_template.replace('{city_id}', item.data.cityId), item.text]),
  ])
}

function createWxMock(release, options = {}) {
  const files = options.files || new Map()
  const storage = options.storage || new Map()
  const remote = options.remote || cloudFiles(release)
  const stats = { functionCalls: 0, downloads: 0, writes: 0 }
  let tempIndex = 0
  const fs = {
    readFileSync(filePath, encoding) {
      if (!files.has(filePath)) throw new Error(`ENOENT: ${filePath}`)
      const value = files.get(filePath)
      return encoding ? value.toString(encoding) : value
    },
    readFile({ filePath, encoding, success, fail }) {
      try { success({ data: fs.readFileSync(filePath, encoding) }) } catch (error) { fail(error) }
    },
    writeFile({ filePath, data, success, fail }) {
      stats.writes += 1
      if (options.failWrite?.(filePath, stats.writes)) return fail(new Error(`ENOSPC: ${filePath}`))
      files.set(filePath, Buffer.from(data, 'utf8'))
      success({})
    },
    mkdir({ success }) { success({}) },
  }
  return {
    wxApi: {
      env: { USER_DATA_PATH: '/user' },
      getFileSystemManager: () => fs,
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
      removeStorageSync: (key) => storage.delete(key),
      cloud: {
        callFunction({ success, fail }) {
          stats.functionCalls += 1
          if (options.functionError) return fail(options.functionError)
          success({ result: { current: structuredClone(options.current || release.current) } })
        },
        downloadFile({ fileID, success, fail }) {
          stats.downloads += 1
          const value = remote.get(fileID)
          if (value === undefined) return fail(new Error(`remote file missing: ${fileID}`))
          const tempFilePath = `/temp/${tempIndex += 1}`
          files.set(tempFilePath, Buffer.from(value, 'utf8'))
          success({ tempFilePath })
        },
      },
    },
    files,
    storage,
    stats,
  }
}

test('mini program SHA-256 matches standard UTF-8 vectors and staged bytes', () => {
  for (const value of ['', 'abc', '住房小二']) {
    assert.equal(sha256(utf8Bytes(value)), createHash('sha256').update(value).digest('hex'))
  }
  const release = makeRelease()
  assert.equal(sha256(utf8Bytes(release.bootstrapText)), release.manifest.bootstrap_sha256)
})

test('first online launch atomically activates remote data and valid cache hydrates synchronously', async () => {
  const release = makeRelease()
  const mock = createWxMock(release)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  const result = await runtime.refresh({ requiredCityIds: ['taiyuan'], force: true })

  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.hasCity('taiyuan'), true)
  assert.equal(mock.storage.get(POINTER_KEY).datasetVersion, release.current.dataset_version)
  assert.equal(mock.storage.get(POINTER_KEY).cachedCityIds.length, 70)
  assert.equal(mock.stats.downloads, 2)

  const restored = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal(restored.getSource(), 'remote')
  assert.equal(restored.hasCity('taiyuan'), true)
})

test('successful schedule suppresses cloud checks until next check time', async () => {
  const release = makeRelease()
  const mock = createWxMock(release)
  const now = Date.parse('2026-07-01T00:00:00.000Z')
  mock.storage.set(CHECK_KEY, { nextCheckAt: now + 60_000 })
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => now })

  const result = await runtime.refresh()
  assert.equal(result.reason, 'not-due')
  assert.equal(mock.stats.functionCalls, 0)
})

test('unchanged remote data retries shortly when the official check time is already due', async () => {
  const release = makeRelease()
  const now = Date.parse('2026-07-15T01:45:00.000Z')
  release.current.next_check_at = '2026-07-15T01:35:00.000Z'
  const mock = createWxMock(release)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => now })

  assert.equal((await runtime.refresh({ force: true })).updated, true)
  const result = await runtime.refresh({ force: true })

  assert.equal(result.reason, 'current')
  assert.equal(mock.storage.get(CHECK_KEY).nextCheckAt, now + config.releaseRetryMs)
})

test('all 70 city histories are local after update and city switching makes no download', async () => {
  const release = makeRelease()
  const mock = createWxMock(release)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  await runtime.refresh({ force: true })
  const before = mock.stats.downloads

  await runtime.ensureCities(['haikou'])
  assert.equal(runtime.hasCity('haikou'), true)
  assert.equal(mock.stats.downloads, before)
  assert.equal(mock.storage.get(POINTER_KEY).cachedCityIds.length, 70)
})

test('a legacy sharded release is bulk-cached once instead of downloading on city selection', async () => {
  const release = makeRelease()
  release.bootstrap.series = Object.fromEntries(release.bootstrap.featuredCityIds.map((cityId) => [cityId, release.bootstrap.series[cityId]]))
  release.bootstrapText = `${JSON.stringify(release.bootstrap)}\n`
  release.manifest.bootstrap_sha256 = sha256(utf8Bytes(release.bootstrapText))
  release.manifest.bootstrap_bytes = utf8Bytes(release.bootstrapText).byteLength
  release.manifestText = `${JSON.stringify(release.manifest)}\n`
  release.current.manifest_sha256 = sha256(utf8Bytes(release.manifestText))
  const mock = createWxMock(release)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })

  assert.equal((await runtime.refresh({ force: true })).updated, true)
  assert.equal(mock.stats.downloads, 66)
  assert.equal(Object.keys(runtime.getSnapshot().series).length, 70)
  const downloadsAfterUpdate = mock.stats.downloads
  await runtime.ensureCities(['taiyuan', 'haikou', 'xining'])
  assert.equal(mock.stats.downloads, downloadsAfterUpdate)
})

test('corrupt manifest and interrupted cache writes never activate a remote pointer', async () => {
  const release = makeRelease()
  const corruptRemote = cloudFiles(release)
  corruptRemote.set(release.current.manifest_file_id, `${release.manifestText} `)
  const corrupt = createWxMock(release, { remote: corruptRemote })
  const corruptRuntime = createDataRuntime({ wxApi: corrupt.wxApi, bundled })
  assert.equal((await corruptRuntime.refresh({ force: true })).reason, 'failed')
  assert.equal(corruptRuntime.getSource(), 'bundled')
  assert.equal(corrupt.storage.has(POINTER_KEY), false)

  const interrupted = createWxMock(release, { failWrite: (path) => path.endsWith('/bootstrap.json') })
  const interruptedRuntime = createDataRuntime({ wxApi: interrupted.wxApi, bundled })
  assert.equal((await interruptedRuntime.refresh({ force: true })).reason, 'failed')
  assert.equal(interruptedRuntime.getSource(), 'bundled')
  assert.equal(interrupted.storage.has(POINTER_KEY), false)
})

test('cloud failure, older data, and incompatible app version keep the bundled fallback', async () => {
  const release = makeRelease()
  const offline = createWxMock(release, { functionError: new Error('offline') })
  const offlineRuntime = createDataRuntime({ wxApi: offline.wxApi, bundled })
  assert.equal((await offlineRuntime.refresh({ force: true })).reason, 'failed')
  assert.equal(offlineRuntime.getSource(), 'bundled')
  assert.ok(Number(offline.storage.get(CHECK_KEY).nextCheckAt) > Date.now())

  const oldCurrent = { ...release.current, dataset_version: '2026-05-000000000000', dataset_as_of: '2026-05' }
  oldCurrent.manifest_file_id = `cloud://${config.cloudEnvId}.${config.storageBucket}/housing-data/releases/${oldCurrent.dataset_version}/manifest.json`
  const older = createWxMock(release, { current: oldCurrent })
  const olderRuntime = createDataRuntime({ wxApi: older.wxApi, bundled })
  assert.equal((await olderRuntime.refresh({ force: true })).reason, 'failed')
  assert.equal(olderRuntime.getSource(), 'bundled')

  const futureRelease = makeRelease('v99.0.0')
  const future = createWxMock(futureRelease)
  const futureRuntime = createDataRuntime({ wxApi: future.wxApi, bundled })
  assert.equal((await futureRuntime.refresh({ force: true })).reason, 'failed')
  assert.equal(futureRuntime.getSource(), 'bundled')
})

test('clearing the remote pointer returns to the independent bundled snapshot', async () => {
  const release = makeRelease()
  const mock = createWxMock(release)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  await runtime.refresh({ force: true })
  runtime.clearRemoteCachePointer()

  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtime.getSnapshot(), bundled)
  assert.equal(mock.storage.has(POINTER_KEY), false)
})

test('cloud manifest function rejects unsafe current pointers', () => {
  const release = makeRelease()
  assert.equal(validateCurrent(release.current), release.current)
  assert.throws(() => validateCurrent({ ...release.current, dataset_version: '../current' }), /dataset version/)
  assert.throws(() => validateCurrent({ ...release.current, manifest_file_id: `cloud://${config.cloudEnvId}/housing-data/releases/${release.current.dataset_version}/manifest.json` }), /file ID/)
  assert.throws(() => validateCurrent({ ...release.current, schema_version: '2.0.0' }), /schema/)
  assert.throws(() => validateCurrent({ ...release.current, manifest_sha256: 'bad' }), /hash/)
})
