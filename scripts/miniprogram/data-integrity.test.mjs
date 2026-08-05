import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const bundled = require(resolve(root, 'apps/miniprogram/data/snapshot.js'))
const { validateBundledSnapshot } = require(resolve(root, 'apps/miniprogram/utils/data-integrity.js'))

function options() {
  return { cityIds: bundled.cityIds, featuredCityIds: bundled.featuredCityIds }
}

test('mini program independently accepts the complete bundled numeric snapshot', () => {
  assert.equal(validateBundledSnapshot(structuredClone(bundled), options()).datasetVersion, bundled.datasetVersion)
})

test('mini program rejects out-of-range, over-precise, and false calendar data', () => {
  const overPrecise = structuredClone(bundled)
  overPrecise.series[overPrecise.cityIds[0]].n_a[0] = 100.12
  assert.throws(() => validateBundledSnapshot(overPrecise, options()), /outside the allowed range or precision/)

  const outOfRange = structuredClone(bundled)
  outOfRange.series[outOfRange.cityIds[0]].n_a[0] = 1001
  outOfRange.series[outOfRange.cityIds[0]].n_a[2] = 901
  assert.throws(() => validateBundledSnapshot(outOfRange, options()), /outside the allowed range or precision/)

  const falseDate = structuredClone(bundled)
  falseDate.releaseDate = '2026-02-31'
  falseDate.releaseDates[falseDate.releaseDates.length - 1] = falseDate.releaseDate
  assert.throws(() => validateBundledSnapshot(falseDate, options()), /release date is invalid/)
})
