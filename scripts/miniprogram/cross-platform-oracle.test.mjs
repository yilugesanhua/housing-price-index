import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOracleInput, evaluateBoundaryFixture, runCrossPlatformOracle } from './cross-platform-oracle.mjs'

test('cross-platform oracle binds a versioned input and independent expected results', () => {
  const input = buildOracleInput()
  assert.equal(input.oracle_version, 'housing-cross-platform-oracle-v1')
  assert.equal(input.dataset.dataset_version, input.dataset.snapshot_version)
  assert.equal(input.cases.length, 144)
  assert.match(input.input_sha256, /^[a-f0-9]{64}$/)
  assert.equal(input.input_sha256, buildOracleInput().input_sha256)
})

test('Web core and mini program match the independent oracle across the full filter and boundary matrix', () => {
  const report = runCrossPlatformOracle()
  assert.equal(report.case_count, 144)
  assert.match(report.expected_sha256, /^[a-f0-9]{64}$/)
  assert.equal(report.input.input_sha256, buildOracleInput().input_sha256)
  for (const [index, expected] of report.expected.entries()) {
    assert.deepEqual(report.web[index], expected, `Web case ${index} differs from oracle`)
    assert.deepEqual(report.mini[index], expected, `mini program case ${index} differs from oracle`)
  }
})

test('independent oracle handles missing values and ties at the boundary', () => {
  const result = evaluateBoundaryFixture()
  assert.deepEqual(result.counts, { up: 2, flat: 0, down: 1, missing: 1 })
  assert.deepEqual(result.ranked, [
    { city_id: 'beijing', rank: 1, tied: true },
    { city_id: 'shanghai', rank: 1, tied: true },
    { city_id: 'fuzhou', rank: 3, tied: false },
  ])
})
