import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createTencentCloudClient, DEFAULT_CLOUD_ENV_ID, STORAGE_BUCKET_ID } from './tencent-cloud-sdk.mjs'
import { validateObservationPayload } from './cloud-observation-gate.mjs'
import { isOfficialReleaseUrl } from './official-source-url.mjs'
import {
  buildControlValidUntil,
  classifyControlPointer,
  sha256,
  stableJson,
  validateControlPointer,
  validateRevocationRegistry,
} from './control-plane.mjs'
import { parseHistoricalRevisionManifest } from './revision-manifest-context.mjs'

const CURRENT_KEY = 'housing-data/current.json'
const PRODUCTION_ENVIRONMENT = 'housing-data-production'
const STATUS_DEPLOYMENT_WORKFLOW = 'monthly-data-status-deploy'
const STATUS_DEPLOYMENT_WORKFLOW_FILE = 'monthly-data-status-deploy.yml'
const STATUS_DEPLOYMENT_REHEARSAL_CONFIRMATION = 'status-deployment-rehearsal'
const STATUS_MUTABLE_FIELDS = new Set([
  'control_generation',
  'control_generated_at',
  'control_valid_until',
  'data_status',
  'status_reason',
])

function assert(condition, message) {
  if (!condition) throw new Error(`Data status deployment rejected: ${message}`)
}

function canonicalIso(value, label) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${label} is invalid`)
  assert(new Date(value).toISOString() === value, `${label} is not canonical ISO 8601`)
  return value
}

function parseJson(text, label) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Data status deployment rejected: ${label} is not valid JSON`)
  }
}

function nextMonth(value) {
  assert(/^20\d{2}-(0[1-9]|1[0-2])$/.test(value || ''), 'current dataset month is invalid')
  const date = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function targetStatus(observation, current) {
  const { status, result, timing_status: timingStatus } = observation
  if (status === 'update_available') {
    assert(timingStatus === 'on_time', 'a late discovery cannot deploy updating status')
    assert(result.expected_stat_month === nextMonth(current.dataset_as_of), 'available update is not the strict next month')
    assert(result.expected_stat_month === result.latest_official_month, 'available update month identity is invalid')
    assert(isOfficialReleaseUrl(result.latest_official_url), 'available update source URL is invalid')
    return { dataStatus: 'updating', reason: `official_update_available:${result.expected_stat_month}` }
  }
  if (status === 'anomaly') return { dataStatus: 'stale', reason: 'official_discovery_anomaly' }
  if (status === 'current' || status === 'waiting') return { dataStatus: 'current', reason: 'official_discovery_healthy' }
  throw new Error('Data status deployment rejected: observation status is unsupported')
}

function assertOnlyStatusFieldsChanged(before, after) {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const field of fields) {
    if (STATUS_MUTABLE_FIELDS.has(field)) continue
    assert(stableJson(before[field]) === stableJson(after[field]), `status deployment changed immutable field ${field}`)
  }
}

export function buildDataStatusDeployment({
  currentText,
  manifestText,
  revisionManifestText,
  registryText,
  observation,
  cloudEnvId = DEFAULT_CLOUD_ENV_ID,
  storageBucket = STORAGE_BUCKET_ID,
  generatedAt = new Date().toISOString(),
} = {}) {
  assert(typeof currentText === 'string' && currentText.length > 0, 'current pointer is empty')
  assert(typeof manifestText === 'string' && manifestText.length > 0, 'active manifest is empty')
  assert(typeof registryText === 'string' && registryText.length > 0, 'active revocations registry is empty')
  canonicalIso(generatedAt, 'control generation time')
  validateObservationPayload(observation)
  assert(observation.pointer.pointer_sha256 === sha256(currentText), 'discovery observation baseline does not match current.json')

  const current = parseJson(currentText, 'current pointer')
  const manifest = parseJson(manifestText, 'active manifest')
  const revisionManifest = parseHistoricalRevisionManifest(manifest, revisionManifestText, 'active revision manifest')
  const registry = validateRevocationRegistry(parseJson(registryText, 'active revocations registry'))
  assert(classifyControlPointer(current) === 'controlled', 'current pointer is not controlled')
  assert(observation.pointer.dataset_as_of === current.dataset_as_of, 'discovery observation month differs from current pointer')
  assert(observation.pointer.dataset_version === current.dataset_version, 'discovery observation dataset differs from current pointer')
  validateControlPointer(current, {
    allowLegacy: false,
    requireContext: true,
    manifest,
    revisionManifest,
    registry,
    cloudEnvId,
    storageBucket,
  })

  const target = targetStatus(observation, current)
  if (current.data_status === target.dataStatus && current.status_reason === target.reason) {
    return {
      state: 'unchanged',
      observation_id: observation.observation_id,
      current,
      current_text: currentText,
      current_sha256: sha256(currentText),
      target,
    }
  }

  const candidate = {
    ...current,
    control_generation: current.control_generation + 1,
    data_status: target.dataStatus,
    status_reason: target.reason,
    control_generated_at: generatedAt,
    control_valid_until: buildControlValidUntil(generatedAt),
  }
  assertOnlyStatusFieldsChanged(current, candidate)
  validateControlPointer(candidate, {
    allowLegacy: false,
    requireContext: true,
    manifest,
    revisionManifest,
    registry,
    previousPointer: current,
    cloudEnvId,
    storageBucket,
  })
  const candidateText = stableJson(candidate)
  return {
    state: 'ready',
    observation_id: observation.observation_id,
    current,
    current_text: currentText,
    current_sha256: sha256(currentText),
    candidate,
    candidate_text: candidateText,
    candidate_sha256: sha256(candidateText),
    target,
  }
}

async function readObjectText(client, key) {
  const value = await client.getObject(key)
  return Buffer.isBuffer(value) ? value.toString('utf8') : Buffer.from(value).toString('utf8')
}

export async function deployDataStatus({
  client,
  observation,
  cloudEnvId = DEFAULT_CLOUD_ENV_ID,
  storageBucket = STORAGE_BUCKET_ID,
  generatedAt = new Date().toISOString(),
} = {}) {
  assert(client && typeof client.getObject === 'function' && typeof client.putObject === 'function', 'Tencent Cloud client is unavailable')
  const currentText = await readObjectText(client, CURRENT_KEY)
  const current = parseJson(currentText, 'current pointer')
  const [manifestText, registryText] = await Promise.all([
    readObjectText(client, `housing-data/releases/${current.dataset_version}/manifest.json`),
    readObjectText(client, `housing-data/control/revocations-${current.revocations_sha256}.json`),
  ])
  const manifest = parseJson(manifestText, 'active manifest')
  const revisionManifestText = manifest.release_type === 'historical_correction'
    ? await readObjectText(client, `housing-data/releases/${current.dataset_version}/revision-manifest.json`)
    : undefined
  const deployment = buildDataStatusDeployment({
    currentText,
    manifestText,
    revisionManifestText,
    registryText,
    observation,
    cloudEnvId,
    storageBucket,
    generatedAt,
  })
  if (deployment.state === 'unchanged') {
    return { ...deployment, wrote: false, round_trip_verified: true }
  }

  const preWriteText = await readObjectText(client, CURRENT_KEY)
  assert(preWriteText === currentText, 'current.json changed before status deployment')
  await client.putObject(CURRENT_KEY, Buffer.from(deployment.candidate_text, 'utf8'))
  const roundTripText = await readObjectText(client, CURRENT_KEY)
  assert(roundTripText === deployment.candidate_text, 'current.json round-trip differs after status deployment')
  return { ...deployment, wrote: true, round_trip_verified: true }
}

export function requireProtectedWorkflowEnvironment(env) {
  assert(env.GITHUB_ACTIONS === 'true', 'status deployment is allowed only in GitHub Actions')
  assert(env.CI_PRODUCTION_ENVIRONMENT === PRODUCTION_ENVIRONMENT, 'status deployment requires the protected production environment')
  assert(typeof env.CI_DEFAULT_BRANCH === 'string' && /^[A-Za-z0-9._/-]+$/.test(env.CI_DEFAULT_BRANCH), 'default branch is invalid')
  assert(env.GITHUB_REF === `refs/heads/${env.CI_DEFAULT_BRANCH}`, 'status deployment must run from the default branch')
  assert(/^[a-f0-9]{40}$/.test(env.CI_COMMIT_SHA || ''), 'status deployment commit SHA is invalid')
  assert(env.GITHUB_WORKFLOW === STATUS_DEPLOYMENT_WORKFLOW, 'status deployment workflow identity is invalid')
  assert(
    typeof env.GITHUB_WORKFLOW_REF === 'string'
      && env.GITHUB_WORKFLOW_REF.endsWith(`/.github/workflows/${STATUS_DEPLOYMENT_WORKFLOW_FILE}@refs/heads/${env.CI_DEFAULT_BRANCH}`),
    'status deployment workflow reference is invalid',
  )

  const mode = env.CI_STATUS_DEPLOYMENT_MODE
  if (mode === 'release') {
    assert(env.GITHUB_EVENT_NAME === 'workflow_run', 'normal status deployment must be triggered by a trusted workflow run')
    assert(env.AUTOMATIC_RELEASE_ENABLED === 'true', 'status deployment requires the repository automatic release authorization')
    assert(env.PRODUCTION_RELEASE_AUTHORIZED === 'true', 'status deployment requires the production environment authorization')
    return mode
  }

  assert(mode === 'rehearsal', 'status deployment mode is invalid')
  assert(env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'status deployment rehearsal must be manually dispatched')
  assert(env.CI_STATUS_DEPLOYMENT_REHEARSAL_CONFIRMATION === STATUS_DEPLOYMENT_REHEARSAL_CONFIRMATION, 'status deployment rehearsal confirmation is invalid')
  assert(env.AUTOMATIC_RELEASE_ENABLED === 'false', 'status deployment rehearsal requires the repository automatic release authorization to remain false')
  assert(env.PRODUCTION_RELEASE_AUTHORIZED === 'false', 'status deployment rehearsal requires the production environment authorization to remain false')
  return mode
}

async function main() {
  const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  const observationPath = argument('observation')
  const outputPath = argument('output') || 'work/data-status-deployment/receipt.json'
  const cloudEnvId = argument('env') || DEFAULT_CLOUD_ENV_ID
  assert(observationPath, 'an immutable discovery observation is required')
  assert(/^[A-Za-z0-9._/-]+$/.test(cloudEnvId), 'cloud environment ID is invalid')
  const deploymentMode = requireProtectedWorkflowEnvironment(process.env)
  const observation = parseJson(await readFile(resolve(observationPath), 'utf8'), 'discovery observation')
  const result = await deployDataStatus({
    client: createTencentCloudClient({ cloudEnvId }),
    observation,
    cloudEnvId,
    generatedAt: new Date().toISOString(),
  })
  const receipt = {
    format: 'housing-data-status-deployment-v1',
    status: result.state,
    wrote: result.wrote,
    round_trip_verified: result.round_trip_verified,
    observation_id: result.observation_id,
    before_current_sha256: result.current_sha256,
    after_current_sha256: result.candidate_sha256 || result.current_sha256,
    dataset_version: result.current.dataset_version,
    control_generation: result.candidate?.control_generation || result.current.control_generation,
    data_status: result.candidate?.data_status || result.current.data_status,
    status_reason: result.candidate?.status_reason || result.current.status_reason,
    deployment_mode: deploymentMode,
    rehearsal: deploymentMode === 'rehearsal',
    data_identity: {
      dataset_as_of: result.current.dataset_as_of,
      dataset_version: result.current.dataset_version,
      source_dataset_version: result.current.source_dataset_version,
      manifest_sha256: result.current.manifest_sha256,
      revocations_sha256: result.current.revocations_sha256,
      transition_type: result.current.transition_type,
    },
    repository_commit_sha: process.env.CI_COMMIT_SHA,
    generated_at: new Date().toISOString(),
  }
  await mkdir(resolve(outputPath, '..'), { recursive: true })
  await writeFile(resolve(outputPath), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(receipt))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
