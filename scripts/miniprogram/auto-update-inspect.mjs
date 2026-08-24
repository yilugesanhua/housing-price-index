import { validatePendingReleaseState } from './inspect-pending-release.mjs'

/**
 * A durable candidate is considered handled only when its committed pending
 * record still proves the same candidate identity as the durable state.
 * Published state is the terminal record and does not need a pending file.
 */
export function isSameReleaseHandled({ state, pending, handoff }) {
  if (!state || state.dataset_as_of !== handoff.expected_stat_month || state.official_url !== handoff.official_url) return false
  if (state.status === 'published') return true
  if (!['ready', 'publishing'].includes(state.status)) return false
  try {
    const result = validatePendingReleaseState(pending)
    if (!result.ready) return false
    return pending.dataset_as_of === state.dataset_as_of
      && pending.official_url === state.official_url
      && pending.release_key === state.release_key
      && pending.candidate_id === state.candidate_id
      && pending.producer_commit_sha === state.producer_commit_sha
      && pending.candidate_commit_sha === state.candidate_commit_sha
      && pending.candidate_manifest_sha256 === state.candidate_manifest_sha256
      && pending.dataset_as_of === handoff.expected_stat_month
      && pending.official_url === handoff.official_url
  } catch {
    return false
  }
}
