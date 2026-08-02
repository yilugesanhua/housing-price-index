'use strict'

const migrations = {
  'legacy-control-2026-06-e9788d0bddf3': {
    migration_id: 'legacy-control-2026-06-e9788d0bddf3',
    cloud_env_id: 'cloud1-d3gpdx70w5d05c68c',
    storage_bucket: '636c-cloud1-d3gpdx70w5d05c68c-1456861154',
    legacy_current_sha256: '8fae20cb98e56d3321be45306a8e2fdbef9e2dc9482791fab79c0687b3de2f4e',
    legacy_manifest_sha256: '62692a9c33928377b576f4e814e12bcf6cc265779d7564a4eaa6befb540d062e',
    legacy_bootstrap_sha256: '5cb9082a5c2f931f2e11cf128a3005d922bdf11c4fff9af3357296565b751d91',
    legacy_bootstrap_bytes: 1349471,
    legacy_source_coverage_start: '2016-01',
    client_coverage_start: '2016-07',
    dataset_version: '2026-06-e9788d0bddf3',
    source_dataset_version: '2026-06-4fd1d1a8ff12',
    dataset_as_of: '2026-06',
    schema_version: '1.3.0',
    published_at: '2026-07-29T03:17:46.325Z',
    previous_dataset_version: null,
    next_check_at: '2026-08-17T01:40:00.000Z',
    superseded_dataset_version: '2026-06-ec36ff8fb2e5',
    superseded_source_dataset_version: '2026-06-679ea146d4e2',
    revision_id: 'revision-2026-06-parser-v7-audit-v4',
    registry_generated_at: '2026-07-29T03:17:46.325Z',
    revoked_dataset_versions: [
      {
        dataset_version: '2026-06-679ea146d4e2',
        revoked_at: '2026-07-26T11:47:41.551Z',
        revision_id: null,
        replacement_dataset_version: '2026-06-ec36ff8fb2e5',
        reason: 'initial remote manifest used an unusable environment-only cloud file ID',
      },
      {
        dataset_version: '2026-06-ec36ff8fb2e5',
        revoked_at: '2026-07-29T00:00:00.000Z',
        revision_id: 'revision-2026-06-parser-v7-audit-v4',
        replacement_dataset_version: '2026-06-e9788d0bddf3',
        reason: 'parser v7 and full-record audit v4 replaced the incorrect source-backed package',
      },
    ],
    revoked_source_dataset_versions: [
      {
        source_dataset_version: '2026-06-679ea146d4e2',
        revoked_at: '2026-07-29T00:00:00.000Z',
        revision_id: 'revision-2026-06-parser-v7-audit-v4',
        replacement_source_dataset_version: '2026-06-4fd1d1a8ff12',
        reason: 'parser v7 and full-record audit v4 corrected 150 historical records',
      },
    ],
  },
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const item of Object.values(value)) deepFreeze(item)
  return Object.freeze(value)
}

module.exports = deepFreeze(migrations)
