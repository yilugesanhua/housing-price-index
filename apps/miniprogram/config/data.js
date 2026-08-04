module.exports = Object.freeze({
  enabled: true,
  cloudEnvId: 'cloud1-d3gpdx70w5d05c68c',
  storageBucket: '636c-cloud1-d3gpdx70w5d05c68c-1456861154',
  manifestFunctionName: 'getHousingDataManifest',
  remoteFormat: 'housing-miniprogram-data',
  remoteSchemaMajor: 2,
  acceptedRemoteSchemaMajors: [1, 2],
  // The expanded 15-year source has a new identity, but its bundled 10-year
  // window was independently verified against this one audited legacy package.
  bundledLegacySupersession: [{
    bundledDatasetVersion: '2026-06-7231b82f3664',
    bundledSourceDatasetVersion: '2026-06-69fa180bd8db',
    migrationId: 'legacy-control-2026-06-e9788d0bddf3',
  }],
  completeRemoteCoverageStart: '2011-07',
  completeRemoteMonthCount: 180,
  monthlyMinimumAppVersion: 'v2.3.0',
  correctionMinimumAppVersion: 'v2.4.0',
  controlCheckIntervalMs: 15 * 60 * 1000,
  releaseRetryMs: 15 * 60 * 1000,
  failureRetryMs: 60 * 60 * 1000,
  maximumCheckDelayMs: 31 * 24 * 60 * 60 * 1000,
})
