import decision from '../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/decision.js'

export const {
  MINUTE_MS,
  DEFAULT_GRACE_MS,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_LOOKBACK_MINUTES,
  DEFAULT_STALL_MS,
  isExpectedScheduleSlot,
  latestExpectedScheduleAt,
  findStalledRun,
  decideWatchdog,
} = decision
