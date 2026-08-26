const MINUTE_MS = 60 * 1000
const DEFAULT_GRACE_MS = 10 * MINUTE_MS
const DEFAULT_COOLDOWN_MS = 15 * MINUTE_MS
const DEFAULT_LOOKBACK_MINUTES = 24 * 60
const DEFAULT_STALL_MS = 30 * MINUTE_MS

function timestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : null
}

function floorMinute(value) {
  return Math.floor(value / MINUTE_MS) * MINUTE_MS
}

function isExpectedScheduleSlot(value) {
  const date = new Date(value)
  const hour = date.getUTCHours()
  const minute = date.getUTCMinutes()
  if (hour === 1 && minute === 0) return true
  return hour >= 1 && hour <= 9 && [15, 35, 55].includes(minute)
}

function latestExpectedScheduleAt(now = Date.now(), lookbackMinutes = DEFAULT_LOOKBACK_MINUTES) {
  if (!Number.isFinite(now) || !Number.isSafeInteger(lookbackMinutes) || lookbackMinutes < 1) return null
  const latestMinute = floorMinute(now)
  for (let offset = 0; offset <= lookbackMinutes; offset += 1) {
    const candidate = latestMinute - offset * MINUTE_MS
    if (isExpectedScheduleSlot(candidate)) return candidate
  }
  return null
}

function validRun(run, branch, expectedAt, now) {
  if (!run || typeof run !== 'object') return null
  if (run.head_branch && run.head_branch !== branch) return null
  const createdAt = timestamp(run.created_at || run.run_started_at || run.updated_at)
  if (createdAt === null || createdAt > now + 2 * MINUTE_MS || createdAt < expectedAt - 2 * MINUTE_MS) return null
  return { ...run, createdAt }
}

function findStalledRun({ runs = [], branch = 'main', now = Date.now(), stallMs = DEFAULT_STALL_MS } = {}) {
  if (!Array.isArray(runs) || typeof branch !== 'string' || !branch || !Number.isFinite(now)
    || !Number.isFinite(stallMs) || stallMs < 1) return null
  const stalled = runs.map((run) => {
    if (!run || typeof run !== 'object' || (run.head_branch && run.head_branch !== branch)) return null
    if (!['queued', 'in_progress'].includes(run.status)) return null
    const createdAt = timestamp(run.created_at || run.run_started_at || run.updated_at)
    if (createdAt === null || createdAt > now || now - createdAt < stallMs) return null
    const runId = String(run.id || '')
    if (!runId) return null
    return { ...run, runId, createdAt, ageMs: now - createdAt }
  }).filter(Boolean).sort((left, right) => left.createdAt - right.createdAt)
  const run = stalled[0]
  if (!run) return null
  return {
    runId: run.runId,
    createdAt: new Date(run.createdAt).toISOString(),
    ageMs: run.ageMs,
  }
}

function safeResult(reason, expectedAt = null) {
  return {
    shouldDispatch: false,
    reason,
    expectedAt: expectedAt === null ? null : new Date(expectedAt).toISOString(),
  }
}

function decideWatchdog({
  now = Date.now(),
  expectedAt = null,
  scheduleRuns = [],
  dispatchRuns = [],
  branch = 'main',
  graceMs = DEFAULT_GRACE_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
} = {}) {
  if (!Number.isFinite(now) || !Array.isArray(scheduleRuns) || !Array.isArray(dispatchRuns)
    || typeof branch !== 'string' || !branch || !Number.isFinite(graceMs) || graceMs < 0
    || !Number.isFinite(cooldownMs) || cooldownMs < 0) return safeResult('invalid_input')
  const slot = expectedAt === null ? latestExpectedScheduleAt(now) : timestamp(expectedAt)
  if (slot === null || slot > now) return safeResult('no_expected_schedule', slot)
  if (now < slot + graceMs) return safeResult('within_grace_period', slot)

  const validSchedules = scheduleRuns.map((run) => validRun(run, branch, slot, now)).filter(Boolean)
  const validDispatches = dispatchRuns.map((run) => validRun(run, branch, slot, now)).filter(Boolean)
  const recentDispatch = validDispatches.find((run) => run.createdAt >= slot - 2 * MINUTE_MS)
    || validDispatches.find((run) => run.createdAt >= now - cooldownMs)
  if (recentDispatch) return { ...safeResult('already_dispatched', slot), runId: String(recentDispatch.id || '') }

  const observedSchedule = validSchedules.find((run) => run.status === 'queued'
    || run.status === 'in_progress'
    || run.conclusion === 'success')
  if (observedSchedule) return { ...safeResult('schedule_observed', slot), runId: String(observedSchedule.id || '') }

  const failedSchedule = validSchedules.find((run) => ['failure', 'cancelled', 'timed_out', 'action_required'].includes(run.conclusion))
  if (failedSchedule) {
    return {
      ...safeResult('schedule_failed', slot),
      failedRunId: String(failedSchedule.id || ''),
    }
  }
  return {
    shouldDispatch: true,
    reason: 'schedule_missing',
    expectedAt: new Date(slot).toISOString(),
    failedRunId: '',
  }
}

module.exports = {
  MINUTE_MS,
  DEFAULT_GRACE_MS,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_LOOKBACK_MINUTES,
  DEFAULT_STALL_MS,
  isExpectedScheduleSlot,
  latestExpectedScheduleAt,
  findStalledRun,
  decideWatchdog,
}
