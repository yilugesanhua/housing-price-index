import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { buildRemoteRelease, sha256 as remoteSha256, stableJson as remoteStableJson } from './remote-data-lib.mjs'
import { buildCompleteRemoteRelease } from './complete-remote-data.mjs'
import {
  appendFailedDatasetRevocation,
  appendFailedReleaseRevocations,
  appendHistoricalCorrectionRevocations,
  buildRollbackRevisionId,
  buildRevocationRegistryArtifact,
  createRevocationRegistry,
} from './control-plane.mjs'
import { buildAutomaticRollbackPointer } from './post-publish-guard.mjs'
import { buildDataStatusDeployment } from './deploy-data-status.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const bundled = require(resolve(root, 'apps/miniprogram/data/snapshot.js'))
const config = require(resolve(root, 'apps/miniprogram/config/data.js'))
const versionConfig = require(resolve(root, 'apps/miniprogram/config/version.js'))
const { sha256, sha256Async, utf8Bytes } = require(resolve(root, 'apps/miniprogram/utils/sha256.js'))
const { createDataRuntime, validateCurrent: validateRuntimeCurrent, STATE_KEY, CONTROL_TOMBSTONE_KEY, POINTER_KEY, CHECK_KEY, REVOKED_SOURCES_KEY } = require(resolve(root, 'apps/miniprogram/utils/data-runtime.js'))
const { validateCurrent } = require(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifest/validate-current.js'))
const { buildValidationReceipt } = require(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifest/validation-receipt.js'))

function publicationIdentity() {
  return {
    candidate_records_sha256: 'a'.repeat(64), audit_records_sha256: 'b'.repeat(64), source_index_sha256: 'c'.repeat(64),
    audit_report_sha256: 'd'.repeat(64), audit_commit_sha: 'e'.repeat(40), audit_code_sha256: 'f'.repeat(64),
    audit_version: 'full-record-audit-v7', parser_versions: ['official-html-v9-product-housing-only-strict-release-date'],
  }
}

function correctionPublicationIdentity() {
  return {
    candidate_records_sha256: 'a'.repeat(64), audit_records_sha256: 'b'.repeat(64), source_index_sha256: 'c'.repeat(64),
    audit_report_sha256: 'd'.repeat(64), audit_commit_sha: 'e'.repeat(40), audit_code_sha256: 'f'.repeat(64),
    audit_version: 'full-record-audit-v7', parser_versions: ['official-html-v7-product-housing-only'],
  }
}

test('development builds select only the isolated preview manifest and data root', () => {
  const configPath = resolve(root, 'apps/miniprogram/config/data.js')
  const previousWx = globalThis.wx
  globalThis.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }) }
  delete require.cache[configPath]
  const preview = require(configPath)
  assert.equal(preview.previewMode, true)
  assert.equal(preview.manifestFunctionName, 'getHousingDataManifestPreview')
  assert.equal(preview.remoteDataRoot, 'housing-data/preview')
  if (previousWx === undefined) delete globalThis.wx
  else globalThis.wx = previousWx
  delete require.cache[configPath]
  const formal = require(configPath)
  assert.equal(formal.previewMode, false)
  assert.equal(formal.manifestFunctionName, 'getHousingDataManifest')
  assert.equal(formal.remoteDataRoot, 'housing-data')
})

function makeRelease(minimumAppVersion = versionConfig.version, snapshot = bundled) {
  const release = buildRemoteRelease(snapshot, {
    cloudEnvId: config.cloudEnvId,
    storageBucket: config.storageBucket,
    minimumAppVersion,
    nextCheckAt: '2026-08-17T01:40:00.000Z',
    sourceBatchIds: ['official-html-2026-06-aaaaaaaaaaaa'],
    publicationIdentity: publicationIdentity(),
  })
  return attachControl(release)
}

function makeLegacyRelease(minimumAppVersion = versionConfig.version, snapshot = bundled) {
  return buildRemoteRelease(snapshot, {
    cloudEnvId: config.cloudEnvId,
    storageBucket: config.storageBucket,
    minimumAppVersion,
    nextCheckAt: '2026-08-17T01:40:00.000Z',
    sourceBatchIds: ['official-html-2026-06-aaaaaaaaaaaa'],
    publicationIdentity: publicationIdentity(),
  })
}

function completeFixture() {
  const snapshot = structuredClone(bundled)
  const paddingMonths = []
  for (let index = 0; index < 60; index += 1) {
    const date = new Date(`${bundled.months[0]}-01T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() - (60 - index))
    paddingMonths.push(date.toISOString().slice(0, 7))
  }
  snapshot.months = [...paddingMonths, ...snapshot.months]
  snapshot.coverageStart = paddingMonths[0]
  snapshot.sourceCoverageStart = paddingMonths[0]
  snapshot.releaseDates = [...Array(60).fill(`${addMonths(paddingMonths[0])}-17`), ...snapshot.releaseDates]
  for (const cityId of snapshot.cityIds) {
    for (const code of Object.keys(snapshot.series[cityId])) snapshot.series[cityId][code] = [...Array(60 * 4).fill(null), ...snapshot.series[cityId][code]]
  }
  snapshot.latestSeries = Object.fromEntries(snapshot.cityIds.map((cityId) => [cityId, Object.fromEntries(Object.entries(snapshot.series[cityId]).map(([code, values]) => [code, values.slice(-4)]))]))
  snapshot.breadthSeries = Object.fromEntries(Object.keys(snapshot.series[snapshot.cityIds[0]]).flatMap((code) => [['mom', 2], ['yoy', 3]].map(([metric, offset]) => [
    `${code}_${metric}`,
    snapshot.months.flatMap((_month, monthIndex) => snapshot.cityIds.reduce((counts, cityId) => {
      const value = snapshot.series[cityId][code][monthIndex * 4 + offset]
      counts[value === null ? 3 : value > 0 ? 0 : value < 0 ? 2 : 1] += 1
      return counts
    }, [0, 0, 0, 0])),
  ])))
  return snapshot
}

function completeSourceBatchIds(snapshot) {
  return snapshot.months.map((month, index) => `official-html-${month}-${index.toString(16).padStart(12, '0')}`)
}

function completeAuditIdentity() {
  return {
    auditVersion: 'full-record-audit-v7',
    auditMethod: 'automated-full-record-audit-v7: fixture',
    repositoryCommitSha: 'a'.repeat(40),
    auditCodeSha256: 'b'.repeat(64),
    reportSha256: 'c'.repeat(64),
    parserVersions: ['official-html-v9-product-housing-only-strict-release-date'],
    recordsSha256: 'd'.repeat(64),
    sourceIndexSha256: 'e'.repeat(64),
  }
}

function completeReleaseOptions(snapshot, overrides = {}) {
  return {
    cloudEnvId: config.cloudEnvId,
    storageBucket: config.storageBucket,
    minimumAppVersion: versionConfig.version,
    nextCheckAt: '2026-08-17T01:40:00.000Z',
    sourceBatchIds: completeSourceBatchIds(snapshot),
    auditIdentity: completeAuditIdentity(),
    ...overrides,
  }
}

function makeCompleteRelease(minimumAppVersion = versionConfig.version) {
  const snapshot = completeFixture()
  return attachControl(buildCompleteRemoteRelease(snapshot, completeReleaseOptions(snapshot, { minimumAppVersion })))
}

function appendRollbackRevocations(registry, {
  failedRelease,
  targetRelease,
  revokedAt,
  replacementDatasetVersion = targetRelease.current.dataset_version,
  reason,
}) {
  return appendFailedReleaseRevocations(registry, {
    datasetVersion: failedRelease.current.dataset_version,
    sourceDatasetVersion: failedRelease.current.source_dataset_version,
    revokedAt,
    replacementDatasetVersion,
    replacementSourceDatasetVersion: targetRelease.current.source_dataset_version,
    revisionId: buildRollbackRevisionId(failedRelease.current.dataset_version),
    reason,
  })
}

function controlWindow(now) {
  return {
    controlGeneratedAt: new Date(now - 60_000).toISOString(),
    controlValidUntil: new Date(now + 23 * 60 * 60 * 1000).toISOString(),
  }
}

function cloudFiles(release) {
  if (release.completeSnapshotText) {
    return new Map([
      ...(release.revocationArtifact ? [[release.revocationArtifact.cloudFileId, release.revocationArtifact.text]] : []),
      [release.current.manifest_file_id, release.manifestText],
      [release.manifest.complete_snapshot_file_id, release.completeSnapshotText],
    ])
  }
  return new Map([
    ...(release.revocationArtifact ? [[release.revocationArtifact.cloudFileId, release.revocationArtifact.text]] : []),
    [release.current.manifest_file_id, release.manifestText],
    [release.manifest.bootstrap_file_id, release.bootstrapText],
    ...(release.revisionManifestText ? [[release.manifest.revision_manifest_file_id, release.revisionManifestText]] : []),
    ...Object.values(release.cities).map((item) => [release.manifest.city_file_id_template.replace('{city_id}', item.data.cityId), item.text]),
  ])
}

function attachControl(release, {
  registry = createRevocationRegistry({ generatedAt: '2026-07-20T00:00:00.000Z' }),
  controlGeneration = 1,
  transitionType = 'publish',
  rollbackFromDatasetVersion,
  supersededDatasetVersion,
  supersededSourceDatasetVersion,
  controlGeneratedAt = new Date(Date.now() - 60_000).toISOString(),
  controlValidUntil = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
} = {}) {
  const artifact = buildRevocationRegistryArtifact(registry, { cloudEnvId: config.cloudEnvId, storageBucket: config.storageBucket })
  release.revocationArtifact = artifact
  Object.assign(release.current, {
    source_dataset_version: release.manifest.source_dataset_version,
    control_schema_version: '1.0.0',
    control_generation: controlGeneration,
    ...artifact.currentFields,
    transition_type: transitionType,
    data_status: 'current',
    status_reason: transitionType === 'rollback' ? 'post_publish_guard_failed' : 'test_publish',
    control_generated_at: controlGeneratedAt,
    control_valid_until: controlValidUntil,
    published_at: controlGeneratedAt,
    previous_dataset_version: transitionType === 'rollback' ? null : release.current.previous_dataset_version,
  })
  if (rollbackFromDatasetVersion) release.current.rollback_from_dataset_version = rollbackFromDatasetVersion
  if (transitionType === 'historical_correction') {
    release.current.superseded_dataset_version = supersededDatasetVersion
    release.current.superseded_source_dataset_version = supersededSourceDatasetVersion
  }
  return release
}

function runtimeState(mock) {
  return mock.storage.get(STATE_KEY)
}

function createWxMock(release, options = {}) {
  const files = options.files || new Map()
  const directories = options.directories || new Set(['/user', '/user/housing-data'])
  const storage = options.storage || new Map()
  const remote = options.remote || cloudFiles(release)
  const stats = { functionCalls: 0, downloads: 0, writes: 0, reads: 0, renames: 0, removals: 0, nextTicks: 0 }
  let activeCurrent = options.current || release.current
  let tempIndex = 0

  function ensureDirectories(path) {
    const parts = path.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current += `/${part}`
      directories.add(current)
    }
  }

  function removeTree(path) {
    if (options.failRmdir?.(path)) throw new Error(`EACCES: ${path}`)
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
      const stored = files.get(filePath)
      const value = options.mutateRead?.(filePath, stored, stats.reads) ?? stored
      return encoding ? value.toString(encoding) : value
    },
    readFile({ filePath, encoding, success, fail }) {
      try { success({ data: fs.readFileSync(filePath, encoding) }) } catch (error) { fail(error) }
    },
    writeFile({ filePath, data, success, fail }) {
      stats.writes += 1
      if (options.failWrite?.(filePath, stats.writes)) return fail(new Error(`ENOSPC: ${filePath}`))
      ensureDirectories(filePath.slice(0, filePath.lastIndexOf('/')))
      files.set(filePath, Buffer.from(data, 'utf8'))
      success({})
    },
    unlinkSync(filePath) {
      if (options.failUnlink?.(filePath)) throw new Error(`EACCES: ${filePath}`)
      if (!files.has(filePath)) throw new Error(`ENOENT: ${filePath}`)
      files.delete(filePath)
    },
    mkdir({ dirPath, success }) {
      ensureDirectories(dirPath)
      success({})
    },
    readdirSync(dirPath) {
      if (!directories.has(dirPath)) throw new Error(`ENOENT: ${dirPath}`)
      const prefix = `${dirPath}/`
      return [...new Set([
        ...[...directories].filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length).split('/')[0]),
        ...[...files.keys()].filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length).split('/')[0]),
      ].filter(Boolean))]
    },
    access({ path, success, fail }) {
      const exists = directories.has(path) || [...files.keys()].some((filePath) => filePath.startsWith(`${path}/`))
      if (exists) success({})
      else fail(new Error(`ENOENT: ${path}`))
    },
    rmdirSync(dirPath) {
      removeTree(dirPath)
    },
    rmdir({ dirPath, success, fail }) {
      if (options.failRmdir?.(dirPath)) return fail(new Error('rmdir:fail'))
      try {
        removeTree(dirPath)
        success({})
      } catch (error) {
        fail(error)
      }
    },
    rename({ oldPath, newPath, success, fail }) {
      stats.renames += 1
      if (options.failRename?.(oldPath, newPath, stats.renames)) return fail(new Error(`EIO: ${oldPath}`))
      const prefix = `${oldPath}/`
      const matchingFiles = [...files.entries()].filter(([path]) => path.startsWith(prefix))
      const matchingDirectories = [...directories].filter((path) => path === oldPath || path.startsWith(prefix))
      if (!matchingFiles.length && !matchingDirectories.length) return fail(new Error(`ENOENT: ${oldPath}`))
      for (const [path, value] of matchingFiles) {
        files.delete(path)
        files.set(`${newPath}${path.slice(oldPath.length)}`, value)
      }
      for (const path of matchingDirectories) directories.delete(path)
      ensureDirectories(newPath)
      for (const path of matchingDirectories) directories.add(`${newPath}${path.slice(oldPath.length)}`)
      options.afterRename?.({ oldPath, newPath, files, directories })
      success({})
    },
  }
  return {
    wxApi: {
      env: { USER_DATA_PATH: '/user' },
      getFileSystemManager: () => fs,
      nextTick(callback) {
        stats.nextTicks += 1
        callback()
      },
      getStorageSync: (key) => {
        if (options.failGetStorage?.(key)) throw new Error(`storage read failure: ${key}`)
        return storage.get(key)
      },
      setStorageSync: (key, value) => {
        if (options.failStorage?.(key, value)) throw new Error(`storage failure: ${key}`)
        storage.set(key, structuredClone(value))
      },
      removeStorageSync: (key) => {
        if (options.failRemoveStorage?.(key)) throw new Error(`storage remove failure: ${key}`)
        storage.delete(key)
      },
      cloud: {
        callFunction({ success, fail }) {
          stats.functionCalls += 1
          if (options.functionPromiseError) return Promise.reject(options.functionPromiseError)
          if (options.functionError) return fail(options.functionError)
          const receiptNow = typeof options.receiptNow === 'function'
            ? options.receiptNow()
            : (options.receiptNow ?? Date.now())
          const validationReceipt = options.validationReceipt === undefined
            ? buildValidationReceipt(activeCurrent, receiptNow)
            : (typeof options.validationReceipt === 'function'
                ? options.validationReceipt(activeCurrent, receiptNow)
                : options.validationReceipt)
          success({
            result: {
              current: structuredClone(activeCurrent),
              ...(validationReceipt ? { validation_receipt: structuredClone(validationReceipt) } : {}),
            },
          })
        },
        downloadFile({ fileID, success, fail }) {
          stats.downloads += 1
          if (options.downloadPromiseError) return Promise.reject(options.downloadPromiseError)
          const value = remote.get(fileID)
          if (value === undefined) return fail(new Error(`remote file missing: ${fileID}`))
          const tempFilePath = `/temp/${tempIndex += 1}`
          files.set(tempFilePath, Buffer.from(value, 'utf8'))
          success({ tempFilePath })
        },
      },
    },
    files,
    directories,
    remote,
    storage,
    stats,
    setCurrent(value) { activeCurrent = value },
  }
}

function correctionRelease(base = correctionBaseSnapshot()) {
  const corrected = {
    ...base,
    datasetVersion: '2026-06-222222222222',
    sourceDatasetVersion: '2026-06-333333333333',
  }
  const release = buildRemoteRelease(corrected, {
    cloudEnvId: config.cloudEnvId,
    storageBucket: config.storageBucket,
    minimumAppVersion: config.correctionMinimumAppVersion,
    nextCheckAt: '2026-08-17T01:40:00.000Z',
    sourceBatchIds: ['official-html-2026-06-bbbbbbbbbbbb'],
    publicationIdentity: correctionPublicationIdentity(),
    correction: {
      revision_id: 'revision-2026-06-audited-fix', release_type: 'historical_correction', reason_type: 'official_revision', approval_status: 'approved',
      dataset_as_of: '2026-06', supersedes_source_dataset_version: base.sourceDatasetVersion, source_dataset_version: corrected.sourceDatasetVersion,
      source_version_chain: [base.sourceDatasetVersion, corrected.sourceDatasetVersion], revoked_source_dataset_versions: [base.sourceDatasetVersion],
      reason: '国家统计局官方原始表经全量复核后的历史数据修订', official_urls: ['https://www.stats.gov.cn/source'],
      latest_source_batch_ids: ['official-html-2026-06-bbbbbbbbbbbb'], revision_source_batch_ids: ['official-html-2026-06-bbbbbbbbbbbb'], parser_version: 'official-html-v7-product-housing-only', audit_version: 'full-record-audit-v7',
      candidate_records_sha256: 'a'.repeat(64), audit_records_sha256: 'b'.repeat(64), source_index_sha256: 'c'.repeat(64), audit_report_sha256: 'd'.repeat(64),
      audit_commit_sha: 'e'.repeat(40), audit_code_sha256: 'f'.repeat(64), ledger_before_sha256: '1'.repeat(64), ledger_after_sha256: '2'.repeat(64),
      ledger_append_start: 0, ledger_append_count: 1, ledger_append_sha256: '3'.repeat(64), commit_sha: '4'.repeat(40), github_run_id: '12345',
      approved_at: '2026-07-20T00:00:00Z', approved_by: 'data-owner', changes: [{
        record_key: '2026-06|fuzhou|new|all', field: 'mom_index', old_value: 99.8, new_value: 99.9,
        source_url: 'https://www.stats.gov.cn/source', source_record_locator: 'table[0] row[1]',
      }],
    },
  })
  const revisionId = release.revisionManifest.revision_id
  const registry = appendHistoricalCorrectionRevocations(
    createRevocationRegistry({ generatedAt: '2026-07-20T00:00:00.000Z' }),
    {
      datasetVersion: base.datasetVersion,
      sourceDatasetVersion: base.sourceDatasetVersion,
      revokedAt: '2026-07-20T00:15:00.000Z',
      revisionId,
      replacementDatasetVersion: release.current.dataset_version,
      replacementSourceDatasetVersion: release.manifest.source_dataset_version,
      reason: 'official historical correction superseded the audited package and source',
    },
  )
  const controlled = attachControl(release, {
    registry,
    transitionType: 'historical_correction',
    supersededDatasetVersion: base.datasetVersion,
    supersededSourceDatasetVersion: base.sourceDatasetVersion,
  })
  controlled.correctionBundled = base
  return controlled
}

function addMonths(month, count = 1) {
  const date = new Date(`${month}-01T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + count)
  return date.toISOString().slice(0, 7)
}

function nextMonthSnapshot() {
  const snapshot = structuredClone(bundled)
  const nextMonth = addMonths(snapshot.datasetAsOf)
  const releaseDate = `${addMonths(nextMonth)}-17`
  snapshot.months = [...snapshot.months.slice(1), nextMonth]
  snapshot.releaseDates = [...snapshot.releaseDates.slice(1), releaseDate]
  snapshot.datasetAsOf = nextMonth
  snapshot.datasetVersion = `${nextMonth}-111111111111`
  snapshot.sourceDatasetVersion = `${nextMonth}-111111111111`
  snapshot.releaseDate = releaseDate
  snapshot.coverageStart = snapshot.months[0]
  return snapshot
}

function snapshotForMonth(datasetAsOf, sourceHash) {
  const end = new Date(`${datasetAsOf}-01T00:00:00.000Z`)
  const months = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(end)
    date.setUTCMonth(date.getUTCMonth() - (119 - index))
    return date.toISOString().slice(0, 7)
  })
  const releaseDate = new Date(end)
  releaseDate.setUTCMonth(releaseDate.getUTCMonth() + 1)
  const releaseDates = months.map((month) => {
    const date = new Date(`${month}-01T00:00:00.000Z`)
    date.setUTCMonth(date.getUTCMonth() + 1)
    return `${date.toISOString().slice(0, 7)}-17`
  })
  return {
    ...structuredClone(bundled),
    months,
    releaseDates,
    datasetAsOf,
    datasetVersion: `${datasetAsOf}-${sourceHash}`,
    sourceDatasetVersion: `${datasetAsOf}-${sourceHash}`,
    releaseDate: `${releaseDate.toISOString().slice(0, 7)}-17`,
    coverageStart: months[0],
  }
}

function correctionBaseSnapshot() {
  return snapshotForMonth('2026-06', '000000000000')
}

function createCorrectionRuntime(release, mock, options = {}) {
  return createDataRuntime({ wxApi: mock.wxApi, bundled: release.correctionBundled, ...options })
}

function snapshotWithNullPreSourcePadding() {
  const snapshot = structuredClone(bundled)
  snapshot.sourceCoverageStart = snapshot.months[1]
  snapshot.releaseDates[0] = ''
  for (const citySeries of Object.values(snapshot.series)) {
    for (const values of Object.values(citySeries)) values.splice(0, 4, null, null, null, null)
  }
  return snapshot
}

function rebuildBootstrapArtifacts(release) {
  release.bootstrapText = `${JSON.stringify(release.bootstrap)}\n`
  release.manifest.bootstrap_sha256 = sha256(utf8Bytes(release.bootstrapText))
  release.manifest.bootstrap_bytes = utf8Bytes(release.bootstrapText).byteLength
  release.manifestText = `${JSON.stringify(release.manifest)}\n`
  release.current.manifest_sha256 = sha256(utf8Bytes(release.manifestText))
  return release
}

test('mini program SHA-256 matches standard UTF-8 vectors and staged bytes', () => {
  for (const value of ['', 'abc', '住房小二']) {
    assert.equal(sha256(utf8Bytes(value)), createHash('sha256').update(value).digest('hex'))
  }
  const release = makeRelease()
  assert.equal(sha256(utf8Bytes(release.bootstrapText)), release.manifest.bootstrap_sha256)
})

test('chunked SHA-256 matches the native digest and yields between large-data chunks', async () => {
  const bytes = utf8Bytes('a'.repeat(300_000))
  let yields = 0
  const actual = await sha256Async(bytes, {
    chunkBytes: 64 * 1024,
    yieldFn: async () => { yields += 1 },
  })
  assert.equal(actual, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(yields, 4)
})

test('v2 complete remote package activates atomically without city shards and survives restart', async () => {
  const release = makeCompleteRelease()
  const mock = createWxMock(release)
  const runtime = createDataRuntime({ wxApi: mock.wxApi })
  const result = await runtime.refresh({ force: true })
  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().months.length, 180)
  assert.equal(runtime.getSnapshot().coverageStart, release.manifest.coverage_start)
  assert.equal(mock.stats.downloads, 3)
  assert.ok(mock.stats.nextTicks > 30, 'large complete-package cache verification should yield to AppService')
  assert.ok(mock.files.has(`/user/housing-data/${release.current.dataset_version}/complete-snapshot.json`))
  assert.equal(await runtime.ensureCities(['haikou']), true)
  assert.equal(mock.stats.downloads, 3)

  const restarted = createDataRuntime({ wxApi: mock.wxApi })
  assert.equal(restarted.getSource(), 'remote')
  assert.equal(restarted.getSnapshot().months.length, 180)
})

test('preview diagnostics identify every complete-package update stage without exposing file IDs', async () => {
  const release = makeCompleteRelease()
  const mock = createWxMock(release)
  const entries = []
  const originalInfo = console.info
  console.info = (...args) => entries.push(args)
  try {
    const runtime = createDataRuntime({ wxApi: mock.wxApi, config: { ...config, previewMode: true } })
    assert.equal((await runtime.refresh({ force: true })).updated, true)
  } finally {
    console.info = originalInfo
  }
  const diagnostics = entries
    .filter(([prefix]) => prefix === '[data:update:diag]')
    .map(([, payload]) => JSON.parse(payload))
  const stages = diagnostics.map((entry) => entry.stage)
  for (const stage of ['refresh-start', 'manifest-function-start', 'manifest-function-ok', 'control-start', 'registry-download-start', 'registry-ok', 'manifest-download-start', 'manifest-ok', 'complete-download-start', 'complete-received', 'complete-validated', 'cache-start', 'cache-ok', 'activated-remote']) {
    assert.ok(stages.includes(stage), `missing diagnostic stage: ${stage}`)
  }
  assert.equal(diagnostics.some((entry) => Object.values(entry).some((value) => typeof value === 'string' && value.includes('cloud://'))), false)
})

test('preview diagnostics identify the exact cache step when iOS rmdir fails', async () => {
  const release = makeCompleteRelease()
  const entries = []
  const originalInfo = console.info
  console.info = (...args) => entries.push(args)
  try {
    const directories = new Set(['/user', '/user/housing-data', `/user/housing-data/.tmp-${release.current.dataset_version}`])
    const mock = createWxMock(release, { directories, failRmdir: (path) => path.endsWith(`.tmp-${release.current.dataset_version}`) })
    const runtime = createDataRuntime({ wxApi: mock.wxApi, config: { ...config, previewMode: true } })
    const result = await runtime.refresh({ force: true })
    assert.equal(result.reason, 'failed')
    assert.equal(runtime.getSource(), 'bundled')
  } finally {
    console.info = originalInfo
  }
  const diagnostics = entries
    .filter(([prefix]) => prefix === '[data:update:diag]')
    .map(([, payload]) => JSON.parse(payload))
  assert.ok(diagnostics.some((entry) => entry.stage === 'cache-step-failed'
    && entry.step === 'remove-temporary-directory'
    && entry.error === 'rmdir:fail'))
  assert.ok(diagnostics.some((entry) => entry.stage === 'refresh-failed'
    && entry.failedStage === 'cache-start'))
})

test('missing temporary cache directory does not call iOS rmdir and still activates the verified package', async () => {
  const release = makeCompleteRelease()
  const mock = createWxMock(release, { failRmdir: (path) => path.endsWith(`.tmp-${release.current.dataset_version}`) })
  const runtime = createDataRuntime({ wxApi: mock.wxApi, config: { ...config, previewMode: true } })
  const result = await runtime.refresh({ force: true })
  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().months.length, 180)
})

test('preview controls are accepted only by the preview root', () => {
  const snapshot = completeFixture()
  const release = buildCompleteRemoteRelease(snapshot, completeReleaseOptions(snapshot, { dataRoot: 'housing-data/preview' }))
  const registry = createRevocationRegistry({ generatedAt: '2026-07-20T00:00:00.000Z' })
  const artifact = buildRevocationRegistryArtifact(registry, { cloudEnvId: config.cloudEnvId, storageBucket: config.storageBucket, dataRoot: 'housing-data/preview' })
  const current = {
    ...release.current,
    published_at: '2026-07-20T00:00:00.000Z',
    control_schema_version: '1.0.0', control_generation: 1,
    ...artifact.currentFields,
    transition_type: 'publish', data_status: 'current', status_reason: 'isolated_development_preview',
    control_generated_at: '2026-08-30T00:00:00.000Z', control_valid_until: '2026-08-31T00:00:00.000Z',
  }
  assert.equal(validateCurrent(current, { config: { ...config, remoteDataRoot: 'housing-data/preview' }, allowLegacy: false, requireContext: true, manifest: release.manifest, registry }), current)
  assert.throws(() => validateCurrent(current, { config, allowLegacy: false }), /manifest file ID is invalid/)

  release.current = current
  release.revocationArtifact = artifact
  const mock = createWxMock(release)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, config: { ...config, remoteDataRoot: 'housing-data/preview' } })
  return runtime.refresh({ force: true }).then((result) => {
    assert.equal(result.updated, true)
    assert.equal(runtime.getSource(), 'remote')
    assert.equal(runtime.getSnapshot().months.length, 180)
  })
})

test('preview runtime state and cache are isolated from the formal runtime', async () => {
  const snapshot = completeFixture()
  const release = buildCompleteRemoteRelease(snapshot, completeReleaseOptions(snapshot, { dataRoot: 'housing-data/preview' }))
  const registry = createRevocationRegistry({ generatedAt: '2026-07-20T00:00:00.000Z' })
  const artifact = buildRevocationRegistryArtifact(registry, { cloudEnvId: config.cloudEnvId, storageBucket: config.storageBucket, dataRoot: 'housing-data/preview' })
  release.current = {
    ...release.current,
    control_schema_version: '1.0.0', control_generation: 1,
    ...artifact.currentFields,
    transition_type: 'publish', data_status: 'current', status_reason: 'isolated_development_preview',
    published_at: '2026-08-30T00:00:00.000Z',
    control_generated_at: '2026-08-30T00:00:00.000Z', control_valid_until: '2026-08-31T00:00:00.000Z',
  }
  release.revocationArtifact = artifact
  const mock = createWxMock(release)
  const preview = createDataRuntime({ wxApi: mock.wxApi, config: { ...config, previewMode: true, remoteDataRoot: 'housing-data/preview' } })
  assert.equal((await preview.refresh({ force: true })).updated, true)
  assert.ok(mock.storage.has(`${STATE_KEY}-preview`))
  assert.equal(mock.storage.has(STATE_KEY), false)
  assert.ok(mock.directories.has(`/user/housing-data/preview/${release.current.dataset_version}`))
  assert.equal(mock.directories.has(`/user/housing-data/${release.current.dataset_version}`), false)
})

test('v2 complete package corruption never replaces the bundled snapshot', async () => {
  const release = makeCompleteRelease()
  const remote = cloudFiles(release)
  remote.set(release.manifest.complete_snapshot_file_id, `${release.completeSnapshotText} `)
  const mock = createWxMock(release, { remote })
  const runtime = createDataRuntime({ wxApi: mock.wxApi })
  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtime.getSnapshot().months.length, 120)
  assert.equal(mock.files.has(`/user/housing-data/${release.current.dataset_version}/complete-snapshot.json`), false)
})

test('native cloud Promise rejections are handled and retain bundled data', async () => {
  const release = makeCompleteRelease()
  const mock = createWxMock(release, { functionPromiseError: new Error('SystemError timeout') })
  const runtime = createDataRuntime({ wxApi: mock.wxApi })
  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtime.getSnapshot().months.length, 120)
})

test('native download Promise rejections are handled and retain bundled data', async () => {
  const release = makeCompleteRelease()
  const mock = createWxMock(release, { downloadPromiseError: new Error('SystemError timeout') })
  const runtime = createDataRuntime({ wxApi: mock.wxApi })
  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtime.getSnapshot().months.length, 120)
})

test('first online launch atomically activates remote data and valid cache hydrates synchronously', async () => {
  const release = makeRelease()
  const mock = createWxMock(release)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  const result = await runtime.refresh({ requiredCityIds: ['taiyuan'], force: true })

  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.hasCity('taiyuan'), true)
  assert.equal(runtimeState(mock).active.datasetVersion, release.current.dataset_version)
  assert.equal(runtimeState(mock).active.cachedCityIds.length, 70)
  assert.equal(mock.stats.downloads, 3)

  const restored = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal(restored.getSource(), 'remote')
  assert.equal(restored.hasCity('taiyuan'), true)
})

test('successful schedule suppresses cloud checks until next check time', async () => {
  const now = Date.parse('2026-07-01T00:00:00.000Z')
  const release = attachControl(makeRelease(), controlWindow(now))
  const mock = createWxMock(release, { receiptNow: now })
  const first = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => now })
  await first.refresh({ force: true })
  const state = runtimeState(mock)
  state.schedule.dataNextCheckAt = now + 60_000
  state.schedule.controlNextCheckAt = now + 60_000
  mock.storage.set(STATE_KEY, state)
  mock.stats.functionCalls = 0
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => now })

  const result = await runtime.refresh()
  assert.equal(result.reason, 'not-due')
  assert.equal(mock.stats.functionCalls, 0)
})

test('unchanged remote data retries shortly when the official check time is already due', async () => {
  const now = Date.parse('2026-07-15T01:45:00.000Z')
  const release = attachControl(makeRelease(), controlWindow(now))
  release.current.next_check_at = '2026-07-15T01:35:00.000Z'
  const mock = createWxMock(release, { receiptNow: now })
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => now })

  assert.equal((await runtime.refresh({ force: true })).updated, true)
  const result = await runtime.refresh({ force: true })

  assert.equal(result.reason, 'current')
  assert.equal(runtimeState(mock).schedule.dataNextCheckAt, now + config.releaseRetryMs)
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
  assert.equal(runtimeState(mock).active.cachedCityIds.length, 70)
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
  assert.equal(mock.stats.downloads, 67)
  assert.equal(Object.keys(runtime.getSnapshot().series).length, 70)
  const downloadsAfterUpdate = mock.stats.downloads
  await runtime.ensureCities(['taiyuan', 'haikou', 'xining'])
  assert.equal(mock.stats.downloads, downloadsAfterUpdate)
})

test('remote bootstrap with false client-window coverage is rejected before activation', async () => {
  const release = makeRelease()
  release.bootstrap.coverageStart = release.bootstrap.sourceCoverageStart
  release.bootstrapText = `${JSON.stringify(release.bootstrap)}\n`
  release.manifest.bootstrap_sha256 = sha256(utf8Bytes(release.bootstrapText))
  release.manifest.bootstrap_bytes = utf8Bytes(release.bootstrapText).byteLength
  release.manifestText = `${JSON.stringify(release.manifest)}\n`
  release.current.manifest_sha256 = sha256(utf8Bytes(release.manifestText))
  const mock = createWxMock(release)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })

  assert.equal((await runtime.refresh({ force: true })).reason, 'failed')
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtime.getSnapshot().coverageStart, runtime.getSnapshot().months[0])
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

test('first-launch failures keep the independently audited bundled data available', async () => {
  const release = makeRelease()
  const offline = createWxMock(release, { functionError: new Error('offline') })
  const offlineRuntime = createDataRuntime({ wxApi: offline.wxApi, bundled })
  assert.equal(offlineRuntime.getSource(), 'bundled')
  assert.equal(offlineRuntime.getSnapshot(), bundled)
  assert.equal((await offlineRuntime.refresh({ force: true })).reason, 'failed')
  assert.equal(offlineRuntime.getSource(), 'bundled')
  assert.equal(offlineRuntime.getSnapshot(), bundled)
  assert.ok(Number(runtimeState(offline).schedule.dataNextCheckAt) > Date.now())

  const corruptRemote = cloudFiles(release)
  corruptRemote.set(release.current.manifest_file_id, `${release.manifestText} `)
  const corrupt = createWxMock(release, { remote: corruptRemote })
  const corruptRuntime = createDataRuntime({ wxApi: corrupt.wxApi, bundled })
  assert.equal((await corruptRuntime.refresh({ force: true })).reason, 'failed')
  assert.equal(corruptRuntime.getSource(), 'bundled')
  assert.equal(corruptRuntime.getSnapshot(), bundled)

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

test('a structurally invalid bundled snapshot fails closed before page calculations run', async (t) => {
  const mutations = [
    ['non-finite series value', (snapshot) => { snapshot.series.beijing.n_a[0] = Number.POSITIVE_INFINITY }],
    ['missing city search metadata', (snapshot) => { delete snapshot.cityMap.beijing.search }],
    ['dataset version month mismatch', (snapshot) => { snapshot.datasetVersion = '2025-06-000000000000' }],
    ['untrusted official URL', (snapshot) => { snapshot.latestOfficialUrl = 'https://example.com/not-official' }],
    ['missing source coverage start', (snapshot) => { delete snapshot.sourceCoverageStart }],
    ['invalid source coverage start', (snapshot) => { snapshot.sourceCoverageStart = '2016-13' }],
    ['source coverage starts after the client window', (snapshot) => { snapshot.sourceCoverageStart = snapshot.months.at(-1) }],
    ['pre-source padding contains a data value', (snapshot) => { snapshot.sourceCoverageStart = snapshot.months[1] }],
  ]
  for (const [label, mutate] of mutations) {
    await t.test(label, () => {
      const invalidBundled = structuredClone(bundled)
      mutate(invalidBundled)
      const runtime = createDataRuntime({ wxApi: null, bundled: invalidBundled })

      assert.equal(runtime.getSource(), 'unavailable')
      assert.equal(runtime.getSnapshot().dataStatus, 'unavailable')
      assert.deepEqual(runtime.getSnapshot().cityIds, [])
      assert.deepEqual(runtime.getSnapshot().series, {})
    })
  }
})

test('a bundled snapshot accepts only null padding before a later in-window source coverage start', () => {
  const padded = snapshotWithNullPreSourcePadding()
  const runtime = createDataRuntime({ wxApi: null, bundled: padded })
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtime.getSnapshot().sourceCoverageStart, padded.months[1])
  assert.deepEqual(runtime.getSnapshot().series.beijing.n_a.slice(0, 4), [null, null, null, null])
})

test('same-month remote conflicts cannot replace the audited bundled snapshot or hydrate from cache', async () => {
  const conflictingSnapshot = {
    ...bundled,
    datasetVersion: `${bundled.datasetAsOf}-000000000000`,
    sourceDatasetVersion: `${bundled.datasetAsOf}-000000000000`,
  }
  const release = makeRelease(versionConfig.version, conflictingSnapshot)
  const mock = createWxMock(release)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })

  assert.equal((await runtime.refresh({ force: true })).reason, 'failed')
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(mock.stats.downloads, 2)

  const legacyRuntime = createDataRuntime({ wxApi: mock.wxApi, bundled: conflictingSnapshot })
  assert.equal((await legacyRuntime.refresh({ force: true })).updated, true)
  assert.equal(legacyRuntime.getSource(), 'remote')

  const restored = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal(restored.getSource(), 'bundled')
  assert.equal(restored.getSnapshot().datasetVersion, bundled.datasetVersion)
})

test('an older same-source remote package and cache quietly keep the newer bundled package', async () => {
  const olderSnapshot = {
    ...bundled,
    generatedAt: new Date(Date.parse(bundled.generatedAt) - 60_000).toISOString(),
  }
  const release = makeRelease(versionConfig.version, olderSnapshot)
  const directMock = createWxMock(release)
  const direct = createDataRuntime({ wxApi: directMock.wxApi, bundled })
  const result = await direct.refresh({ force: true })

  assert.equal(result.updated, false)
  assert.equal(result.reason, 'bundled-source-is-newer')
  assert.equal(direct.getSource(), 'bundled')
  assert.equal(runtimeState(directMock).active, null)

  const cacheMock = createWxMock(release)
  const olderRuntime = createDataRuntime({ wxApi: cacheMock.wxApi, bundled: olderSnapshot })
  assert.equal((await olderRuntime.refresh({ force: true })).updated, true)
  assert.equal(olderRuntime.getSource(), 'remote')

  const restored = createDataRuntime({ wxApi: cacheMock.wxApi, bundled })
  assert.equal(restored.getSource(), 'bundled')
  assert.equal(restored.getSnapshot().datasetVersion, bundled.datasetVersion)
  assert.equal(runtimeState(cacheMock).active, null)
})

test('same-month conflict is rejected against a newer active remote month, not only against bundled data', async () => {
  const newer = nextMonthSnapshot()
  const first = makeRelease(versionConfig.version, newer)
  const mock = createWxMock(first)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal((await runtime.refresh({ force: true })).updated, true)

  const conflicting = {
    ...newer,
    datasetVersion: `${newer.datasetAsOf}-222222222222`,
    sourceDatasetVersion: `${newer.datasetAsOf}-222222222222`,
  }
  const second = makeRelease(versionConfig.version, conflicting)
  const secondMock = createWxMock(second, { files: mock.files, storage: mock.storage })
  const restored = createDataRuntime({ wxApi: secondMock.wxApi, bundled })
  assert.equal(restored.getSnapshot().datasetVersion, first.current.dataset_version)
  assert.equal((await restored.refresh({ force: true })).reason, 'failed')
  assert.equal(restored.getSnapshot().datasetVersion, first.current.dataset_version)
})

test('valid same-month audited correction activates atomically and revokes the superseded source', async () => {
  const release = correctionRelease()
  const mock = createWxMock(release)
  const runtime = createCorrectionRuntime(release, mock)
  const result = await runtime.refresh({ force: true })
  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(mock.stats.downloads, 4)
  assert.deepEqual(runtimeState(mock).control.revokedSourceDatasetVersions, [release.correctionBundled.sourceDatasetVersion])
  assert.equal(runtimeState(mock).active.cachedCityIds.length, 70)
  const restored = createCorrectionRuntime(release, mock)
  assert.equal(restored.getSource(), 'remote')
})

test('broken correction chains, damaged revision manifests, and revoked downgrades are rejected', async () => {
  const broken = correctionRelease()
  broken.revisionManifest.source_version_chain = ['2026-06-333333333333', broken.manifest.source_dataset_version]
  broken.revisionManifestText = `${JSON.stringify(broken.revisionManifest)}\n`
  broken.manifest.revision_manifest_sha256 = createHash('sha256').update(broken.revisionManifestText).digest('hex')
  broken.manifest.revision_manifest_bytes = Buffer.byteLength(broken.revisionManifestText)
  broken.manifestText = `${JSON.stringify(broken.manifest)}\n`
  broken.current.manifest_sha256 = createHash('sha256').update(broken.manifestText).digest('hex')
  const brokenMock = createWxMock(broken)
  assert.equal((await createCorrectionRuntime(broken, brokenMock).refresh({ force: true })).reason, 'failed')

  const damaged = correctionRelease()
  const damagedFiles = cloudFiles(damaged)
  damagedFiles.set(damaged.manifest.revision_manifest_file_id, `${damaged.revisionManifestText} `)
  const damagedMock = createWxMock(damaged, { remote: damagedFiles })
  assert.equal((await createCorrectionRuntime(damaged, damagedMock).refresh({ force: true })).reason, 'failed')

  const monthly = makeRelease()
  const revoked = createWxMock(monthly)
  revoked.storage.set(REVOKED_SOURCES_KEY, [broken.correctionBundled.sourceDatasetVersion])
  const revokedRuntime = createDataRuntime({ wxApi: revoked.wxApi, bundled: broken.correctionBundled })
  assert.equal(revokedRuntime.getSource(), 'unavailable')
  assert.equal(revokedRuntime.getSnapshot().dataStatus, 'unavailable')
  assert.deepEqual(revokedRuntime.getSnapshot().series, {})
  assert.deepEqual(revokedRuntime.getSnapshot().cityIds, [])
  assert.equal((await revokedRuntime.refresh({ force: true })).reason, 'failed')
})

test('a bundled revocation survives main-state persistence failure and restart', async () => {
  const correction = correctionRelease()
  const failing = createWxMock(correction, { failStorage: (key) => key === STATE_KEY })
  const failingRuntime = createCorrectionRuntime(correction, failing)
  assert.equal((await failingRuntime.refresh({ force: true })).reason, 'failed')
  assert.equal(failingRuntime.getSource(), 'unavailable')
  assert.equal(failing.storage.has(CONTROL_TOMBSTONE_KEY), true)

  const offline = createWxMock(correction, {
    files: failing.files,
    storage: failing.storage,
    remote: failing.remote,
    functionError: new Error('offline'),
  })
  const restored = createCorrectionRuntime(correction, offline)
  assert.equal(restored.getSource(), 'unavailable')
  assert.equal(restored.getSnapshot().dataStatus, 'unavailable')
  assert.equal((await restored.refresh({ force: true })).reason, 'failed')
  assert.equal(restored.getSource(), 'unavailable')
})

test('a control tombstone write failure immediately stops revoked bundled and remote data', async (t) => {
  await t.test('bundled source', async () => {
    const correction = correctionRelease()
    const mock = createWxMock(correction, { failStorage: (key) => key === CONTROL_TOMBSTONE_KEY })
    const runtime = createCorrectionRuntime(correction, mock)

    const result = await runtime.refresh({ force: true })
    assert.equal(result.reason, 'failed')
    assert.equal(runtime.getSource(), 'unavailable')
    assert.equal(runtime.getSnapshot().dataStatus, 'unavailable')
  })

  await t.test('remote active package', async () => {
    const badRelease = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()))
    const initial = createWxMock(badRelease)
    const initialRuntime = createDataRuntime({ wxApi: initial.wxApi, bundled })
    assert.equal((await initialRuntime.refresh({ force: true })).updated, true)

    const safeRelease = makeRelease()
    const registry = appendRollbackRevocations(badRelease.revocationArtifact.registry, {
      failedRelease: badRelease,
      targetRelease: safeRelease,
      revokedAt: '2026-07-20T00:15:00.000Z',
      reason: 'post-publish full guard rejected the candidate package',
    })
    attachControl(safeRelease, {
      registry,
      controlGeneration: 2,
      transitionType: 'rollback',
      rollbackFromDatasetVersion: badRelease.current.dataset_version,
    })
    for (const [fileId, text] of cloudFiles(safeRelease)) initial.remote.set(fileId, text)
    const failing = createWxMock(safeRelease, {
      files: initial.files,
      storage: initial.storage,
      remote: initial.remote,
      failStorage: (key) => key === CONTROL_TOMBSTONE_KEY,
    })
    const runtime = createDataRuntime({ wxApi: failing.wxApi, bundled })

    const result = await runtime.refresh({ force: true })
    assert.equal(result.reason, 'failed')
    assert.equal(runtime.getSource(), 'bundled')
    assert.notEqual(runtime.getSnapshot().datasetVersion, badRelease.current.dataset_version)
    assert.equal(failing.files.has(`/user/housing-data/${badRelease.current.dataset_version}/manifest.json`), false)
  })
})

test('revocation persistence failures rebuild and retain a verified remote fallback', async (t) => {
  const first = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()), { controlGeneration: 1 })
  const initial = createWxMock(first)
  const initialRuntime = createDataRuntime({ wxApi: initial.wxApi, bundled })
  assert.equal((await initialRuntime.refresh({ force: true })).updated, true)

  const second = attachControl(makeRelease(versionConfig.version, snapshotForMonth(addMonths(bundled.datasetAsOf, 2), '222222222222')), {
    registry: first.revocationArtifact.registry,
    controlGeneration: 2,
  })
  for (const [fileId, text] of cloudFiles(second)) initial.remote.set(fileId, text)
  initial.setCurrent(second.current)
  assert.equal((await initialRuntime.refresh({ force: true })).updated, true)
  assert.equal(runtimeState(initial).fallback.datasetVersion, first.current.dataset_version)

  const rollbackRegistry = appendRollbackRevocations(second.revocationArtifact.registry, {
    failedRelease: second,
    targetRelease: first,
    revokedAt: '2026-07-20T00:30:00.000Z',
    reason: 'latest package failed the post-publish guard',
  })
  const rollback = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()), {
    registry: rollbackRegistry,
    controlGeneration: 3,
    transitionType: 'rollback',
    rollbackFromDatasetVersion: second.current.dataset_version,
  })
  for (const [fileId, text] of cloudFiles(rollback)) initial.remote.set(fileId, text)

  const failures = [
    ['control tombstone', (key) => key === CONTROL_TOMBSTONE_KEY],
    ['pending main state', (key, value) => key === STATE_KEY && value.status === 'pending-rollback'],
  ]
  for (const [label, failStorage] of failures) {
    await t.test(label, async () => {
      const files = new Map([...initial.files].map(([path, value]) => [path, Buffer.from(value)]))
      const directories = new Set(initial.directories)
      const storage = new Map([...initial.storage].map(([key, value]) => [key, structuredClone(value)]))
      const remote = new Map(initial.remote)
      const failing = createWxMock(rollback, { files, directories, storage, remote, failStorage })
      const runtime = createDataRuntime({ wxApi: failing.wxApi, bundled })
      assert.equal(runtime.getSnapshot().datasetVersion, second.current.dataset_version)

      const result = await runtime.refresh({ force: true })
      assert.equal(result.reason, 'failed')
      assert.equal(result.updated, true)
      assert.equal(runtime.getSource(), 'remote')
      assert.equal(runtime.getSnapshot().datasetVersion, first.current.dataset_version)

      const recovered = createWxMock(rollback, { files, directories, storage, remote })
      const restored = createDataRuntime({ wxApi: recovered.wxApi, bundled })
      assert.equal(restored.getSource(), 'remote')
      assert.equal(restored.getSnapshot().datasetVersion, first.current.dataset_version)
      assert.notEqual(restored.getSnapshot().datasetVersion, second.current.dataset_version)
    })
  }
})

test('an authorized rollback revokes an active newer month and survives restart on the safe target', async () => {
  const badRelease = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()))
  const mock = createWxMock(badRelease)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal((await runtime.refresh({ force: true })).updated, true)
  assert.equal(runtime.getSnapshot().datasetAsOf, addMonths(bundled.datasetAsOf))

  const safeRelease = makeRelease()
  const rollbackRegistry = appendRollbackRevocations(badRelease.revocationArtifact.registry, {
    failedRelease: badRelease,
    targetRelease: safeRelease,
    revokedAt: '2026-07-20T00:15:00.000Z',
    reason: 'post-publish full guard rejected the candidate package',
  })
  attachControl(safeRelease, {
    registry: rollbackRegistry,
    controlGeneration: 2,
    transitionType: 'rollback',
    rollbackFromDatasetVersion: badRelease.current.dataset_version,
  })
  for (const [fileId, text] of cloudFiles(safeRelease)) mock.remote.set(fileId, text)
  mock.setCurrent(safeRelease.current)

  const result = await runtime.refresh({ force: true })
  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().datasetVersion, safeRelease.current.dataset_version)
  assert.deepEqual(runtimeState(mock).control.revokedDatasetVersions, [badRelease.current.dataset_version])
  assert.equal(runtimeState(mock).active.datasetVersion, safeRelease.current.dataset_version)
  assert.equal(runtimeState(mock).pendingRollback, null)

  const sameRollback = await runtime.refresh({ force: true })
  assert.equal(sameRollback.updated, false)
  assert.equal(sameRollback.reason, 'current')

  const restored = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal(restored.getSource(), 'remote')
  assert.equal(restored.getSnapshot().datasetVersion, safeRelease.current.dataset_version)
  assert.equal((await restored.refresh({ force: true })).reason, 'current')
})

test('a fresh client safely activates a current rollback target whose registry closes the transition', async () => {
  const badRelease = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()))
  const safeRelease = makeRelease()
  const rollbackRegistry = appendRollbackRevocations(badRelease.revocationArtifact.registry, {
    failedRelease: badRelease,
    targetRelease: safeRelease,
    revokedAt: '2026-07-20T00:15:00.000Z',
    reason: 'post-publish full guard rejected the candidate package',
  })
  attachControl(safeRelease, {
    registry: rollbackRegistry,
    controlGeneration: 2,
    transitionType: 'rollback',
    rollbackFromDatasetVersion: badRelease.current.dataset_version,
  })
  const mock = createWxMock(safeRelease)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })

  const result = await runtime.refresh({ force: true })
  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().datasetVersion, safeRelease.current.dataset_version)
  assert.equal(runtimeState(mock).control.generation, 2)
  assert.equal(runtimeState(mock).control.revokedDatasetEntries[0].replacement_dataset_version, safeRelease.current.dataset_version)
})

test('a fresh rollback retries after its bundled fallback is revoked and the target is repaired', async () => {
  const badRelease = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()))
  const safeRelease = makeRelease()
  const badRegistry = appendRollbackRevocations(badRelease.revocationArtifact.registry, {
    failedRelease: badRelease,
    targetRelease: safeRelease,
    revokedAt: '2026-07-20T00:15:00.000Z',
    reason: 'post-publish full guard rejected the candidate package',
  })
  const rollbackRegistry = appendFailedDatasetRevocation(badRegistry, {
    datasetVersion: bundled.datasetVersion,
    revokedAt: '2026-07-20T00:16:00.000Z',
    replacementDatasetVersion: safeRelease.current.dataset_version,
    reason: 'bundled package is also unsafe for fallback',
  })
  attachControl(safeRelease, {
    registry: rollbackRegistry,
    controlGeneration: 2,
    transitionType: 'rollback',
    rollbackFromDatasetVersion: badRelease.current.dataset_version,
  })
  const mock = createWxMock(safeRelease)
  mock.remote.set(safeRelease.current.manifest_file_id, `${safeRelease.manifestText} `)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })

  const failed = await runtime.refresh({ force: true })
  assert.equal(failed.reason, 'failed')
  assert.equal(runtime.getSource(), 'unavailable')
  assert.equal(runtimeState(mock).status, 'pending-rollback')
  assert.equal(runtimeState(mock).pendingRollback.fromDatasetVersion, badRelease.current.dataset_version)

  mock.remote.set(safeRelease.current.manifest_file_id, safeRelease.manifestText)
  const recovered = await runtime.refresh({ force: true })
  assert.equal(recovered.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().datasetVersion, safeRelease.current.dataset_version)
})

test('a failed rollback target immediately stops the revoked cache and cannot revive it after restart', async () => {
  const badRelease = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()))
  const mock = createWxMock(badRelease)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  await runtime.refresh({ force: true })

  const safeRelease = makeRelease()
  const rollbackRegistry = appendRollbackRevocations(badRelease.revocationArtifact.registry, {
    failedRelease: badRelease,
    targetRelease: safeRelease,
    revokedAt: '2026-07-20T00:15:00.000Z',
    reason: 'post-publish full guard rejected the candidate package',
  })
  attachControl(safeRelease, {
    registry: rollbackRegistry,
    controlGeneration: 2,
    transitionType: 'rollback',
    rollbackFromDatasetVersion: badRelease.current.dataset_version,
  })
  for (const [fileId, text] of cloudFiles(safeRelease)) mock.remote.set(fileId, text)
  mock.remote.set(safeRelease.current.manifest_file_id, `${safeRelease.manifestText} `)
  mock.setCurrent(safeRelease.current)

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtimeState(mock).status, 'pending-rollback')
  assert.equal(runtimeState(mock).active, null)
  assert.deepEqual(runtimeState(mock).control.revokedDatasetVersions, [badRelease.current.dataset_version])

  const restored = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal(restored.getSource(), 'bundled')
  assert.notEqual(restored.getSnapshot().datasetVersion, badRelease.current.dataset_version)
})

test('a revoked remote cache cannot revive when pending rollback state persistence fails', async () => {
  const badRelease = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()))
  const initial = createWxMock(badRelease)
  const initialRuntime = createDataRuntime({ wxApi: initial.wxApi, bundled })
  await initialRuntime.refresh({ force: true })

  const safeRelease = makeRelease()
  const rollbackRegistry = appendRollbackRevocations(badRelease.revocationArtifact.registry, {
    failedRelease: badRelease,
    targetRelease: safeRelease,
    revokedAt: '2026-07-20T00:15:00.000Z',
    reason: 'post-publish full guard rejected the candidate package',
  })
  attachControl(safeRelease, {
    registry: rollbackRegistry,
    controlGeneration: 2,
    transitionType: 'rollback',
    rollbackFromDatasetVersion: badRelease.current.dataset_version,
  })
  for (const [fileId, text] of cloudFiles(safeRelease)) initial.remote.set(fileId, text)

  const failing = createWxMock(safeRelease, {
    files: initial.files,
    storage: initial.storage,
    remote: initial.remote,
    failStorage: (key, value) => key === STATE_KEY && value.status === 'pending-rollback',
  })
  const failingRuntime = createDataRuntime({ wxApi: failing.wxApi, bundled })
  assert.equal(failingRuntime.getSnapshot().datasetVersion, badRelease.current.dataset_version)

  const result = await failingRuntime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.equal(failingRuntime.getSource(), 'bundled')
  assert.equal(runtimeState(failing).active.datasetVersion, badRelease.current.dataset_version)
  assert.equal(failing.files.has(`/user/housing-data/${badRelease.current.dataset_version}/manifest.json`), false)

  const recovered = createWxMock(safeRelease, { files: failing.files, storage: failing.storage, remote: failing.remote })
  const restored = createDataRuntime({ wxApi: recovered.wxApi, bundled })
  assert.equal(restored.getSource(), 'bundled')
  assert.notEqual(restored.getSnapshot().datasetVersion, badRelease.current.dataset_version)
  assert.equal((await restored.refresh({ force: true })).updated, true)
  assert.equal(restored.getSnapshot().datasetVersion, safeRelease.current.dataset_version)
})

test('a malformed or unreadable tombstone cannot remove revocations from the main state', async (t) => {
  const correction = correctionRelease()
  const original = createWxMock(correction)
  const originalRuntime = createCorrectionRuntime(correction, original)
  assert.equal((await originalRuntime.refresh({ force: true })).updated, true)
  assert.deepEqual(runtimeState(original).control.revokedSourceDatasetVersions, [correction.correctionBundled.sourceDatasetVersion])

  const cases = [
    ['missing revocation', (storage) => {
      const tombstone = structuredClone(storage.get(CONTROL_TOMBSTONE_KEY))
      tombstone.control.revokedSourceDatasetVersions = []
      tombstone.control.revokedSourceDatasetEntries = []
      storage.set(CONTROL_TOMBSTONE_KEY, tombstone)
      return {}
    }],
    ['rewritten entry', (storage) => {
      const tombstone = structuredClone(storage.get(CONTROL_TOMBSTONE_KEY))
      tombstone.control.revokedSourceDatasetEntries[0].reason = 'rewritten local tombstone entry'
      storage.set(CONTROL_TOMBSTONE_KEY, tombstone)
      return {}
    }],
    ['read failure', () => ({ failGetStorage: (key) => key === CONTROL_TOMBSTONE_KEY })],
  ]
  for (const [label, mutate] of cases) {
    await t.test(label, () => {
      const storage = new Map([...original.storage].map(([key, value]) => [key, structuredClone(value)]))
      const options = mutate(storage)
      const mock = createWxMock(correction, {
        files: original.files,
        storage,
        remote: original.remote,
        ...options,
      })
      const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
      assert.equal(runtime.getSource(), 'unavailable')
      assert.equal(runtime.getSnapshot().dataStatus, 'unavailable')
      assert.deepEqual(storage.get(STATE_KEY).control.revokedSourceDatasetVersions, [correction.correctionBundled.sourceDatasetVersion])
    })
  }

  await t.test('corrupt tombstone without a main state', () => {
    const storage = new Map([...original.storage].map(([key, value]) => [key, structuredClone(value)]))
    storage.delete(STATE_KEY)
    const tombstone = structuredClone(storage.get(CONTROL_TOMBSTONE_KEY))
    tombstone.control.revokedSourceDatasetVersions = []
    tombstone.control.revokedSourceDatasetEntries = []
    storage.set(CONTROL_TOMBSTONE_KEY, tombstone)
    const mock = createWxMock(correction, { files: original.files, storage, remote: original.remote })
    const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled: correction.correctionBundled })
    assert.equal(runtime.getSource(), 'unavailable')
    assert.equal(runtime.getSnapshot().dataStatus, 'unavailable')
  })
})

test('a verified unrevoked fallback remains active while a rollback target is corrupt', async () => {
  const first = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()), { controlGeneration: 1 })
  const mock = createWxMock(first)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal((await runtime.refresh({ force: true })).updated, true)

  const second = attachControl(makeRelease(versionConfig.version, snapshotForMonth(addMonths(bundled.datasetAsOf, 2), '222222222222')), {
    registry: first.revocationArtifact.registry,
    controlGeneration: 2,
  })
  for (const [fileId, text] of cloudFiles(second)) mock.remote.set(fileId, text)
  mock.setCurrent(second.current)
  assert.equal((await runtime.refresh({ force: true })).updated, true)
  assert.equal(runtimeState(mock).fallback.datasetVersion, first.current.dataset_version)

  const registry = appendRollbackRevocations(second.revocationArtifact.registry, {
    failedRelease: second,
    targetRelease: first,
    revokedAt: '2026-07-20T00:30:00.000Z',
    reason: 'latest package failed the post-publish guard',
  })
  const rollback = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()), {
    registry,
    controlGeneration: 3,
    transitionType: 'rollback',
    rollbackFromDatasetVersion: second.current.dataset_version,
  })
  for (const [fileId, text] of cloudFiles(rollback)) mock.remote.set(fileId, text)
  mock.remote.set(rollback.current.manifest_file_id, `${rollback.manifestText} `)
  mock.setCurrent(rollback.current)

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().datasetVersion, first.current.dataset_version)
  assert.equal(runtimeState(mock).status, 'pending-rollback')
  assert.equal(runtimeState(mock).fallback.datasetVersion, first.current.dataset_version)

  const restored = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal(restored.getSource(), 'remote')
  assert.equal(restored.getSnapshot().datasetVersion, first.current.dataset_version)
})

test('a newly revoked bundled source becomes unavailable immediately when its replacement is corrupt', async () => {
  const correctedRelease = correctionRelease()
  const mock = createWxMock(correctedRelease)
  mock.remote.set(correctedRelease.current.manifest_file_id, `${correctedRelease.manifestText} `)
  const runtime = createCorrectionRuntime(correctedRelease, mock)

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'unavailable')
  assert.equal(runtime.getSnapshot().dataStatus, 'unavailable')
  assert.equal(runtimeState(mock).status, 'pending-rollback')
  assert.deepEqual(runtimeState(mock).control.revokedSourceDatasetVersions, [correctedRelease.correctionBundled.sourceDatasetVersion])
})

test('an ordinary older pointer cannot masquerade as a rollback after verified control state exists', async () => {
  const badRelease = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()))
  const mock = createWxMock(badRelease)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  await runtime.refresh({ force: true })
  const safeRelease = makeRelease()
  for (const [fileId, text] of cloudFiles(safeRelease)) mock.remote.set(fileId, text)
  mock.setCurrent(safeRelease.current)

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.equal(runtime.getSnapshot().datasetVersion, badRelease.current.dataset_version)
  assert.equal(runtimeState(mock).active.datasetVersion, badRelease.current.dataset_version)
})

test('a controlled publish cannot use a revocation to disguise an unauthorized older target', async () => {
  const badRelease = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()))
  const mock = createWxMock(badRelease)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  await runtime.refresh({ force: true })

  const olderRelease = makeRelease()
  const registry = appendFailedDatasetRevocation(badRelease.revocationArtifact.registry, {
    datasetVersion: badRelease.current.dataset_version,
    revokedAt: '2026-07-20T00:15:00.000Z',
    replacementDatasetVersion: olderRelease.current.dataset_version,
    reason: 'active package is unsafe but no rollback transition was authorized',
  })
  attachControl(olderRelease, { registry, controlGeneration: 2, transitionType: 'publish' })
  for (const [fileId, text] of cloudFiles(olderRelease)) mock.remote.set(fileId, text)
  mock.setCurrent(olderRelease.current)

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.match(result.error.message, /without an authorized rollback/)
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtimeState(mock).status, 'pending-rollback')
  assert.equal(runtimeState(mock).active, null)
  assert.deepEqual(runtimeState(mock).control.revokedDatasetVersions, [badRelease.current.dataset_version])

  const restored = createDataRuntime({ wxApi: mock.wxApi, bundled })
  const retry = await restored.refresh({ force: true })
  assert.equal(retry.reason, 'failed')
  assert.match(retry.error.message, /without an authorized rollback/)
  assert.equal(restored.getSource(), 'bundled')
  assert.equal(runtimeState(mock).active, null)
})

test('a rollback cannot reuse a real revocation entry for a different older target', async () => {
  const badRelease = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()))
  const mock = createWxMock(badRelease)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  await runtime.refresh({ force: true })

  const olderRelease = makeRelease()
  const registry = appendRollbackRevocations(badRelease.revocationArtifact.registry, {
    failedRelease: badRelease,
    targetRelease: olderRelease,
    revokedAt: '2026-07-20T00:15:00.000Z',
    replacementDatasetVersion: '2026-05-aaaaaaaaaaaa',
    reason: 'the registered replacement is not the pointer target',
  })
  attachControl(olderRelease, {
    registry,
    controlGeneration: 2,
    transitionType: 'rollback',
    rollbackFromDatasetVersion: badRelease.current.dataset_version,
  })
  for (const [fileId, text] of cloudFiles(olderRelease)) mock.remote.set(fileId, text)
  mock.setCurrent(olderRelease.current)

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.match(result.error.message, /rollback target is not authorized/)
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtimeState(mock).active, null)
})

test('an exact controlled rollback can activate a target earlier than the bundled month', async () => {
  const badRelease = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()))
  const mock = createWxMock(badRelease)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal((await runtime.refresh({ force: true })).updated, true)

  const safeRelease = makeRelease(versionConfig.version, snapshotForMonth(addMonths(bundled.datasetAsOf, -1), '555555555555'))
  const registry = appendRollbackRevocations(badRelease.revocationArtifact.registry, {
    failedRelease: badRelease,
    targetRelease: safeRelease,
    revokedAt: '2026-07-20T00:15:00.000Z',
    reason: 'the only audited safe package predates the bundled month',
  })
  attachControl(safeRelease, {
    registry,
    controlGeneration: 2,
    transitionType: 'rollback',
    rollbackFromDatasetVersion: badRelease.current.dataset_version,
  })
  for (const [fileId, text] of cloudFiles(safeRelease)) mock.remote.set(fileId, text)
  mock.setCurrent(safeRelease.current)

  const result = await runtime.refresh({ force: true })
  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().datasetAsOf, addMonths(bundled.datasetAsOf, -1))
  assert.equal(runtimeState(mock).active.datasetVersion, safeRelease.current.dataset_version)
  assert.equal(createDataRuntime({ wxApi: mock.wxApi, bundled }).getSnapshot().datasetAsOf, addMonths(bundled.datasetAsOf, -1))
})

test('a fresh strict validation receipt authorizes new data after the static control window expires', async () => {
  const now = Date.parse('2026-07-20T12:00:00.000Z')
  const release = attachControl(makeRelease(), {
    controlGeneratedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
    controlValidUntil: new Date(now - 60 * 60 * 1000).toISOString(),
  })
  const mock = createWxMock(release, { receiptNow: now })
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => now })

  const result = await runtime.refresh({ force: true })
  assert.equal(result.updated, true)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().datasetVersion, release.current.dataset_version)
  assert.equal(mock.stats.downloads, 3)
  assert.equal(runtimeState(mock).control.generation, 1)
})

test('a validation receipt dated beyond the allowed clock skew cannot authorize remote data', async () => {
  const now = Date.parse('2026-07-20T12:00:00.000Z')
  const release = attachControl(makeRelease(), controlWindow(now))
  const mock = createWxMock(release, { receiptNow: now + 60_001 })
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => now })

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.match(result.error.message, /timestamp is too far in the future/)
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtimeState(mock).active, null)
})

test('an expired previously verified control keeps its unrevoked cached snapshot after refresh failure', async () => {
  const now = Date.parse('2026-07-20T12:00:00.000Z')
  const release = attachControl(makeRelease(), controlWindow(now))
  const mock = createWxMock(release, { receiptNow: now })
  const online = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => now })
  assert.equal((await online.refresh({ force: true })).updated, true)

  const expiredAt = now + 25 * 60 * 60 * 1000
  const offline = createWxMock(release, {
    files: mock.files,
    storage: mock.storage,
    remote: mock.remote,
    functionError: new Error('offline'),
  })
  const restored = createDataRuntime({ wxApi: offline.wxApi, bundled, now: () => expiredAt })
  assert.equal(restored.getSource(), 'remote')
  assert.equal(restored.getSnapshot().datasetVersion, release.current.dataset_version)

  const result = await restored.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.equal(restored.getSource(), 'remote')
  assert.equal(restored.getSnapshot().datasetVersion, release.current.dataset_version)
})

test('a known bundled revocation remains unavailable while offline even after control expiry', async () => {
  const now = Date.parse('2026-07-20T12:00:00.000Z')
  const correctedRelease = correctionRelease()
  attachControl(correctedRelease, {
    registry: correctedRelease.revocationArtifact.registry,
    transitionType: 'historical_correction',
    supersededDatasetVersion: correctedRelease.correctionBundled.datasetVersion,
    supersededSourceDatasetVersion: correctedRelease.correctionBundled.sourceDatasetVersion,
    ...controlWindow(now),
  })
  const mock = createWxMock(correctedRelease, { receiptNow: now })
  mock.remote.set(correctedRelease.current.manifest_file_id, `${correctedRelease.manifestText} `)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled: correctedRelease.correctionBundled, now: () => now })
  assert.equal((await runtime.refresh({ force: true })).reason, 'failed')
  assert.equal(runtime.getSource(), 'unavailable')

  const expiredAt = now + 25 * 60 * 60 * 1000
  const offline = createWxMock(correctedRelease, {
    files: mock.files,
    storage: mock.storage,
    remote: mock.remote,
    functionError: new Error('offline'),
  })
  const restored = createDataRuntime({ wxApi: offline.wxApi, bundled: correctedRelease.correctionBundled, now: () => expiredAt })
  assert.equal(restored.getSource(), 'unavailable')
  assert.equal((await restored.refresh({ force: true })).reason, 'failed')
  assert.equal(restored.getSource(), 'unavailable')
})

test('post-rename readback corruption removes the candidate before activation', async () => {
  const release = makeRelease()
  const mock = createWxMock(release, {
    afterRename({ newPath, files }) {
      const path = `${newPath}/bootstrap.json`
      files.set(path, Buffer.concat([files.get(path), Buffer.from(' ')]))
    },
  })
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.match(result.error.message, /bootstrap size mismatch|bootstrap hash mismatch/)
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtimeState(mock).active, null)
  assert.equal(mock.directories.has(`/user/housing-data/${release.current.dataset_version}`), false)
})

test('storage failure before active-state commit removes the renamed candidate', async () => {
  const release = makeRelease()
  const mock = createWxMock(release, {
    failStorage: (key, value) => key === STATE_KEY && Boolean(value.active),
  })
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtimeState(mock).active, null)
  assert.equal(mock.directories.has(`/user/housing-data/${release.current.dataset_version}`), false)
})

test('restart cleanup removes temporary and unreferenced version directories', () => {
  const release = makeRelease()
  const orphan = '2025-01-aaaaaaaaaaaa'
  const temporary = '.tmp-2025-02-bbbbbbbbbbbb'
  const directories = new Set([
    '/user',
    '/user/housing-data',
    `/user/housing-data/${orphan}`,
    `/user/housing-data/${temporary}`,
  ])
  const files = new Map([
    [`/user/housing-data/${orphan}/manifest.json`, Buffer.from('{}')],
    [`/user/housing-data/${temporary}/bootstrap.json`, Buffer.from('{}')],
  ])
  const mock = createWxMock(release, { directories, files })

  createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal(mock.directories.has(`/user/housing-data/${orphan}`), false)
  assert.equal(mock.directories.has(`/user/housing-data/${temporary}`), false)
  assert.equal([...mock.files.keys()].some((path) => path.startsWith('/user/housing-data/')), false)
})

test('three successful releases retain only the active package and one verified fallback', async () => {
  const first = attachControl(makeRelease(versionConfig.version, snapshotForMonth(addMonths(bundled.datasetAsOf, 1), '111111111111')), { controlGeneration: 1 })
  const mock = createWxMock(first)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal((await runtime.refresh({ force: true })).updated, true)

  const second = attachControl(makeRelease(versionConfig.version, snapshotForMonth(addMonths(bundled.datasetAsOf, 2), '222222222222')), {
    registry: first.revocationArtifact.registry,
    controlGeneration: 2,
  })
  for (const [fileId, text] of cloudFiles(second)) mock.remote.set(fileId, text)
  mock.setCurrent(second.current)
  assert.equal((await runtime.refresh({ force: true })).updated, true)

  const third = attachControl(makeRelease(versionConfig.version, snapshotForMonth(addMonths(bundled.datasetAsOf, 3), '333333333333')), {
    registry: first.revocationArtifact.registry,
    controlGeneration: 3,
  })
  for (const [fileId, text] of cloudFiles(third)) mock.remote.set(fileId, text)
  mock.setCurrent(third.current)
  assert.equal((await runtime.refresh({ force: true })).updated, true)

  const state = runtimeState(mock)
  assert.equal(state.active.datasetVersion, third.current.dataset_version)
  assert.equal(state.fallback.datasetVersion, second.current.dataset_version)
  assert.deepEqual(state.cacheDirectories, [third.current.dataset_version, second.current.dataset_version].sort())
  assert.equal(mock.directories.has(`/user/housing-data/${first.current.dataset_version}`), false)
  assert.equal(mock.directories.has(`/user/housing-data/${second.current.dataset_version}`), true)
  assert.equal(mock.directories.has(`/user/housing-data/${third.current.dataset_version}`), true)
})

test('exact city, value, latest-series, and breadth validation all fail closed', async (t) => {
  const mutations = [
    ['city set', (release) => { release.bootstrap.cityIds[0] = 'not-a-70-city-id' }],
    ['city metadata', (release) => { release.bootstrap.cityMap.beijing.search = '' }],
    ['non-finite value representation', (release) => { release.bootstrap.series.beijing.n_a[0] = 'NaN' }],
    ['latest series', (release) => { release.bootstrap.latestSeries.beijing.n_a[0] += 0.1 }],
    ['breadth series', (release) => { release.bootstrap.breadthSeries.n_a_mom[0] += 1 }],
    ['official URL', (release) => { release.bootstrap.latestOfficialUrl = 'https://example.com/not-official' }],
  ]
  for (const [label, mutate] of mutations) {
    await t.test(label, async () => {
      const release = makeRelease()
      mutate(release)
      rebuildBootstrapArtifacts(release)
      const mock = createWxMock(release)
      const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
      const result = await runtime.refresh({ force: true })
      assert.equal(result.reason, 'failed')
      assert.equal(runtime.getSource(), 'bundled')
      assert.equal(runtimeState(mock).active, null)
    })
  }
})

test('control checks are independent from the next monthly data check', async () => {
  const now = Date.parse('2026-07-20T00:00:00.000Z')
  const release = attachControl(makeRelease(), controlWindow(now))
  const mock = createWxMock(release, { receiptNow: now })
  const first = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => now })
  await first.refresh({ force: true })
  const state = runtimeState(mock)
  state.schedule.dataNextCheckAt = now + 20 * 24 * 60 * 60 * 1000
  state.schedule.controlNextCheckAt = now - 1
  mock.storage.set(STATE_KEY, state)
  mock.stats.functionCalls = 0

  const restored = createDataRuntime({ wxApi: mock.wxApi, bundled, now: () => now })
  const result = await restored.refresh()
  assert.equal(result.reason, 'current')
  assert.equal(mock.stats.functionCalls, 1)
})

test('the same revocation generation cannot change content under a newer control generation', async () => {
  const release = attachControl(makeRelease())
  const mock = createWxMock(release)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  await runtime.refresh({ force: true })

  const changedRegistry = createRevocationRegistry({
    generatedAt: '2026-07-20T00:30:00.000Z',
    revokedDatasetVersions: [{
      dataset_version: '2025-01-aaaaaaaaaaaa',
      revoked_at: '2026-07-20T00:30:00.000Z',
      revision_id: null,
      replacement_dataset_version: release.current.dataset_version,
      reason: 'unrelated failed package',
    }],
  })
  const changed = attachControl(makeRelease(), { registry: changedRegistry, controlGeneration: 2 })
  for (const [fileId, text] of cloudFiles(changed)) mock.remote.set(fileId, text)
  mock.setCurrent(changed.current)

  const result = await runtime.refresh({ force: true })
  assert.equal(result.reason, 'failed')
  assert.match(result.error.message, /revocations changed without increasing their generation/)
  assert.equal(runtime.getSnapshot().datasetVersion, release.current.dataset_version)
})

test('a higher registry generation cannot rewrite any persisted revocation entry identity', async (t) => {
  const mutations = [
    ['replacement', (entry) => { entry.replacement_dataset_version = '2025-02-bbbbbbbbbbbb' }],
    ['reason', (entry) => { entry.reason = 'rewritten revocation reason' }],
    ['revision', (entry) => { entry.revision_id = 'revision-2025-01-rewritten-entry' }],
  ]
  for (const [label, mutate] of mutations) {
    await t.test(label, async () => {
      const initialRelease = makeRelease()
      const initialRegistry = createRevocationRegistry({
        generatedAt: '2026-07-20T00:00:00.000Z',
        revokedDatasetVersions: [{
          dataset_version: '2025-01-aaaaaaaaaaaa',
          revoked_at: '2026-07-20T00:00:00.000Z',
          revision_id: null,
          replacement_dataset_version: initialRelease.current.dataset_version,
          reason: 'original immutable revocation reason',
        }],
      })
      attachControl(initialRelease, { registry: initialRegistry })
      const mock = createWxMock(initialRelease)
      const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
      assert.equal((await runtime.refresh({ force: true })).updated, true)
      assert.equal(runtimeState(mock).control.revokedDatasetEntries[0].reason, 'original immutable revocation reason')

      const rewrittenRegistry = structuredClone(initialRegistry)
      rewrittenRegistry.generation = 2
      rewrittenRegistry.generated_at = '2026-07-20T00:30:00.000Z'
      mutate(rewrittenRegistry.revoked_dataset_versions[0])
      const rewrittenRelease = attachControl(makeRelease(), { registry: rewrittenRegistry, controlGeneration: 2 })
      for (const [fileId, text] of cloudFiles(rewrittenRelease)) mock.remote.set(fileId, text)
      mock.setCurrent(rewrittenRelease.current)

      const result = await runtime.refresh({ force: true })
      assert.equal(result.reason, 'failed')
      assert.match(result.error.message, /rewrote a dataset revocation entry/)
      assert.equal(runtimeState(mock).control.registryGeneration, 1)
      assert.equal(runtimeState(mock).control.revokedDatasetEntries[0].reason, 'original immutable revocation reason')
    })
  }
})

test('clearing remote pointers removes active and fallback caches and stays bundled after restart', async () => {
  const first = attachControl(makeRelease(versionConfig.version, nextMonthSnapshot()), { controlGeneration: 1 })
  const mock = createWxMock(first)
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal((await runtime.refresh({ force: true })).updated, true)
  const second = attachControl(makeRelease(versionConfig.version, snapshotForMonth(addMonths(bundled.datasetAsOf, 2), '222222222222')), {
    registry: first.revocationArtifact.registry,
    controlGeneration: 2,
  })
  for (const [fileId, text] of cloudFiles(second)) mock.remote.set(fileId, text)
  mock.setCurrent(second.current)
  assert.equal((await runtime.refresh({ force: true })).updated, true)
  assert.ok(runtimeState(mock).fallback)

  assert.equal(runtime.clearRemoteCachePointer(), true)

  assert.equal(runtime.getSource(), 'bundled')
  assert.equal(runtime.getSnapshot(), bundled)
  assert.equal(runtimeState(mock).active, null)
  assert.equal(runtimeState(mock).fallback, null)
  assert.equal([...mock.files.keys()].some((path) => path.startsWith('/user/housing-data/')), false)

  const restored = createDataRuntime({ wxApi: mock.wxApi, bundled })
  assert.equal(restored.getSource(), 'bundled')
  assert.equal(restored.getSnapshot(), bundled)
})

test('a failed remote pointer clear reports failure and keeps the active cache', async () => {
  const release = makeRelease()
  const initial = createWxMock(release)
  const initialRuntime = createDataRuntime({ wxApi: initial.wxApi, bundled })
  assert.equal((await initialRuntime.refresh({ force: true })).updated, true)
  const failing = createWxMock(release, {
    files: initial.files,
    storage: initial.storage,
    remote: initial.remote,
    failStorage: (key) => key === STATE_KEY,
  })
  const runtime = createDataRuntime({ wxApi: failing.wxApi, bundled })
  const activeVersion = runtime.getSnapshot().datasetVersion

  assert.equal(runtime.clearRemoteCachePointer(), false)
  assert.equal(runtime.getSource(), 'remote')
  assert.equal(runtime.getSnapshot().datasetVersion, activeVersion)
  assert.equal(runtimeState(failing).active.datasetVersion, activeVersion)
})

test('remote pointer clear reports cache-directory deletion failures', async (t) => {
  const cases = [
    ['directory removal denied', (mock, activeVersion) => {
      mock.failRmdirPath = `/user/housing-data/${activeVersion}`
    }],
    ['synchronous directory remover unavailable', (mock) => {
      delete mock.wxApi.getFileSystemManager().rmdirSync
    }],
  ]
  for (const [label, prepare] of cases) {
    await t.test(label, async () => {
      const release = makeRelease()
      let deniedPath = ''
      const initial = createWxMock(release)
      const initialRuntime = createDataRuntime({ wxApi: initial.wxApi, bundled })
      assert.equal((await initialRuntime.refresh({ force: true })).updated, true)
      const activeVersion = initialRuntime.getSnapshot().datasetVersion
      const failing = createWxMock(release, {
        files: initial.files,
        directories: initial.directories,
        storage: initial.storage,
        remote: initial.remote,
        failRmdir: (path) => path === deniedPath,
      })
      prepare(failing, activeVersion)
      deniedPath = failing.failRmdirPath || ''
      const runtime = createDataRuntime({ wxApi: failing.wxApi, bundled })

      assert.equal(runtime.clearRemoteCachePointer(), false)
      assert.equal(runtime.getSource(), 'bundled')
      assert.equal(runtimeState(failing).active, null)
      assert.equal(runtimeState(failing).fallback, null)
      assert.equal(failing.directories.has(`/user/housing-data/${activeVersion}`), true)
    })
  }
})

test('cloud manifest function rejects unsafe current pointers', () => {
  const release = makeLegacyRelease()
  assert.equal(validateCurrent(release.current), release.current)
  assert.equal(validateRuntimeCurrent(release.current, config), release.current)
  assert.throws(() => validateCurrent({ ...release.current, dataset_version: '../current' }), /dataset version/)
  assert.throws(() => validateCurrent({ ...release.current, manifest_file_id: `cloud://${config.cloudEnvId}/housing-data/releases/${release.current.dataset_version}/manifest.json` }), /file ID/)
  assert.throws(() => validateCurrent({ ...release.current, schema_version: '2.0.0' }), /schema/)
  assert.throws(() => validateCurrent({ ...release.current, manifest_sha256: 'bad' }), /hash/)

  const controlled = attachControl(makeRelease())
  assert.equal(validateCurrent(controlled.current), controlled.current)
  assert.equal(validateRuntimeCurrent(controlled.current, config), controlled.current)
  assert.throws(() => validateCurrent({ ...controlled.current, control_generation: 0 }), /control generation/)
  assert.throws(() => validateCurrent({ ...controlled.current, revocations_file_id: 'cloud://wrong/revocations.json' }), /revocations file ID/)
  for (const partialField of ['transition_type', 'data_status', 'status_reason', 'control_generated_at', 'control_valid_until', 'rollback_from_dataset_version']) {
    const partial = { ...release.current, [partialField]: controlled.current[partialField] || '2026-07-aaaaaaaaaaaa' }
    assert.throws(() => validateCurrent(partial), /control fields are incomplete/)
    assert.throws(() => validateRuntimeCurrent(partial, config), /control fields are incomplete/)
  }
  for (const requiredField of ['source_dataset_version', 'status_reason', 'control_generated_at']) {
    const partial = { ...controlled.current }
    delete partial[requiredField]
    const expected = requiredField === 'source_dataset_version' ? /source dataset version/ : /control fields are incomplete/
    assert.throws(() => validateCurrent(partial), expected)
    assert.throws(() => validateRuntimeCurrent(partial, config), expected)
  }
  const rollback = { ...controlled.current, transition_type: 'rollback', rollback_from_dataset_version: '2026-07-aaaaaaaaaaaa', previous_dataset_version: '2026-07-aaaaaaaaaaaa' }
  assert.throws(() => validateCurrent(rollback), /unsafe previous/)

  const correction = correctionRelease()
  const correctionOptions = {
    allowLegacy: false,
    requireContext: true,
    manifest: correction.manifest,
    revisionManifest: correction.revisionManifest,
    registry: correction.revocationArtifact.registry,
  }
  assert.equal(validateCurrent(correction.current, correctionOptions), correction.current)
  const mismatchedRevisionSources = structuredClone(correction.revisionManifest)
  mismatchedRevisionSources.revision_source_batch_ids = ['official-html-2026-06-cccccccccccc']
  assert.throws(() => validateCurrent(correction.current, {
    ...correctionOptions,
    revisionManifest: mismatchedRevisionSources,
  }), /revision source batch IDs differ/)
  const missingAuditCode = structuredClone(correction.manifest)
  delete missingAuditCode.audit_code_sha256
  assert.throws(() => validateCurrent(correction.current, {
    ...correctionOptions,
    manifest: missingAuditCode,
  }), /audit_code_sha256 is invalid/)
})

test('a rollback to a historical correction keeps its revision manifest mandatory', () => {
  const correction = correctionRelease()
  const failedDatasetVersion = '2026-07-444444444444'
  const failedSourceDatasetVersion = '2026-07-555555555555'
  const rollbackRevisionId = buildRollbackRevisionId(failedDatasetVersion)
  const registry = appendFailedReleaseRevocations(correction.revocationArtifact.registry, {
    datasetVersion: failedDatasetVersion,
    sourceDatasetVersion: failedSourceDatasetVersion,
    revokedAt: '2026-08-01T00:00:00.000Z',
    replacementDatasetVersion: correction.current.dataset_version,
    replacementSourceDatasetVersion: correction.current.source_dataset_version,
    revisionId: rollbackRevisionId,
    reason: 'test rollback to the audited historical correction',
  })
  const registryArtifact = buildRevocationRegistryArtifact(registry, {
    cloudEnvId: config.cloudEnvId,
    storageBucket: config.storageBucket,
  })
  const rollback = buildAutomaticRollbackPointer(correction.current, failedDatasetVersion, {
    rolledBackAt: '2026-08-01T00:00:00.000Z',
    controlGeneration: correction.current.control_generation + 1,
    registryArtifact,
    failedSourceDatasetVersion,
    rollbackRevisionId,
    targetSourceDatasetVersion: correction.current.source_dataset_version,
    targetManifest: correction.manifest,
    targetRevisionManifest: correction.revisionManifest,
  })
  const options = {
    allowLegacy: false,
    requireContext: true,
    manifest: correction.manifest,
    registry,
  }
  assert.equal(validateCurrent(rollback, { ...options, revisionManifest: correction.revisionManifest }), rollback)
  assert.throws(() => validateCurrent(rollback, options), /revision manifest context is required/)
})

test('status deployment preserves historical correction identity only with its verified revision manifest', () => {
  const correction = correctionRelease()
  const currentText = remoteStableJson(correction.current)
  const payload = {
    format: 'housing-data-discovery-observation-v1',
    observation_id: 'd'.repeat(64),
    slot_id: '2026-08-30T01:15:00.000Z',
    task: 'discovery',
    planned_at: '2026-08-30T01:15:00.000Z',
    actual_started_at: '2026-08-30T01:15:04.000Z',
    completed_at: '2026-08-30T01:15:10.000Z',
    timing_status: 'on_time',
    status: 'current',
    result: {
      status: 'current',
      dataset_as_of: correction.current.dataset_as_of,
      expected_stat_month: '2026-07',
      latest_official_month: correction.current.dataset_as_of,
      latest_official_url: 'https://www.stats.gov.cn/sj/zxfb/202607/t20260720_1.html',
    },
    pointer: {
      dataset_as_of: correction.current.dataset_as_of,
      dataset_version: correction.current.dataset_version,
      pointer_sha256: remoteSha256(currentText),
    },
    calendar: { calendar_sha256: 'e'.repeat(64) },
    discovery_responses: [],
    idempotency_key: null,
    handoff_identity: null,
  }
  const observation = { ...payload, payload_sha256: remoteSha256(JSON.stringify(payload)) }
  const options = {
    currentText,
    manifestText: correction.manifestText,
    registryText: correction.revocationArtifact.text,
    observation,
    cloudEnvId: config.cloudEnvId,
    storageBucket: config.storageBucket,
    generatedAt: '2026-08-30T02:00:00.000Z',
  }
  assert.throws(() => buildDataStatusDeployment(options), /active revision manifest is unavailable/)
  const result = buildDataStatusDeployment({ ...options, revisionManifestText: correction.revisionManifestText })
  assert.equal(result.state, 'ready')
  assert.equal(result.candidate.dataset_version, correction.current.dataset_version)
  assert.equal(result.candidate.source_dataset_version, correction.current.source_dataset_version)
  assert.equal(result.candidate.control_generation, correction.current.control_generation + 1)
})
