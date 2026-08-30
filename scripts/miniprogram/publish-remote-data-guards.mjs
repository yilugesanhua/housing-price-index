import { classifyControlPointer, validateControlPointer } from './control-plane.mjs'

const DATASET_VERSION_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/

function assert(condition, message) {
  if (!condition) throw new Error(`Publish guard rejected: ${message}`)
}

function inspectHistoricalCorrectionPublishState({
  previous,
  previousManifest,
  candidateManifest,
  candidateRevisionManifest,
  registry,
  gate,
  datasetVersion,
  cloudEnvId,
  storageBucket,
} = {}) {
  assert(previous?.dataset_version && previousManifest && candidateManifest && gate, 'historical correction state is incomplete')
  assert(previous.dataset_as_of === candidateManifest.dataset_as_of, 'active month differs from correction month')
  assert(candidateManifest.dataset_version === datasetVersion, 'candidate manifest dataset version mismatch')
  assert(candidateManifest.release_type === 'historical_correction', 'candidate is not a historical correction')
  assert(candidateManifest.revision_id === gate.revision_id, 'candidate revision ID mismatch')
  assert(candidateManifest.source_dataset_version === gate.source_dataset_version, 'candidate source dataset version mismatch')
  assert(candidateManifest.supersedes_source_dataset_version === gate.supersedes_source_dataset_version, 'candidate superseded source mismatch')
  assert(candidateRevisionManifest?.revision_id === gate.revision_id, 'candidate revision manifest ID mismatch')
  assert(candidateRevisionManifest?.source_dataset_version === gate.source_dataset_version, 'candidate revision source mismatch')
  assert(candidateRevisionManifest?.supersedes_source_dataset_version === gate.supersedes_source_dataset_version, 'candidate revision superseded source mismatch')
  const sourceChain = candidateRevisionManifest?.source_version_chain
  assert(Array.isArray(sourceChain)
    && sourceChain.at(-2) === gate.supersedes_source_dataset_version
    && sourceChain.at(-1) === gate.source_dataset_version, 'candidate source chain is incomplete')
  assert(candidateRevisionManifest.revoked_source_dataset_versions?.includes(gate.supersedes_source_dataset_version), 'candidate revision does not revoke the superseded source')
  if (gate.commit_sha) assert(candidateRevisionManifest.commit_sha === gate.commit_sha, 'candidate revision commit SHA mismatch')
  if (gate.github_run_id) assert(String(candidateRevisionManifest.github_run_id) === String(gate.github_run_id), 'candidate revision run ID mismatch')

  if (previous.dataset_version !== datasetVersion) {
    assert(previousManifest.dataset_version === previous.dataset_version, 'old active manifest dataset version mismatch')
    if (gate.expected_current_dataset_version) {
      assert(previous.dataset_version === gate.expected_current_dataset_version, 'old active dataset is not the approved superseded package')
    }
    assert(previousManifest.source_dataset_version === gate.supersedes_source_dataset_version, 'old active source is not the approved superseded source')
    return 'old_active'
  }

  assert(classifyControlPointer(previous) === 'controlled', 'active candidate uses legacy control metadata')
  assert(registry, 'active candidate revocation registry is missing')
  validateControlPointer(previous, {
    allowLegacy: false,
    requireContext: true,
    manifest: previousManifest,
    revisionManifest: candidateRevisionManifest,
    registry,
    cloudEnvId,
    storageBucket,
  })
  assert(previousManifest.source_dataset_version === gate.source_dataset_version, 'active candidate source dataset version mismatch')
  assert(previous.superseded_source_dataset_version === gate.supersedes_source_dataset_version, 'active candidate superseded source metadata mismatch')
  assert(DATASET_VERSION_PATTERN.test(previous.superseded_dataset_version || '') && previous.superseded_dataset_version !== datasetVersion, 'active candidate superseded dataset metadata is invalid')
  if (gate.expected_current_dataset_version) {
    assert(previous.superseded_dataset_version === gate.expected_current_dataset_version, 'active candidate superseded dataset differs from the approved package')
  }
  return 'candidate_active'
}

export function classifyHistoricalCorrectionPublishState(options = {}) {
  try {
    return inspectHistoricalCorrectionPublishState(options)
  } catch (_) {
    return 'conflict'
  }
}

export function validateHistoricalCorrectionPublishState(options = {}) {
  return inspectHistoricalCorrectionPublishState(options)
}

export function assertPointerBaseline(actualText, expectedText, label) {
  assert(actualText === expectedText, `current.json changed before ${label}; retry from the new state`)
  return true
}

export function assertProductionPointerBaseline(pointer) {
  if (pointer === null || pointer === undefined) return 'absent'
  assert(classifyControlPointer(pointer) === 'controlled', 'active current.json uses legacy control; run the approved one-time legacy migration first')
  return 'controlled'
}
