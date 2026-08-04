import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { decodeSnapshot } = require('../../apps/miniprogram/utils/snapshot-codec.js')

test('snapshot codec restores signed one-decimal values and nulls exactly', () => {
  const values = Array.from({ length: 8 * 4 }, (_, index) => index === 1 ? -0.7 : index === 2 ? null : 100 + index / 10)
  const bytes = Buffer.allocUnsafe(values.length * 2)
  values.forEach((value, index) => bytes.writeInt16LE(value === null ? -32768 : Math.round(value * 10), index * 2))
  const decoded = decodeSnapshot({
    seriesEncoding: 'int16-base64-v1',
    seriesScale: 10,
    months: ['2026-06'],
    cityIds: ['beijing'],
    encodedSeries: { beijing: bytes.toString('base64') },
  })
  assert.deepEqual(decoded.series.beijing.n_a, [100, -0.7, null, 100.3])
  assert.deepEqual(decoded.series.beijing.r_l, [102.8, 102.9, 103, 103.1])
})
