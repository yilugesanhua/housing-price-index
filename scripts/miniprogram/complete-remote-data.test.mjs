import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { buildCompleteRemoteRelease, COMPLETE_REMOTE_MONTHS, COMPLETE_REMOTE_START, verifyCompleteRemoteRelease } from './complete-remote-data.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const bundled = require(resolve(root, 'apps/miniprogram/data/snapshot.js'))

function fixture() {
  const snapshot = structuredClone(bundled)
  const paddingMonths = []
  for (let index = 0; index < 60; index += 1) {
    const date = new Date(`${bundled.months[0]}-01T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() - (60 - index))
    paddingMonths.push(date.toISOString().slice(0, 7))
  }
  snapshot.months = [...paddingMonths, ...snapshot.months]
  snapshot.coverageStart = COMPLETE_REMOTE_START
  snapshot.sourceCoverageStart = COMPLETE_REMOTE_START
  snapshot.releaseDates = [...Array(60).fill('2011-07-18'), ...snapshot.releaseDates]
  for (const cityId of snapshot.cityIds) {
    for (const code of Object.keys(snapshot.series[cityId])) snapshot.series[cityId][code] = [...Array(60 * 4).fill(null), ...snapshot.series[cityId][code]]
  }
  snapshot.latestSeries = Object.fromEntries(snapshot.cityIds.map((cityId) => [cityId, Object.fromEntries(Object.entries(snapshot.series[cityId]).map(([code, values]) => [code, values.slice(-4)]))]))
  snapshot.breadthSeries = Object.fromEntries(Object.keys(snapshot.series[snapshot.cityIds[0]]).flatMap((code) => [['mom', 2], ['yoy', 3]].map(([metric, offset]) => [
    `${code}_${metric}`,
    snapshot.months.flatMap((_month, monthIndex) => snapshot.cityIds.reduce((counts, cityId) => {
      const value = snapshot.series[cityId][code][monthIndex * 4 + offset]
      counts[value === null ? 3 : value > 0 ? 0 : value < 0 ? 2 : 1] += 1
      return counts
    }, [0, 0, 0, 0])),
  ])))
  assert.equal(snapshot.months.length, COMPLETE_REMOTE_MONTHS)
  return snapshot
}

test('complete remote release is one verified 180-month business data file', () => {
  const snapshot = fixture()
  const release = buildCompleteRemoteRelease(snapshot, {
    cloudEnvId: 'cloud1-d3gpdx70w5d05c68c',
    storageBucket: '636c-cloud1-d3gpdx70w5d05c68c-1456861154',
    minimumAppVersion: 'v2.5.0',
    nextCheckAt: '2026-08-17T01:40:00.000Z',
    sourceBatchIds: ['official-html-test'],
  })
  assert.equal(release.manifest.month_count, 180)
  assert.equal(release.manifest.coverage_start, '2011-07')
  assert.ok(release.manifest.complete_snapshot_file_id.endsWith('/complete-snapshot.json'))
  assert.deepEqual(verifyCompleteRemoteRelease(snapshot, release), [])
})

test('complete remote release rejects any data-file tampering', () => {
  const snapshot = fixture()
  const release = buildCompleteRemoteRelease(snapshot, {
    cloudEnvId: 'cloud1-d3gpdx70w5d05c68c', storageBucket: '636c-cloud1-d3gpdx70w5d05c68c-1456861154',
    minimumAppVersion: 'v2.5.0', nextCheckAt: '2026-08-17T01:40:00.000Z', sourceBatchIds: ['official-html-test'],
  })
  release.completeSnapshotText += ' '
  assert.match(verifyCompleteRemoteRelease(snapshot, release).join('\n'), /SHA-256 mismatch/)
})
