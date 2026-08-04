const SERIES_CODES = ['n_a', 'n_s', 'n_m', 'n_l', 'r_a', 'r_s', 'r_m', 'r_l']
const SERIES_WIDTH = 4
const NULL_SENTINEL = -32768

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function decodeBase64(value) {
  assert(typeof value === 'string' && value.length > 0, 'encoded snapshot series is invalid')
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(value, 'base64'))
  if (typeof wx !== 'undefined' && typeof wx.base64ToArrayBuffer === 'function') return new Uint8Array(wx.base64ToArrayBuffer(value))

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bytes = []
  let buffer = 0
  let bits = 0
  for (const char of value.replace(/=+$/, '')) {
    const index = alphabet.indexOf(char)
    assert(index >= 0, 'encoded snapshot base64 is invalid')
    buffer = (buffer << 6) | index
    bits += 6
    while (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return Uint8Array.from(bytes)
}

function decodeCitySeries(value, monthCount, scale) {
  const bytes = decodeBase64(value)
  const expectedValueCount = SERIES_CODES.length * monthCount * SERIES_WIDTH
  assert(bytes.byteLength === expectedValueCount * 2, 'encoded snapshot series length is invalid')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const series = {}
  let index = 0
  for (const code of SERIES_CODES) {
    const values = []
    for (let offset = 0; offset < monthCount * SERIES_WIDTH; offset += 1) {
      const encoded = view.getInt16(index * 2, true)
      values.push(encoded === NULL_SENTINEL ? null : encoded / scale)
      index += 1
    }
    series[code] = values
  }
  return series
}

function decodeSnapshot(snapshot) {
  assert(snapshot?.seriesEncoding === 'int16-base64-v1', 'snapshot encoding is unsupported')
  assert(Number.isInteger(snapshot.seriesScale) && snapshot.seriesScale > 0, 'snapshot series scale is invalid')
  assert(Array.isArray(snapshot.months) && snapshot.months.length > 0, 'snapshot months are invalid')
  assert(snapshot.encodedSeries && typeof snapshot.encodedSeries === 'object', 'snapshot encoded series are invalid')

  const series = {}
  for (const cityId of snapshot.cityIds || []) series[cityId] = decodeCitySeries(snapshot.encodedSeries[cityId], snapshot.months.length, snapshot.seriesScale)
  const { seriesEncoding, seriesScale, encodedSeries, ...decoded } = snapshot
  return { ...decoded, series }
}

module.exports = { decodeSnapshot, decodeCitySeries }
