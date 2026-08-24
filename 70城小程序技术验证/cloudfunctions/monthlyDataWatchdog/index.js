const https = require('node:https')
let cloud = null
try {
  cloud = require('wx-server-sdk')
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
} catch {
  cloud = null
}
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

async function claimStateSlot({ database, id, data }) {
  if (!database || typeof database.runTransaction !== 'function') throw new Error('Watchdog state database is unavailable')
  return database.runTransaction(async (transaction) => {
    const record = await transaction.collection('monthlyDataWatchdog').doc(id).get().catch((error) => {
      if (error?.errCode === -1 || /not found/i.test(String(error?.message || ''))) return null
      throw error
    })
    if (record?.data?.status === 'claimed') return false
    await transaction.collection('monthlyDataWatchdog').doc(id).set({
      data: { _id: id, status: 'claimed', ...data },
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
    const claimAlertFn = claimAlert || ((input) => claimStallAlert({
      database: cloud?.database?.(),
      ...input,
    }))
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

  const claim = claimSlot || ((input) => claimDispatchSlot({
    database: cloud?.database?.(),
    ...input,
  }))
  const claimed = await claim({ expectedAt: decision.expectedAt, now })
  if (!claimed) return { status: 'idle', reason: 'already_claimed', expectedAt: decision.expectedAt }

  await requestJson({
    method: 'POST',
    path: `/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    token: env.WATCHDOG_GITHUB_TOKEN,
    request,
    body: {
      ref: branch,
      inputs: { watchdog_slot: decision.expectedAt },
    },
  })
  return { status: 'dispatched', ...decision }
}

exports.main = async (event = {}) => {
  try {
    const result = await runWatchdog({
      env: process.env,
      now: Number.isFinite(event.now_ms) ? event.now_ms : Date.now(),
    })
    console.log(JSON.stringify({ status: result.status, reason: result.reason, expectedAt: result.expectedAt || null }))
    return result
  } catch (error) {
    console.error(`[watchdog] ${error instanceof Error ? error.message : String(error)}`)
    return { status: 'blocked', reason: 'watchdog_error' }
  }
}

exports.runWatchdog = runWatchdog
exports.requestJson = requestJson
exports.claimDispatchSlot = claimDispatchSlot
exports.claimStallAlert = claimStallAlert
