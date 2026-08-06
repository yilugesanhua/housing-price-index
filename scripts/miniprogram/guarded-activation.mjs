import { stableJson } from './remote-data-lib.mjs'

export class GuardedActivationError extends Error {
  constructor(message, { cause, rollbackStatus, rollbackError = null }) {
    super(message, { cause })
    this.name = 'GuardedActivationError'
    this.rollbackStatus = rollbackStatus
    this.rollbackError = rollbackError
  }
}

export async function activatePointerWithRollback({
  candidate,
  candidateText,
  previous,
  rollbackEligible,
  writePointer,
  readPointerText,
  guardCandidate,
  guardRollback,
  prepareRollback,
  verifyRollbackTarget,
  recordRollback = async () => {},
  recordFailure = async () => {},
  now = () => new Date().toISOString(),
}) {
  const rollbackAvailable = rollbackEligible === true
    && previous
    && typeof prepareRollback === 'function'
    && typeof guardRollback === 'function'
    && typeof verifyRollbackTarget === 'function'
  if (!rollbackAvailable) {
    const cause = new Error('verified automatic rollback target is unavailable before candidate activation')
    throw new GuardedActivationError('Candidate pointer was not activated because a verified automatic rollback target is required', {
      cause,
      rollbackStatus: 'not-available',
    })
  }

  try {
    await verifyRollbackTarget(previous)
  } catch (error) {
    throw new GuardedActivationError('Candidate pointer was not activated because the verified automatic rollback target preflight failed', {
      cause: error,
      rollbackStatus: 'not-available',
    })
  }

  try {
    await writePointer(candidateText, 'candidate')
    if (await readPointerText('candidate') !== candidateText) throw new Error('candidate pointer round-trip mismatch')
    await guardCandidate(candidate)
    return { status: 'published', rollback_status: 'not-needed' }
  } catch (guardError) {
    const failedAt = now()
    let rollbackStatus = 'not-available'
    let rollbackError = null
    let rollbackPointer = null
    if (rollbackEligible && previous) {
      try {
        if (typeof prepareRollback !== 'function') throw new Error('automatic rollback preparation is unavailable')
        rollbackPointer = await prepareRollback({ failedAt, previous, candidate, guardError })
        const rollbackText = stableJson(rollbackPointer)
        await writePointer(rollbackText, 'automatic-rollback')
        if (await readPointerText('automatic-rollback') !== rollbackText) throw new Error('automatic rollback pointer round-trip mismatch')
        await guardRollback(rollbackPointer)
        rollbackStatus = 'succeeded'
        await recordRollback({ failedAt, guardError, rollbackPointer, rollbackText })
      } catch (error) {
        rollbackStatus = 'failed'
        rollbackError = error
      }
    }
    await recordFailure({ failedAt, guardError, rollbackStatus, rollbackError, rollbackPointer })
    const error = new GuardedActivationError(`Post-publish guard failed; automatic rollback ${rollbackStatus}: ${guardError?.message || guardError}${rollbackError ? `; ${rollbackError?.message || rollbackError}` : ''}`, { cause: guardError, rollbackStatus, rollbackError })
    throw error
  }
}
