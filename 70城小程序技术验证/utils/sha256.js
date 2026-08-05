const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function utf8Bytes(value) {
  const bytes = []
  for (const character of String(value)) {
    const code = character.codePointAt(0)
    if (code <= 0x7f) bytes.push(code)
    else if (code <= 0x7ff) bytes.push(0xc0 | code >>> 6, 0x80 | code & 0x3f)
    else if (code <= 0xffff) bytes.push(0xe0 | code >>> 12, 0x80 | code >>> 6 & 0x3f, 0x80 | code & 0x3f)
    else bytes.push(0xf0 | code >>> 18, 0x80 | code >>> 12 & 0x3f, 0x80 | code >>> 6 & 0x3f, 0x80 | code & 0x3f)
  }
  return new Uint8Array(bytes)
}

function inputBytes(value) {
  if (typeof value === 'string') return utf8Bytes(value)
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (value && value.buffer instanceof ArrayBuffer) return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength)
  throw new TypeError('sha256 input must be a string, ArrayBuffer, or Uint8Array')
}

function rotateRight(value, count) {
  return value >>> count | value << 32 - count
}

function toHex(value) {
  return (value >>> 0).toString(16).padStart(8, '0')
}

function processBlock(bytes, offset, hash, words) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
  for (let index = 16; index < 64; index += 1) {
    const left = words[index - 15]
    const right = words[index - 2]
    const small0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ left >>> 3
    const small1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ right >>> 10
    words[index] = words[index - 16] + small0 + words[index - 7] + small1 >>> 0
  }
  let [a, b, c, d, e, f, g, h] = hash
  for (let index = 0; index < 64; index += 1) {
    const big1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
    const choice = e & f ^ ~e & g
    const first = h + big1 + choice + K[index] + words[index] >>> 0
    const big0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
    const majority = a & b ^ a & c ^ b & c
    const second = big0 + majority >>> 0
    h = g; g = f; f = e; e = d + first >>> 0; d = c; c = b; b = a; a = first + second >>> 0
  }
  hash[0] = hash[0] + a >>> 0
  hash[1] = hash[1] + b >>> 0
  hash[2] = hash[2] + c >>> 0
  hash[3] = hash[3] + d >>> 0
  hash[4] = hash[4] + e >>> 0
  hash[5] = hash[5] + f >>> 0
  hash[6] = hash[6] + g >>> 0
  hash[7] = hash[7] + h >>> 0
}

function createSha256() {
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const words = new Uint32Array(64)
  const tail = new Uint8Array(64)
  let tailLength = 0
  let totalLength = 0

  function update(value) {
    const source = inputBytes(value)
    totalLength += source.length
    let offset = 0
    if (tailLength) {
      const copied = Math.min(64 - tailLength, source.length)
      tail.set(source.subarray(0, copied), tailLength)
      tailLength += copied
      offset += copied
      if (tailLength === 64) {
        processBlock(tail, 0, hash, words)
        tailLength = 0
      }
    }
    while (offset + 64 <= source.length) {
      processBlock(source, offset, hash, words)
      offset += 64
    }
    if (offset < source.length) {
      tail.set(source.subarray(offset), 0)
      tailLength = source.length - offset
    }
    return api
  }

  function digest() {
    const paddedLength = tailLength < 56 ? 64 : 128
    const finalBytes = new Uint8Array(paddedLength)
    finalBytes.set(tail.subarray(0, tailLength))
    finalBytes[tailLength] = 0x80
    const bitLength = totalLength * 8
    const view = new DataView(finalBytes.buffer)
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
    view.setUint32(paddedLength - 4, bitLength >>> 0, false)
    for (let offset = 0; offset < finalBytes.length; offset += 64) processBlock(finalBytes, offset, hash, words)
    return hash.map(toHex).join('')
  }

  const api = Object.freeze({ update, digest })
  return api
}

function sha256(value) {
  return createSha256().update(value).digest()
}

async function sha256Async(value, { chunkBytes = 64 * 1024, yieldFn = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {}) {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 64) throw new TypeError('sha256Async chunkBytes must be an integer of at least 64')
  if (typeof yieldFn !== 'function') throw new TypeError('sha256Async yieldFn must be a function')
  const source = inputBytes(value)
  const hash = createSha256()
  for (let offset = 0; offset < source.length; offset += chunkBytes) {
    hash.update(source.subarray(offset, Math.min(offset + chunkBytes, source.length)))
    if (offset + chunkBytes < source.length) await yieldFn()
  }
  return hash.digest()
}

module.exports = { sha256, sha256Async, utf8Bytes }
