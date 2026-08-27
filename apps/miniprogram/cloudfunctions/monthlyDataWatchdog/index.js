const https = require('node:https')
let cloud = null
try {
  cloud = require('wx-server-sdk')
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
} catch {
  cloud = null
}

const contract = require('./discovery-contract.js')
const { runReadOnlyDiscovery } = require('./cloud-discovery.js')
const {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_GRACE_MS,
  DEFAULT_LOOKBACK_MINUTES,
  DEFAULT_STALL_MS,
  decideWatchdog,
  findStalledRun,
  latestExpectedScheduleAt,
} = require('./decision.js')

const DEFAULT_REPOSITORY = 'yilugesanhua/housing-price-index'
const DEFAULT_WORKFLOW = 'monthly-data-check.yml'
const DEFAULT_PUBLISH_WORKFLOW = 'monthly-data-auto-publish.yml'
const DEFAULT_BRANCH = 'main'
const API_VERSION = '2022-11-28'
const DEFAULT_DISCOVERY_LEASE_MS = 5 * 60 * 1000
const DEFAULT_DISCOVERY_MAX_ATTEMPTS = 3
const STATUS_HISTORY_LIMIT = 32

function envBoolean(value) {
  return String(value || '').toLowerCase() === 'true'
}

function assertConfiguration(env) {
  if (!env.WATCHDOG_GITHUB_TOKEN) throw new Error('WATCHDOG_GITHUB_TOKEN is required')
  if (!/^[^/\s]+\/[^/\s]+$/.test(env.WATCHDOG_REPOSITORY || DEFAULT_REPOSITORY)) throw new Error('WATCHDOG_REPOSITORY is invalid')
  if (!/^[A-Za-z0-9._/-]+$/.test(env.WATCHDOG_WORKFLOW || DEFAULT_WORKFLOW)) throw new Error('WATCHDOG_WORKFLOW is invalid')
  if (!/^[A-Za-z0-9._/-]+$/.test(env.WATCHDOG_PUBLISH_WORKFLOW || DEFAULT_PUBLISH_WORKFLOW)) throw new Error('WATCHDOG_PUBLISH_WORKFLOW is invalid')
  if (!/^[A-Za-z0-9._/-]+$/.test(env.WATCHDOG_DEFAULT_BRANCH || DEFAULT_BRANCH)) throw new Error('WATCHDOG_DEFAULT_BRANCH is invalid')
}

function discoverySettings(env) {
  const leaseMs = Number(env.MONTHLY_DISCOVERY_LEASE_SECONDS || DEFAULT_DISCOVERY_LEASE_MS / 1000) * 1000
  const maxAttempts = Number(env.MONTHLY_DISCOVERY_MAX_ATTEMPTS || DEFAULT_DISCOVERY_MAX_ATTEMPTS)
  if (!Number.isFinite(leaseMs) || leaseMs < 60_000 || leaseMs > 15 * 60 * 1000) throw new Error('MONTHLY_DISCOVERY_LEASE_SECONDS is invalid')
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error('MONTHLY_DISCOVERY_MAX_ATTEMPTS is invalid')
  return { leaseMs, maxAttempts }
}

function requestJson({ method, path, token, body, request = https.request }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8')
    const req = request({
      hostname: 'api.github.com',
      method,
      path,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'housing-data-monthly-watchdog',
        Authorization: `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
      timeout: 15_000,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub API ${method} ${path} failed with HTTP ${response.statusCode}`))
          return
        }
        if (!text) {
          resolve(null)
          return
        }
        try { resolve(JSON.parse(text)) } catch { reject(new Error('GitHub API returned invalid JSON')) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('GitHub API request timed out')))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function workflowRunsPath(repository, workflow, branch, event = '') {
  const eventQuery = event ? `&event=${encodeURIComponent(event)}` : ''
  return `/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=${encodeURIComponent(branch)}${eventQuery}&per_page=50`
}

function isDocumentMissing(error) {
  return error?.errCode === -1 || /not found/i.test(String(error?.message || ''))
}

async function getDocumentOrNull(transaction, collection, id) {
  try {
    return await transaction.collection(collection).doc(id).get()
  } catch (error) {
    if (isDocumentMissing(error)) return null
    throw error
  }
}

async function claimStateSlot({ database, id, data }) {
  if (!database || typeof database.runTransaction !== 'function') throw new Error('Watchdog state database is unavailable')
  return database.runTransaction(async (transaction) => {
    const record = await getDocumentOrNull(transaction, 'monthlyDataWatchdog', id)
    if (record?.data?.status === 'claimed') return false
    await transaction.collection('monthlyDataWatchdog').doc(id).set({
      data: withoutDocumentId({ _id: id, status: 'claimed', ...data }),
    })
    return true
  })
}

async function claimDispatchSlot({ database, expectedAt, now }) {
  return claimStateSlot({
    database,
    id: `monthly-data-check:${expectedAt}`,
    data: {
      expected_at: expectedAt,
      claimed_at: new Date(now).toISOString(),
      expires_at: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
    },
  })
}

async function claimStallAlert({ database, runId, now }) {
  return claimStateSlot({
    database,
    id: `candidate-stalled:${runId}`,
    data: {
      run_id: runId,
      alerted_at: new Date(now).toISOString(),
    },
  })
}

function slotRecordId(slot) {
  return `discovery-slot:${slot.slot_id}`
}

function appendHistory(record, event, now, extra = {}) {
  const history = Array.isArray(record.status_history) ? record.status_history : []
  return [...history, { event, at: new Date(now).toISOString(), ...extra }].slice(-STATUS_HISTORY_LIMIT)
}

function isCompletedSlot(record) {
  return ['succeeded', 'expired'].includes(record?.status) || (record?.status === 'failed' && record.retryable === false)
}

function safeErrorCode(error) {
  const codeCandidates = [error?.code, error?.errCode, error?.statusCode]
  const code = codeCandidates.find((candidate) => typeof candidate === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(candidate)) || ''
  if (code) return code
  const numericErrorCode = [error?.errCode, error?.statusCode].find((candidate) => Number.isSafeInteger(candidate))
  if (Number.isSafeInteger(numericErrorCode)) return `CLOUD_ERROR_${numericErrorCode < 0 ? 'NEG_' : ''}${Math.abs(numericErrorCode)}`
  const message = String(error?.message || error || '').toLowerCase()
  if (/(timeout|timed out|etimedout|econnreset|eai_again|connect)/.test(message)) return 'network_timeout'
  if (/http 5\d\d|rate limit|429/.test(message)) return 'official_source_temporary_failure'
  if (/calendar|日程/.test(message)) return 'calendar_validation_failed'
  if (/pointer|current\.json|生产/.test(message)) return 'production_pointer_validation_failed'
  if (/json|parse|结构|白名单/.test(message)) return 'official_source_validation_failed'
  return 'discovery_execution_failed'
}

function safeErrorMetadata(error) {
  const metadata = {}
  for (const key of ['name', 'code', 'errCode', 'statusCode', 'discoveryStage']) {
    const value = error?.[key]
    if (typeof value === 'string' && value.length <= 120) metadata[key] = value
    else if (Number.isSafeInteger(value)) metadata[key] = value
  }
  const message = String(error?.message || '').replace(/Bearer\s+[^\s]+/gi, 'Bearer <redacted>').slice(0, 240)
  if (message) metadata.message = message
  return metadata
}

function withoutDocumentId(data) {
  if (!data || typeof data !== 'object') throw new Error('Discovery document data is invalid')
  const { _id, ...document } = data
  return document
}

function isMissingStorageFile(error) {
  const code = error?.errCode ?? error?.statusCode ?? error?.code
  return code === -1 || code === -404 || code === 'NotFound' || code === 'NoSuchKey' || /not found|no such key/i.test(String(error?.message || ''))
}

function observationBytes(observation) {
  if (!observation || typeof observation !== 'object' || !observation.observation_id || !observation.payload_sha256) {
    throw new Error('Discovery observation artifact is invalid')
  }
  return Buffer.from(JSON.stringify(observation), 'utf8')
}

async function readObservationArtifact({ cloudSdk, slotId }) {
  if (!cloudSdk || typeof cloudSdk.downloadFile !== 'function') throw new Error('Discovery observation storage read is unavailable')
  try {
    const response = await cloudSdk.downloadFile({ fileID: contract.observationFileId(slotId) })
    if (!response?.fileContent) throw new Error('Discovery observation artifact is empty')
    return Buffer.isBuffer(response.fileContent) ? response.fileContent : Buffer.from(response.fileContent)
  } catch (error) {
    if (isMissingStorageFile(error)) return null
    throw error
  }
}

async function writeObservationArtifact({ cloudSdk, observation }) {
  // Unit tests can inject a discovery executor without a CloudBase storage
  // client. A deployed function always has both methods through wx-server-sdk.
  if (!cloudSdk) return { state: 'skipped', reason: 'storage_client_unavailable' }
  if (typeof cloudSdk.downloadFile !== 'function' || typeof cloudSdk.uploadFile !== 'function') {
    throw new Error('Discovery observation storage client is incomplete')
  }
  const payload = observationBytes(observation)
  const existing = await readObservationArtifact({ cloudSdk, slotId: observation.slot_id })
  if (existing) {
    if (!existing.equals(payload)) throw new Error('不可变观察对象身份冲突')
    return { state: 'existing', key: contract.observationObjectKey(observation.slot_id) }
  }
  const key = contract.observationObjectKey(observation.slot_id)
  await cloudSdk.uploadFile({ cloudPath: key, fileContent: payload })
  const written = await readObservationArtifact({ cloudSdk, slotId: observation.slot_id })
  if (!written || !written.equals(payload)) throw new Error('观察对象写后回读哈希不一致')
  return { state: 'stored', key }
}

function isRetryableDiscoveryFailure(error) {
  if (error?.retryable === true) return true
  const code = safeErrorCode(error)
  return [
    'network_timeout',
    'official_source_temporary_failure',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'UND_ERR_CONNECT_TIMEOUT',
  ].includes(code)
}

function slotBase(slot, policy, now) {
  return {
    _id: slotRecordId(slot),
    format: 'housing-data-discovery-slot-v1',
    slot_id: slot.slot_id,
    task: slot.kind,
    planned_at: slot.planned_at,
    start_deadline_at: policy.start_deadline_at,
    retry_deadline_at: policy.retry_deadline_at,
    created_at: new Date(now).toISOString(),
    attempts: 0,
    status: 'pending',
    result_status: 'pending',
    timing_status: 'not_started',
    status_history: [],
  }
}

async function claimDiscoverySlot({ database, slot, now, owner, leaseMs, maxAttempts }) {
  if (!database || typeof database.runTransaction !== 'function') throw new Error('Discovery state database is unavailable')
  if (!slot?.slot_id || !owner || !Number.isFinite(now) || !Number.isFinite(leaseMs) || !Number.isSafeInteger(maxAttempts)) throw new Error('Discovery slot claim input is invalid')
  const policy = contract.slotPolicy(slot)
  const id = slotRecordId(slot)
  return database.runTransaction(async (transaction) => {
    const found = await getDocumentOrNull(transaction, 'monthlyDataWatchdog', id)
    const existing = found?.data || slotBase(slot, policy, now)
    if (isCompletedSlot(existing)) return { state: 'completed', record: existing }
    if (now >= policy.retry_deadline_at_ms) {
      const expired = {
        ...existing,
        status: 'expired',
        result_status: 'expired',
        retryable: false,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date(now).toISOString(),
        status_history: appendHistory(existing, 'expired', now, { reason: 'retry_deadline_reached' }),
      }
      await transaction.collection('monthlyDataWatchdog').doc(id).set({ data: withoutDocumentId(expired) })
      return { state: 'expired', record: expired }
    }
    const leaseExpiresAt = Date.parse(existing.lease_expires_at || '')
    if (existing.lease_owner && Number.isFinite(leaseExpiresAt) && leaseExpiresAt > now && existing.lease_owner !== owner) {
      return { state: 'leased', record: existing }
    }
    if (existing.attempts >= maxAttempts) {
      const failed = {
        ...existing,
        status: 'failed',
        result_status: 'failed',
        retryable: false,
        last_error_code: 'max_attempts_reached',
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date(now).toISOString(),
        status_history: appendHistory(existing, 'failed', now, { reason: 'max_attempts_reached' }),
      }
      await transaction.collection('monthlyDataWatchdog').doc(id).set({ data: withoutDocumentId(failed) })
      return { state: 'failed', record: failed }
    }
    const claimed = {
      ...existing,
      attempts: existing.attempts + 1,
      status: 'pending',
      result_status: 'claimed',
      retryable: true,
      lease_owner: owner,
      lease_expires_at: new Date(now + leaseMs).toISOString(),
      updated_at: new Date(now).toISOString(),
      status_history: appendHistory(existing, 'pending', now, { attempt: existing.attempts + 1 }),
    }
    await transaction.collection('monthlyDataWatchdog').doc(id).set({ data: withoutDocumentId(claimed) })
    return { state: 'claimed', record: claimed }
  })
}

async function markDiscoveryStarted({ database, slot, now, owner }) {
  if (!database || typeof database.runTransaction !== 'function') throw new Error('Discovery state database is unavailable')
  const policy = contract.slotPolicy(slot)
  const id = slotRecordId(slot)
  return database.runTransaction(async (transaction) => {
    const found = await getDocumentOrNull(transaction, 'monthlyDataWatchdog', id)
    const existing = found?.data
    if (!existing || existing.lease_owner !== owner || existing.status !== 'pending') return { state: 'unavailable', record: existing || null }
    const late = now > policy.start_deadline_at_ms
    const lateRecord = late && existing.timing_status !== 'late'
      ? { ...existing, status_history: appendHistory(existing, 'late', now, { start_deadline_at: policy.start_deadline_at }) }
      : existing
    const history = appendHistory(lateRecord, 'started', now, { attempt: existing.attempts })
    const started = {
      ...existing,
      status: 'started',
      result_status: 'started',
      timing_status: late ? 'late' : 'on_time',
      late_at: late ? new Date(now).toISOString() : existing.late_at || null,
      actual_started_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      status_history: history,
    }
    await transaction.collection('monthlyDataWatchdog').doc(id).set({ data: withoutDocumentId(started) })
    return { state: 'started', record: started }
  })
}

async function writeObservation({ database, observation }) {
  if (!database || typeof database.runTransaction !== 'function') throw new Error('Discovery observation database is unavailable')
  if (!observation?.observation_id || !observation.payload_sha256) throw new Error('Discovery observation is invalid')
  const id = `discovery-observation:${observation.observation_id}`
  return database.runTransaction(async (transaction) => {
    const found = await getDocumentOrNull(transaction, 'monthlyDataWatchdog', id)
    if (found?.data) {
      if (found.data.payload_sha256 !== observation.payload_sha256) throw new Error('不可变观察报告身份冲突')
      return { state: 'existing', id }
    }
    await transaction.collection('monthlyDataWatchdog').doc(id).set({
      data: withoutDocumentId({ _id: id, ...observation, stored_at: new Date().toISOString() }),
    })
    return { state: 'stored', id }
  })
}

async function completeDiscoverySlot({ database, slot, now, owner, observation }) {
  if (!database || typeof database.runTransaction !== 'function') throw new Error('Discovery state database is unavailable')
  const id = slotRecordId(slot)
  return database.runTransaction(async (transaction) => {
    const found = await getDocumentOrNull(transaction, 'monthlyDataWatchdog', id)
    const existing = found?.data
    if (!existing || existing.lease_owner !== owner || existing.status !== 'started') return { state: 'unavailable', record: existing || null }
    const completed = {
      ...existing,
      status: 'succeeded',
      result_status: observation.status,
      retryable: false,
      completed_at: new Date(now).toISOString(),
      completed_after_deadline: now > Date.parse(existing.retry_deadline_at),
      lease_owner: null,
      lease_expires_at: null,
      observation_id: observation.observation_id,
      observation_payload_sha256: observation.payload_sha256,
      handoff_identity: observation.handoff_identity,
      updated_at: new Date(now).toISOString(),
      status_history: appendHistory(existing, 'succeeded', now, { observation_id: observation.observation_id, result_status: observation.status }),
    }
    await transaction.collection('monthlyDataWatchdog').doc(id).set({ data: withoutDocumentId(completed) })
    return { state: 'succeeded', record: completed }
  })
}

async function failDiscoverySlot({ database, slot, now, owner, error, retryable, maxAttempts, observation = null }) {
  if (!database || typeof database.runTransaction !== 'function') throw new Error('Discovery state database is unavailable')
  const id = slotRecordId(slot)
  return database.runTransaction(async (transaction) => {
    const found = await getDocumentOrNull(transaction, 'monthlyDataWatchdog', id)
    const existing = found?.data
    if (!existing || existing.lease_owner !== owner || existing.status !== 'started') return { state: 'unavailable', record: existing || null }
    const beforeDeadline = now < Date.parse(existing.retry_deadline_at)
    const canRetry = retryable && beforeDeadline && existing.attempts < maxAttempts
    const failed = {
      ...existing,
      status: canRetry ? 'retrying' : 'failed',
      result_status: canRetry ? 'retrying' : 'failed',
      retryable: canRetry,
      last_error_code: safeErrorCode(error),
      completed_at: canRetry ? null : new Date(now).toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      observation_id: observation?.observation_id || null,
      observation_payload_sha256: observation?.payload_sha256 || null,
      handoff_identity: observation?.handoff_identity || null,
      updated_at: new Date(now).toISOString(),
      status_history: appendHistory(existing, canRetry ? 'retrying' : 'failed', now, { reason: safeErrorCode(error), observation_id: observation?.observation_id || null }),
    }
    await transaction.collection('monthlyDataWatchdog').doc(id).set({ data: withoutDocumentId(failed) })
    return { state: canRetry ? 'retrying' : 'failed', record: failed }
  })
}

function newExecutionOwner(now) {
  return `monthly-discovery-${now}-${Math.random().toString(36).slice(2, 10)}`
}

async function runStrictController({
  env = process.env,
  now = Date.now(),
  clock = () => Date.now(),
  database = null,
  cloudSdk = cloud,
  performDiscovery = runReadOnlyDiscovery,
  writeReport = writeObservation,
  writeArtifact = writeObservationArtifact,
  ownerFactory = newExecutionOwner,
} = {}) {
  if (!Number.isFinite(now)) throw new Error('Strict discovery controller time is invalid')
  const { leaseMs, maxAttempts } = discoverySettings(env)
  let stateDatabase
  try {
    stateDatabase = database || cloud?.database?.({ throwOnNotFound: false })
  } catch (error) {
    error.discoveryStage = 'database_init'
    throw error
  }
  const dueSlots = contract.dueSlotsForController(now)
  if (dueSlots.length === 0) return { status: 'idle', reason: 'outside_schedule', slots: [] }
  const reports = []
  for (const slot of dueSlots) {
    const policy = contract.slotPolicy(slot)
    let claim
    try {
      claim = await claimDiscoverySlot({
        database: stateDatabase,
        slot,
        now,
        owner: ownerFactory(now),
        leaseMs,
        maxAttempts,
      })
    } catch (error) {
      error.discoveryStage = 'slot_claim'
      throw error
    }
    if (claim.state !== 'claimed') {
      reports.push({ slot_id: slot.slot_id, status: claim.state, timing_status: claim.record?.timing_status || null })
      continue
    }
    const owner = claim.record.lease_owner
    const startedAt = Number(clock())
    let started
    try {
      started = await markDiscoveryStarted({ database: stateDatabase, slot, now: startedAt, owner })
    } catch (error) {
      error.discoveryStage = 'slot_start'
      throw error
    }
    if (started.state !== 'started') {
      reports.push({ slot_id: slot.slot_id, status: started.state, timing_status: started.record?.timing_status || null })
      continue
    }
    try {
      const output = await performDiscovery({ cloudSdk, now: startedAt })
      const completedAt = Number(clock())
      const observation = contract.buildDiscoveryObservation({
        slot,
        attempt: started.record.attempts,
        startedAt,
        completedAt,
        timingStatus: started.record.timing_status,
        result: output.result,
        calendar: output.calendar,
        pointer: output.pointer,
      })
      try {
        await writeReport({ database: stateDatabase, observation })
      } catch (error) {
        error.discoveryStage = 'observation_write'
        throw error
      }
      try {
        await writeArtifact({ cloudSdk, observation })
      } catch (error) {
        error.discoveryStage = 'observation_artifact_write'
        throw error
      }
      if (output.result.status === 'anomaly') {
        const failed = await failDiscoverySlot({
          database: stateDatabase,
          slot,
          now: completedAt,
          owner,
          error: Object.assign(new Error('Official discovery produced an anomaly'), { code: 'OFFICIAL_SOURCE_VALIDATION_FAILED' }),
          retryable: false,
          maxAttempts,
          observation,
        })
        reports.push({ slot_id: slot.slot_id, status: failed.state, timing_status: failed.record?.timing_status || null, observation_id: observation.observation_id })
      } else {
        const completed = await completeDiscoverySlot({ database: stateDatabase, slot, now: completedAt, owner, observation })
        reports.push({ slot_id: slot.slot_id, status: completed.state, timing_status: completed.record?.timing_status || null, observation_id: observation.observation_id })
      }
    } catch (error) {
      if (!error.discoveryStage) error.discoveryStage = 'official_discovery'
      const completedAt = Number(clock())
      const failed = await failDiscoverySlot({
        database: stateDatabase,
        slot,
        now: completedAt,
        owner,
        error,
        retryable: isRetryableDiscoveryFailure(error),
        maxAttempts,
      })
      reports.push({ slot_id: slot.slot_id, status: failed.state, timing_status: failed.record?.timing_status || null, error_code: safeErrorCode(error) })
    }
  }
  const hasAttention = reports.some((report) => ['failed', 'expired', 'retrying'].includes(report.status))
  const hasStarted = reports.some((report) => ['succeeded', 'failed', 'retrying'].includes(report.status))
  return { status: hasAttention ? 'attention' : hasStarted ? 'processed' : 'idle', reason: hasAttention ? 'slot_attention_required' : 'slots_already_completed', slots: reports }
}

async function runWatchdog({ env = process.env, now = Date.now(), request = https.request, claimSlot = null, claimAlert = null } = {}) {
  assertConfiguration(env)
  const repository = env.WATCHDOG_REPOSITORY || DEFAULT_REPOSITORY
  const workflow = env.WATCHDOG_WORKFLOW || DEFAULT_WORKFLOW
  const publishWorkflow = env.WATCHDOG_PUBLISH_WORKFLOW || DEFAULT_PUBLISH_WORKFLOW
  const branch = env.WATCHDOG_DEFAULT_BRANCH || DEFAULT_BRANCH
  const graceMs = Number(env.WATCHDOG_GRACE_MINUTES || DEFAULT_GRACE_MS / 60_000) * 60_000
  const cooldownMs = Number(env.WATCHDOG_COOLDOWN_MINUTES || DEFAULT_COOLDOWN_MS / 60_000) * 60_000
  const lookbackMinutes = Number(env.WATCHDOG_LOOKBACK_MINUTES || DEFAULT_LOOKBACK_MINUTES)
  const stallMs = Number(env.WATCHDOG_STALL_MINUTES || DEFAULT_STALL_MS / 60_000) * 60_000
  if (![graceMs, cooldownMs].every((value) => Number.isFinite(value) && value >= 0)
    || !Number.isFinite(stallMs) || stallMs < 1
    || !Number.isSafeInteger(lookbackMinutes) || lookbackMinutes < 1) throw new Error('Watchdog timing configuration is invalid')

  const expectedAt = latestExpectedScheduleAt(now - graceMs, lookbackMinutes)
  const [scheduleResponse, dispatchResponse, publishResponse] = await Promise.all([
    expectedAt === null ? { workflow_runs: [] } : requestJson({ method: 'GET', path: workflowRunsPath(repository, workflow, branch, 'schedule'), token: env.WATCHDOG_GITHUB_TOKEN, request }),
    expectedAt === null ? { workflow_runs: [] } : requestJson({ method: 'GET', path: workflowRunsPath(repository, workflow, branch, 'workflow_dispatch'), token: env.WATCHDOG_GITHUB_TOKEN, request }),
    requestJson({ method: 'GET', path: workflowRunsPath(repository, publishWorkflow, branch), token: env.WATCHDOG_GITHUB_TOKEN, request }),
  ])
  const stalledRun = findStalledRun({ runs: publishResponse?.workflow_runs || [], branch, now, stallMs })
  if (stalledRun) {
    if (envBoolean(env.WATCHDOG_DRY_RUN)) return { status: 'would_alert', reason: 'candidate_stalled', ...stalledRun }
    const claimAlertFn = claimAlert || ((input) => claimStallAlert({ database: cloud?.database?.(), ...input }))
    const claimed = await claimAlertFn({ runId: stalledRun.runId, now })
    if (!claimed) return { status: 'idle', reason: 'already_alerted', ...stalledRun }
    return { status: 'stalled', reason: 'candidate_stalled', ...stalledRun }
  }
  if (expectedAt === null) return { status: 'idle', reason: 'no_expected_schedule' }
  const decision = decideWatchdog({
    now,
    expectedAt,
    scheduleRuns: scheduleResponse?.workflow_runs || [],
    dispatchRuns: dispatchResponse?.workflow_runs || [],
    branch,
    graceMs,
    cooldownMs,
  })
  if (!decision.shouldDispatch) return { status: 'idle', ...decision }
  if (envBoolean(env.WATCHDOG_DRY_RUN)) return { status: 'would_dispatch', ...decision }

  const claim = claimSlot || ((input) => claimDispatchSlot({ database: cloud?.database?.(), ...input }))
  const claimed = await claim({ expectedAt: decision.expectedAt, now })
  if (!claimed) return { status: 'idle', reason: 'already_claimed', expectedAt: decision.expectedAt }

  await requestJson({
    method: 'POST',
    path: `/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    token: env.WATCHDOG_GITHUB_TOKEN,
    request,
    body: { ref: branch, inputs: { watchdog_slot: decision.expectedAt } },
  })
  return { status: 'dispatched', ...decision }
}

exports.main = async (event = {}) => {
  const now = Number.isFinite(event.now_ms) ? event.now_ms : Date.now()
  try {
    const strict = await runStrictController({ env: process.env, now })
    let watchdog = { status: 'disabled', reason: 'github_audit_disabled' }
    if (envBoolean(process.env.WATCHDOG_GITHUB_AUDIT_ENABLED)) {
      try {
        watchdog = await runWatchdog({ env: process.env, now })
      } catch (error) {
        watchdog = { status: 'blocked', reason: 'github_watchdog_error', error_code: safeErrorCode(error) }
      }
    }
    console.log(JSON.stringify({ strict_status: strict.status, strict_reason: strict.reason, watchdog_status: watchdog.status }))
    if (strict.status === 'attention') {
      console.error(JSON.stringify({
        event: 'monthly_discovery_attention',
        slots: strict.slots.filter((slot) => ['failed', 'expired', 'retrying'].includes(slot.status)),
      }))
    }
    return { strict, watchdog }
  } catch (error) {
    const errorCode = safeErrorCode(error)
    console.error(`[monthly-discovery] ${errorCode} ${JSON.stringify(safeErrorMetadata(error))}`)
    return { strict: { status: 'blocked', reason: errorCode }, watchdog: { status: 'disabled', reason: 'not_run' } }
  }
}

exports.runWatchdog = runWatchdog
exports.requestJson = requestJson
exports.claimDispatchSlot = claimDispatchSlot
exports.claimStallAlert = claimStallAlert
exports.claimDiscoverySlot = claimDiscoverySlot
exports.markDiscoveryStarted = markDiscoveryStarted
exports.writeObservation = writeObservation
exports.writeObservationArtifact = writeObservationArtifact
exports.readObservationArtifact = readObservationArtifact
exports.completeDiscoverySlot = completeDiscoverySlot
exports.failDiscoverySlot = failDiscoverySlot
exports.isRetryableDiscoveryFailure = isRetryableDiscoveryFailure
exports.runStrictController = runStrictController
exports.safeErrorMetadata = safeErrorMetadata
exports.withoutDocumentId = withoutDocumentId
