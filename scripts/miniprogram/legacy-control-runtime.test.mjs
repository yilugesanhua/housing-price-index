import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'

import {
  buildControlValidUntil,
  buildRevocationRegistryArtifact,
} from './control-plane.mjs'
import {
  buildMigrationArtifacts,
  migrationDescriptor,
} from './legacy-control-migration.mjs'
import { buildRemoteRelease } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const bundled = require(resolve(root, 'apps/miniprogram/data/snapshot.js'))
const config = require(resolve(root, 'apps/miniprogram/config/data.js'))
const versionConfig = require(resolve(root, 'apps/miniprogram/config/version.js'))
const {
  CONTROL_TOMBSTONE_KEY,
  POINTER_KEY,
  STATE_KEY,
  createDataRuntime,
  validateBootstrap,
} = require(resolve(root, 'apps/miniprogram/utils/data-runtime.js'))
const { buildValidationReceipt } = require(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifest/validation-receipt.js'))

const MIGRATION_ID = 'legacy-control-2026-06-e9788d0bddf3'
const descriptor = migrationDescriptor(MIGRATION_ID)
const fixtureRoot = resolve(root, 'tests/fixtures/miniprogram/legacy-control-2026-06')
const legacyCurrentBytes = readFileSync(resolve(fixtureRoot, 'current.json'))
const legacyManifestBytes = readFileSync(resolve(fixtureRoot, 'manifest.json'))
const legacyBootstrapBytes = gunzipSync(readFileSync(resolve(fixtureRoot, 'bootstrap.json.gz')))
const legacyCurrentText = legacyCurrentBytes.toString('utf8')
const legacyManifestText = legacyManifestBytes.toString('utf8')
const legacyBootstrapText = legacyBootstrapBytes.toString('utf8')
const legacyCurrent = JSON.parse(legacyCurrentText)
const legacyManifest = JSON.parse(legacyManifestText)
const legacyBootstrap = JSON.parse(legacyBootstrapText)

const DEFAULT_MIGRATED_AT = '2026-07-31T00:00:00.000Z'
const DEFAULT_NOW = Date.parse('2026-07-31T00:05:00.000Z')

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function clone(value) {
  return structuredClone(value)
}

function createDeferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue
    rejectPromise = rejectValue
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function createDownloadGate() {
  return { entered: createDeferred(), release: createDeferred() }
}

function migrationRelease(migratedAt = DEFAULT_MIGRATED_AT) {
  const artifacts = buildMigrationArtifacts({
    legacyCurrentText,
    manifestText: legacyManifestText,
    migratedAt,
    migrationId: MIGRATION_ID,
  })
  return {
    ...artifacts,
    bootstrap: clone(legacyBootstrap),
    bootstrapText: legacyBootstrapText,
    manifestText: legacyManifestText,
    revocationArtifact: artifacts.registryArtifact,
    cities: {},
  }
}

function cloudFiles(release) {
  return new Map([
    ...(release.revocationArtifact
      ? [[release.revocationArtifact.cloudFileId, Buffer.from(release.revocationArtifact.text, 'utf8')]]
      : []),
    [release.current.manifest_file_id, Buffer.from(release.manifestText, 'utf8')],
    [release.manifest.bootstrap_file_id, Buffer.from(release.bootstrapText, 'utf8')],
    ...(release.revisionManifestText
      ? [[release.manifest.revision_manifest_file_id, Buffer.from(release.revisionManifestText, 'utf8')]]
      : []),
    ...Object.values(release.cities || {}).map((item) => [
      release.manifest.city_file_id_template.replace('{city_id}', item.data.cityId),
      Buffer.from(item.text, 'utf8'),
    ]),
  ])
}

function createWxMock(release, options = {}) {
  const files = options.files || new Map()
  const directories = options.directories || new Set(['/user', '/user/housing-data'])
  const storage = options.storage || new Map()
  const remote = options.remote || cloudFiles(release)
  const stats = {
    functionCalls: 0,
    downloadFileIds: [],
    writes: 0,
    reads: 0,
    renames: 0,
    removals: 0,
  }
  let activeCurrent = options.current || release.current
  let tempIndex = 0

  function nowValue() {
    return typeof options.now === 'function' ? options.now() : (options.now ?? DEFAULT_NOW)
  }

  function ensureDirectories(path) {
    const parts = path.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current += `/${part}`
      directories.add(current)
    }
  }

  function removeTree(path) {
    const prefix = `${path}/`
    let found = directories.delete(path)
    for (const filePath of [...files.keys()]) {
      if (filePath.startsWith(prefix)) {
        files.delete(filePath)
        found = true
      }
    }
    for (const directory of [...directories]) {
      if (directory.startsWith(prefix)) {
        directories.delete(directory)
        found = true
      }
    }
    if (!found) throw new Error(`ENOENT: ${path}`)
    stats.removals += 1
  }

  const fs = {
    readFileSync(filePath, encoding) {
      if (!files.has(filePath)) throw new Error(`ENOENT: ${filePath}`)
      stats.reads += 1
      const value = files.get(filePath)
      return encoding ? value.toString(encoding) : Buffer.from(value)
    },
    readFile({ filePath, encoding, success, fail }) {
      try {
        success({ data: fs.readFileSync(filePath, encoding) })
      } catch (error) {
        fail(error)
      }
    },
    writeFile({ filePath, data, success, fail }) {
      try {
        stats.writes += 1
        ensureDirectories(filePath.slice(0, filePath.lastIndexOf('/')))
        files.set(filePath, Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data, 'utf8'))
        success({})
      } catch (error) {
        fail(error)
      }
    },
    writeFileSync(filePath, data, encoding) {
      ensureDirectories(filePath.slice(0, filePath.lastIndexOf('/')))
      files.set(filePath, Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data, encoding || 'utf8'))
    },
    unlinkSync(filePath) {
      if (!files.delete(filePath)) throw new Error(`ENOENT: ${filePath}`)
    },
    mkdir({ dirPath, success }) {
      ensureDirectories(dirPath)
      success({})
    },
    readdirSync(dirPath) {
      if (!directories.has(dirPath)) throw new Error(`ENOENT: ${dirPath}`)
      const prefix = `${dirPath}/`
      return [...new Set([
        ...[...directories]
          .filter((path) => path.startsWith(prefix))
          .map((path) => path.slice(prefix.length).split('/')[0]),
        ...[...files.keys()]
          .filter((path) => path.startsWith(prefix))
          .map((path) => path.slice(prefix.length).split('/')[0]),
      ].filter(Boolean))]
    },
    rmdirSync(dirPath) {
      removeTree(dirPath)
    },
    rmdir({ dirPath, success, fail }) {
      try {
        removeTree(dirPath)
        success({})
      } catch (error) {
        fail(error)
      }
    },
    rename({ oldPath, newPath, success, fail }) {
      const prefix = `${oldPath}/`
      const matchingFiles = [...files.entries()].filter(([path]) => path.startsWith(prefix))
      const matchingDirectories = [...directories].filter((path) => path === oldPath || path.startsWith(prefix))
      if (!matchingFiles.length && !matchingDirectories.length) {
        fail(new Error(`ENOENT: ${oldPath}`))
        return
      }
      stats.renames += 1
      for (const [path, value] of matchingFiles) {
        files.delete(path)
        files.set(`${newPath}${path.slice(oldPath.length)}`, value)
      }
      for (const path of matchingDirectories) directories.delete(path)
      ensureDirectories(newPath)
      for (const path of matchingDirectories) directories.add(`${newPath}${path.slice(oldPath.length)}`)
      success({})
    },
  }

  function validationReceipt() {
    if (Object.prototype.hasOwnProperty.call(options, 'validationReceipt')) {
      return typeof options.validationReceipt === 'function'
        ? options.validationReceipt(activeCurrent, nowValue())
        : options.validationReceipt
    }
    return buildValidationReceipt(activeCurrent, nowValue())
  }

  function deliverDownload(fileID, success, fail) {
    const value = remote.get(fileID)
    if (value === undefined) {
      fail(new Error(`remote file missing: ${fileID}`))
      return
    }
    const tempFilePath = `/temp/${tempIndex += 1}`
    files.set(tempFilePath, Buffer.from(value))
    success({ tempFilePath })
  }

  return {
    wxApi: {
      env: { USER_DATA_PATH: '/user' },
      getFileSystemManager: () => fs,
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, clone(value)),
      removeStorageSync: (key) => storage.delete(key),
      cloud: {
        callFunction({ success, fail }) {
          stats.functionCalls += 1
          const failure = typeof options.functionError === 'function'
            ? options.functionError()
            : options.functionError
          if (failure) {
            fail(failure)
            return
          }
          const receipt = validationReceipt()
          success({
            result: {
              current: clone(activeCurrent),
              ...(receipt ? { validation_receipt: clone(receipt) } : {}),
            },
          })
        },
        downloadFile({ fileID, success, fail }) {
          stats.downloadFileIds.push(fileID)
          const gate = options.downloadGates?.get(fileID)
          if (!gate) {
            deliverDownload(fileID, success, fail)
            return
          }
          gate.entered.resolve(fileID)
          gate.release.promise.then(
            () => deliverDownload(fileID, success, fail),
            fail,
          )
        },
      },
    },
    files,
    directories,
    remote,
    storage,
    stats,
    setCurrent(value) {
      activeCurrent = value
    },
    addRelease(nextRelease) {
      for (const [fileID, value] of cloudFiles(nextRelease)) remote.set(fileID, value)
      activeCurrent = nextRelease.current
    },
  }
}

function runtimeState(mock) {
  return mock.storage.get(STATE_KEY)
}

function targetRoot(datasetVersion) {
  return `/user/housing-data/${datasetVersion}`
}

function legacyPointer(datasetVersion = legacyCurrent.dataset_version, manifestSha256 = legacyCurrent.manifest_sha256) {
  return {
    datasetVersion,
    manifestSha256,
    current: datasetVersion === legacyCurrent.dataset_version
      ? clone(legacyCurrent)
      : { dataset_version: datasetVersion },
    cachedCityIds: [...bundled.cityIds],
    verifiedAt: DEFAULT_NOW - 60_000,
  }
}

function syntheticNextMonthSnapshot() {
  const snapshot = clone(bundled)
  snapshot.months = [...snapshot.months.slice(1), '2026-07']
  snapshot.releaseDates = [...snapshot.releaseDates.slice(1), '2026-08-17']
  snapshot.datasetAsOf = '2026-07'
  snapshot.datasetVersion = '2026-07-111111111111'
  snapshot.releaseDate = '2026-08-17'
  snapshot.generatedAt = '2026-08-17T01:40:00.000Z'
  snapshot.nextCheckDueAt = '2026-09-15T01:40:00.000Z'
  snapshot.coverageStart = snapshot.months[0]
  return snapshot
}

function ordinaryRelease(previousCurrent, registryArtifact) {
  const publishedAt = '2026-08-17T01:40:00.000Z'
  const release = buildRemoteRelease(syntheticNextMonthSnapshot(), {
    cloudEnvId: config.cloudEnvId,
    storageBucket: config.storageBucket,
    minimumAppVersion: versionConfig.version,
    nextCheckAt: '2026-09-15T01:40:00.000Z',
    sourceBatchIds: ['official-html-runtime-fixture'],
  })
  release.revocationArtifact = registryArtifact
  Object.assign(release.current, {
    source_dataset_version: release.manifest.source_dataset_version,
    published_at: publishedAt,
    previous_dataset_version: previousCurrent.dataset_version,
    control_schema_version: '1.0.0',
    control_generation: previousCurrent.control_generation + 1,
    ...registryArtifact.currentFields,
    transition_type: 'publish',
    data_status: 'current',
    status_reason: 'monthly_publish',
    control_generated_at: publishedAt,
    control_valid_until: buildControlValidUntil(publishedAt),
  })
  return release
}

test('fixed legacy runtime fixture keeps its exact audited byte identities', () => {
  assert.equal(legacyCurrentBytes.byteLength, 448)
  assert.equal(sha256(legacyCurrentBytes), descriptor.legacy_current_sha256)
  assert.equal(legacyManifestBytes.byteLength, 8_326)
  assert.equal(sha256(legacyManifestBytes), descriptor.legacy_manifest_sha256)
  assert.equal(legacyBootstrapBytes.byteLength, descriptor.legacy_bootstrap_bytes)
  assert.equal(sha256(legacyBootstrapBytes), descriptor.legacy_bootstrap_sha256)
  assert.equal(legacyBootstrap.sourceCoverageStart, undefined)
  assert.equal(legacyBootstrap.coverageStart, descriptor.legacy_source_coverage_start)
  assert.equal(legacyBootstrap.months[0], descriptor.client_coverage_start)
})

test('exact migration first install remains bundled until the complete 70-city package is verified and atomically activated', async () => {
  const release = migrationRelease()
  const bootstrapGate = createDownloadGate()
  const mock = createWxMock(release, {
    now: DEFAULT_NOW,
    downloadGates: new Map([[release.manifest.bootstrap_file_id, bootstrapGate]]),
  })
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => DEFAULT_NOW })

  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtime.getSnapshot().datasetVersion, bundled.datasetVersion)
  const refreshing = runtime.refresh({ force: true })
  await bootstrapGate.entered.promise

  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtime.getSnapshot().datasetVersion, bundled.datasetVersion)
  assert.equal(runtimeState(mock).active, null)

  bootstrapGate.release.resolve()
  const result = await refreshing
  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().datasetVersion, descriptor.dataset_version)
  assert.equal(runtime.getSnapshot().sourceCoverageStart, descriptor.legacy_source_coverage_start)
  assert.equal(runtime.getSnapshot().coverageStart, descriptor.client_coverage_start)
  assert.equal(Object.keys(runtime.getSnapshot().series).length, 70)
  assert.equal(runtimeState(mock).active.cachedCityIds.length, 70)
  assert.deepEqual(mock.stats.downloadFileIds, [
    release.revocationArtifact.cloudFileId,
    release.current.manifest_file_id,
    release.manifest.bootstrap_file_id,
  ])
  assert.equal(mock.files.get(`${targetRoot(descriptor.dataset_version)}/bootstrap.json`).equals(legacyBootstrapBytes), true)
})

test('a v2.3 legacy cache is never trusted directly and is replaced only after a fresh bound receipt and full re-download', async () => {
  const release = migrationRelease()
  const rootPath = targetRoot(descriptor.dataset_version)
  const storage = new Map([[POINTER_KEY, legacyPointer()]])
  const files = new Map([
    [`${rootPath}/manifest.json`, Buffer.from(legacyManifestBytes)],
    [`${rootPath}/bootstrap.json`, Buffer.from(legacyBootstrapBytes)],
    [`${rootPath}/legacy-sentinel.txt`, Buffer.from('must-be-replaced')],
  ])
  const directories = new Set(['/user', '/user/housing-data', rootPath, `${rootPath}/cities`])
  const mock = createWxMock(release, { storage, files, directories, now: DEFAULT_NOW })
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => DEFAULT_NOW })

  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(mock.files.has(`${rootPath}/legacy-sentinel.txt`), true)
  const result = await runtime.refresh({ force: true })

  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().datasetVersion, descriptor.dataset_version)
  assert.equal(mock.storage.has(POINTER_KEY), false)
  assert.equal(mock.files.has(`${rootPath}/legacy-sentinel.txt`), false)
  assert.equal(mock.files.get(`${rootPath}/manifest.json`).equals(legacyManifestBytes), true)
  assert.equal(mock.files.get(`${rootPath}/bootstrap.json`).equals(legacyBootstrapBytes), true)
  assert.deepEqual(mock.stats.downloadFileIds, [
    release.revocationArtifact.cloudFileId,
    release.current.manifest_file_id,
    release.manifest.bootstrap_file_id,
  ])
  assert.equal(runtimeState(mock).control.generation, 1)
})

test('a failed migration bootstrap still persists revocations in main state and tombstone so an offline restart cannot revive the revoked cache', async () => {
  const release = migrationRelease()
  const revokedVersion = descriptor.superseded_dataset_version
  const revokedRoot = targetRoot(revokedVersion)
  const storage = new Map([[POINTER_KEY, legacyPointer(revokedVersion, 'a'.repeat(64))]])
  const files = new Map([[`${revokedRoot}/manifest.json`, Buffer.from('{}')]])
  const directories = new Set(['/user', '/user/housing-data', revokedRoot])
  const remote = cloudFiles(release)
  remote.set(release.manifest.bootstrap_file_id, Buffer.concat([legacyBootstrapBytes, Buffer.from(' ')]))
  const online = createWxMock(release, { storage, files, directories, remote, now: DEFAULT_NOW })
  const runtime = createDataRuntime({ wxApi: online.wxApi, bundled, now: () => DEFAULT_NOW })

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.match(result.error.message, /remote file size mismatch|remote file hash mismatch/)
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtimeState(online).status, 'pending-rollback')
  assert.equal(runtimeState(online).active, null)
  assert.ok(runtimeState(online).control.revokedDatasetVersions.includes(revokedVersion))
  assert.ok(runtimeState(online).control.revokedSourceDatasetVersions.includes(descriptor.superseded_source_dataset_version))
  assert.equal(online.storage.has(CONTROL_TOMBSTONE_KEY), true)
  assert.equal(online.files.has(`${revokedRoot}/manifest.json`), false)

  const offline = createWxMock(release, {
    storage: online.storage,
    files: online.files,
    directories: online.directories,
    remote: online.remote,
    now: DEFAULT_NOW + 60_000,
    functionError: new Error('offline'),
  })
  const restarted = createDataRuntime({
    wxApi: offline.wxApi,
    bundled,
    now: () => DEFAULT_NOW + 60_000,
  })

  assert.equal(restarted.getSource(), 'bundled')
  assert.notEqual(restarted.getSnapshot().datasetVersion, revokedVersion)
  assert.ok(runtimeState(offline).control.revokedDatasetVersions.includes(revokedVersion))
  assert.equal((await restarted.refresh({ force: true })).reason, 'failed')
  assert.equal(restarted.getSource(), 'bundled')
})

test('an expired dynamic receipt ingests and persists only the bound revocation registry without downloading or activating data files', async () => {
  const migratedAt = '2026-07-29T04:00:00.000Z'
  const now = Date.parse('2026-08-01T00:00:00.000Z')
  const release = migrationRelease(migratedAt)
  const receiptIssuedAt = now - 11 * 60 * 1000
  const mock = createWxMock(release, {
    now,
    validationReceipt: (current) => buildValidationReceipt(current, receiptIssuedAt),
  })
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => now })

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'activation-not-authorized')
  assert.equal(runtime.getSource(), 'bundled')
  assert.deepEqual(mock.stats.downloadFileIds, [release.revocationArtifact.cloudFileId])
  assert.equal(runtimeState(mock).active, null)
  assert.equal(runtimeState(mock).control.generation, 1)
  assert.ok(runtimeState(mock).control.revokedDatasetVersions.includes(descriptor.superseded_dataset_version))
  assert.equal(runtimeState(mock).control.validUntil < now, true)
  assert.equal(mock.storage.has(CONTROL_TOMBSTONE_KEY), true)
})

test('missing or incorrectly bound validation receipts cannot ingest even a single revocation', async (t) => {
  const cases = [
    ['missing receipt', () => null],
    ['wrong validator', (current) => ({ ...buildValidationReceipt(current, DEFAULT_NOW), validator_id: 'untrusted-validator' })],
    ['wrong current fingerprint', (current) => ({ ...buildValidationReceipt(current, DEFAULT_NOW), current_fingerprint: '0'.repeat(64) })],
    ['wrong manifest binding', (current) => ({ ...buildValidationReceipt(current, DEFAULT_NOW), manifest_sha256: '0'.repeat(64) })],
    ['wrong revocations binding', (current) => ({ ...buildValidationReceipt(current, DEFAULT_NOW), revocations_sha256: '0'.repeat(64) })],
    ['wrong control generation', (current) => ({ ...buildValidationReceipt(current, DEFAULT_NOW), control_generation: current.control_generation + 1 })],
    ['wrong revocations generation', (current) => ({ ...buildValidationReceipt(current, DEFAULT_NOW), revocations_generation: current.revocations_generation + 1 })],
  ]

  for (const [label, makeReceipt] of cases) {
    await t.test(label, async () => {
      const release = migrationRelease()
      const mock = createWxMock(release, {
        now: DEFAULT_NOW,
        validationReceipt: (current) => makeReceipt(current),
      })
      const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => DEFAULT_NOW })

      const result = await runtime.refresh({ force: true })
      assert.equal(result.reason, 'failed')
      assert.equal(runtime.getSource(), 'bundled')
      assert.equal(mock.stats.downloadFileIds.length, 0)
      assert.equal(runtimeState(mock).control.generation, 0)
      assert.deepEqual(runtimeState(mock).control.revokedDatasetVersions, [])
      assert.deepEqual(runtimeState(mock).control.revokedSourceDatasetVersions, [])
      assert.equal(mock.storage.has(CONTROL_TOMBSTONE_KEY), false)
    })
  }
})

test('the next ordinary monthly publish advances control by one, preserves every revocation, and carries no migration-only identity', async () => {
  const clock = { value: DEFAULT_NOW }
  const migration = migrationRelease()
  const mock = createWxMock(migration, { now: () => clock.value })
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => clock.value })
  assert.equal((await runtime.refresh({ force: true })).updated, true)

  const next = ordinaryRelease(migration.current, migration.revocationArtifact)
  for (const field of [
    'migration_id',
    'migrated_from_current_sha256',
    'migrated_from_manifest_sha256',
    'superseded_dataset_version',
    'superseded_source_dataset_version',
  ]) assert.equal(Object.prototype.hasOwnProperty.call(next.current, field), false)
  assert.equal(next.current.transition_type, 'publish')
  assert.equal(next.current.control_generation, migration.current.control_generation + 1)
  assert.equal(next.current.revocations_generation, migration.current.revocations_generation)
  assert.equal(next.current.revocations_sha256, migration.current.revocations_sha256)

  clock.value = Date.parse('2026-08-17T01:45:00.000Z')
  mock.addRelease(next)
  const downloadsBefore = mock.stats.downloadFileIds.length
  const result = await runtime.refresh({ force: true })

  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().datasetAsOf, '2026-07')
  assert.equal(runtimeState(mock).control.generation, 2)
  assert.equal(runtimeState(mock).control.registryGeneration, 1)
  assert.deepEqual(runtimeState(mock).control.revokedDatasetEntries, migration.registry.revoked_dataset_versions)
  assert.deepEqual(runtimeState(mock).control.revokedSourceDatasetEntries, migration.registry.revoked_source_dataset_versions)
  assert.ok(mock.stats.downloadFileIds.length > downloadsBefore)
})

test('legacy coverage repair is available only to the exact audited migration and never to an ordinary publish', () => {
  const release = migrationRelease()
  const interpreted = validateBootstrap(
    clone(legacyBootstrap),
    release.manifest,
    config,
    bundled.cityIds,
    bundled.featuredCityIds,
    release.current,
  )

  assert.equal(interpreted.sourceCoverageStart, descriptor.legacy_source_coverage_start)
  assert.equal(interpreted.coverageStart, descriptor.client_coverage_start)
  assert.equal(legacyBootstrap.sourceCoverageStart, undefined)
  assert.equal(legacyBootstrap.coverageStart, descriptor.legacy_source_coverage_start)

  const ordinaryCurrent = clone(release.current)
  ordinaryCurrent.transition_type = 'publish'
  ordinaryCurrent.status_reason = 'monthly_publish'
  for (const field of [
    'migration_id',
    'migrated_from_current_sha256',
    'migrated_from_manifest_sha256',
    'superseded_dataset_version',
    'superseded_source_dataset_version',
  ]) delete ordinaryCurrent[field]
  assert.throws(() => validateBootstrap(
    clone(legacyBootstrap),
    release.manifest,
    config,
    bundled.cityIds,
    bundled.featuredCityIds,
    ordinaryCurrent,
  ), /coverage start is inconsistent/)
})

test('any manifest byte, bootstrap byte, or audited migration identity change fails closed', async (t) => {
  const byteCases = [
    ['manifest byte changed', (release, remote) => {
      remote.set(release.current.manifest_file_id, Buffer.concat([legacyManifestBytes, Buffer.from(' ')]))
    }],
    ['bootstrap byte changed', (release, remote) => {
      remote.set(release.manifest.bootstrap_file_id, Buffer.concat([legacyBootstrapBytes, Buffer.from(' ')]))
    }],
  ]
  for (const [label, mutate] of byteCases) {
    await t.test(label, async () => {
      const release = migrationRelease()
      const remote = cloudFiles(release)
      mutate(release, remote)
      const mock = createWxMock(release, { remote, now: DEFAULT_NOW })
      const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => DEFAULT_NOW })
      const result = await runtime.refresh({ force: true })
      assert.equal(result.reason, 'failed')
      assert.equal(runtime.getSource(), 'bundled')
      assert.equal(runtimeState(mock).active, null)
    })
  }

  const identityCases = [
    ['migration ID changed', (current) => { current.migration_id = 'legacy-control-2026-06-unknown' }],
    ['legacy current identity changed', (current) => { current.migrated_from_current_sha256 = '0'.repeat(64) }],
    ['legacy manifest identity changed', (current) => { current.migrated_from_manifest_sha256 = '0'.repeat(64) }],
    ['source dataset identity changed', (current) => { current.source_dataset_version = '2026-06-111111111111' }],
  ]
  for (const [label, mutate] of identityCases) {
    await t.test(label, async () => {
      const release = migrationRelease()
      const current = clone(release.current)
      mutate(current)
      const mock = createWxMock(release, { current, now: DEFAULT_NOW })
      const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => DEFAULT_NOW })
      const result = await runtime.refresh({ force: true })
      assert.equal(result.reason, 'failed')
      assert.equal(runtime.getSource(), 'bundled')
      assert.equal(mock.stats.downloadFileIds.length, 0)
      assert.equal(runtimeState(mock).control.generation, 0)
    })
  }
})
