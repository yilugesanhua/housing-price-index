import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDataStatusDeployment, deployDataStatus } from './deploy-data-status.mjs'
import { buildControlValidUntil, buildRevocationRegistryArtifact, createRevocationRegistry, sha256, stableJson } from './control-plane.mjs'

const cloudEnvId = 'cloud-test'
const storageBucket = 'bucket-test'
const datasetVersion = '2026-06-aaaaaaaaaaaa'
const sourceDatasetVersion = '2026-06-bbbbbbbbbbbb'
const generatedAt = '2026-08-30T01:00:00.000Z'

function makeCurrent(overrides = {}) {
  const registry = createRevocationRegistry({ generatedAt: '2026-08-20T00:00:00.000Z' })
  const artifact = buildRevocationRegistryArtifact(registry, { cloudEnvId, storageBucket })
  const current = {
    dataset_version: datasetVersion,
    source_dataset_version: sourceDatasetVersion,
    dataset_as_of: '2026-06',
    schema_version: '1.3.0',
    manifest_file_id: `cloud://${cloudEnvId}.${storageBucket}/housing-data/releases/${datasetVersion}/manifest.json`,
    manifest_sha256: 'a'.repeat(64),
    published_at: '2026-08-20T00:00:00.000Z',
    previous_dataset_version: null,
    next_check_at: '2026-09-15T01:00:00.000Z',
    control_schema_version: '1.0.0',
    control_generation: 3,
    ...artifact.currentFields,
    transition_type: 'publish',
    data_status: 'current',
    status_reason: 'monthly_publish',
    control_generated_at: '2026-08-20T00:00:00.000Z',
    control_valid_until: buildControlValidUntil('2026-08-20T00:00:00.000Z'),
    ...overrides,
  }
  return {
    current,
    currentText: stableJson(current),
    registry,
    registryText: stableJson(registry),
    manifestText: stableJson({
      dataset_version: datasetVersion,
      source_dataset_version: sourceDatasetVersion,
      dataset_as_of: '2026-06',
      release_type: 'monthly_update',
    }),
    artifact,
  }
}

function makeObservation(currentText, status = 'update_available', overrides = {}) {
  const result = status === 'update_available'
    ? {
        status,
        dataset_as_of: '2026-06',
        expected_stat_month: '2026-07',
        latest_official_month: '2026-07',
        latest_official_url: 'https://www.stats.gov.cn/sj/zxfb/202608/t20260820_1.html',
      }
    : {
        status,
        dataset_as_of: '2026-06',
        expected_stat_month: '2026-07',
        latest_official_month: '2026-06',
        latest_official_url: 'https://www.stats.gov.cn/sj/zxfb/202607/t20260720_1.html',
      }
  const payload = {
    format: 'housing-data-discovery-observation-v1',
    observation_id: 'b'.repeat(64),
    slot_id: '2026-08-30T01:15:00.000Z',
    task: 'discovery',
    planned_at: '2026-08-30T01:15:00.000Z',
    actual_started_at: '2026-08-30T01:15:04.000Z',
    completed_at: '2026-08-30T01:15:10.000Z',
    timing_status: 'on_time',
    status,
    result,
    pointer: {
      dataset_as_of: '2026-06',
      dataset_version: datasetVersion,
      pointer_sha256: sha256(currentText),
    },
    calendar: { calendar_sha256: 'c'.repeat(64) },
    discovery_responses: [],
    idempotency_key: status === 'update_available' ? 'd'.repeat(64) : null,
    handoff_identity: status === 'update_available' ? `housing-data-discovery-v1:${'d'.repeat(64)}` : null,
    ...overrides,
  }
  return { ...payload, payload_sha256: sha256(JSON.stringify(payload)) }
}

function fakeClient(files, options = {}) {
  const writes = []
  let currentReads = 0
  return {
    writes,
    async getObject(key) {
      if (key === 'housing-data/current.json') {
        currentReads += 1
        if (options.conflictOnSecondCurrentRead && currentReads === 2) {
          files.set(key, options.conflictOnSecondCurrentRead)
          return Buffer.from(options.conflictOnSecondCurrentRead)
        }
      }
      if (!files.has(key)) throw new Error(`missing object ${key}`)
      return Buffer.from(files.get(key))
    },
    async putObject(key, body) {
      writes.push(key)
      if (options.failWrite) throw new Error('simulated write failure')
      files.set(key, Buffer.from(body).toString('utf8'))
    },
  }
}

test('status deployment changes only status fields and preserves every data identity', () => {
  const release = makeCurrent()
  const observation = makeObservation(release.currentText)
  const result = buildDataStatusDeployment({
    currentText: release.currentText,
    manifestText: release.manifestText,
    registryText: release.registryText,
    observation,
    cloudEnvId,
    storageBucket,
    generatedAt,
  })
  assert.equal(result.state, 'ready')
  assert.equal(result.candidate.data_status, 'updating')
  assert.equal(result.candidate.status_reason, 'official_update_available:2026-07')
  assert.equal(result.candidate.control_generation, 4)
  assert.equal(result.candidate.dataset_version, release.current.dataset_version)
  assert.equal(result.candidate.source_dataset_version, release.current.source_dataset_version)
  assert.equal(result.candidate.manifest_sha256, release.current.manifest_sha256)
  assert.equal(result.candidate.revocations_sha256, release.current.revocations_sha256)
  assert.equal(result.candidate.transition_type, 'publish')
  assert.equal(result.candidate_text.endsWith('\n'), true)
})

test('status deployment rejects a stale observation baseline before generating a candidate', () => {
  const release = makeCurrent()
  const observation = makeObservation(release.currentText)
  observation.pointer.pointer_sha256 = 'e'.repeat(64)
  delete observation.payload_sha256
  observation.payload_sha256 = sha256(JSON.stringify(observation))
  assert.throws(() => buildDataStatusDeployment({
    currentText: release.currentText,
    manifestText: release.manifestText,
    registryText: release.registryText,
    observation,
    cloudEnvId,
    storageBucket,
    generatedAt,
  }), /baseline does not match/)
})

test('a healthy observation that matches the existing status performs no write', async () => {
  const release = makeCurrent({ status_reason: 'official_discovery_healthy' })
  const observation = makeObservation(release.currentText, 'current')
  const files = new Map([
    ['housing-data/current.json', release.currentText],
    [`housing-data/releases/${datasetVersion}/manifest.json`, release.manifestText],
    [`housing-data/control/revocations-${release.artifact.sha256}.json`, release.registryText],
  ])
  const client = fakeClient(files)
  const result = await deployDataStatus({ client, observation, cloudEnvId, storageBucket, generatedAt })
  assert.equal(result.state, 'unchanged')
  assert.equal(result.wrote, false)
  assert.deepEqual(client.writes, [])
  assert.equal(files.get('housing-data/current.json'), release.currentText)
})

test('a changed production pointer stops before the write', async () => {
  const release = makeCurrent()
  const observation = makeObservation(release.currentText)
  const conflicting = stableJson({ ...release.current, control_generation: 4 })
  const files = new Map([
    ['housing-data/current.json', release.currentText],
    [`housing-data/releases/${datasetVersion}/manifest.json`, release.manifestText],
    [`housing-data/control/revocations-${release.artifact.sha256}.json`, release.registryText],
  ])
  const client = fakeClient(files, { conflictOnSecondCurrentRead: conflicting })
  await assert.rejects(() => deployDataStatus({ client, observation, cloudEnvId, storageBucket, generatedAt }), /changed before status deployment/)
  assert.deepEqual(client.writes, [])
  assert.equal(files.get('housing-data/current.json'), conflicting)
})

test('a storage write failure leaves the original pointer untouched', async () => {
  const release = makeCurrent()
  const observation = makeObservation(release.currentText)
  const files = new Map([
    ['housing-data/current.json', release.currentText],
    [`housing-data/releases/${datasetVersion}/manifest.json`, release.manifestText],
    [`housing-data/control/revocations-${release.artifact.sha256}.json`, release.registryText],
  ])
  const client = fakeClient(files, { failWrite: true })
  await assert.rejects(() => deployDataStatus({ client, observation, cloudEnvId, storageBucket, generatedAt }), /simulated write failure/)
  assert.deepEqual(client.writes, ['housing-data/current.json'])
  assert.equal(files.get('housing-data/current.json'), release.currentText)
})
