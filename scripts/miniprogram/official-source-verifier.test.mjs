import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { verifyOfficialSource } from './official-source-verifier.mjs'

const officialUrl = 'https://www.stats.gov.cn/sj/zxfb/202607/t20260715_1964115.html'
const sourceBody = Buffer.from('<html><body>official source</body></html>')
const sourceHash = createHash('sha256').update(sourceBody).digest('hex')

function successResponse(body = sourceBody) {
  return {
    ok: true,
    status: 200,
    url: officialUrl,
    arrayBuffer: async () => body,
  }
}

test('official source verification retries a transient timeout and still hashes the final response', async () => {
  let calls = 0
  const waits = []
  const result = await verifyOfficialSource({
    sourceUrl: officialUrl,
    expectedHash: sourceHash,
    fetchImpl: async () => {
      calls += 1
      if (calls === 1) {
        const cause = Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })
        throw new Error('fetch failed', { cause })
      }
      return successResponse()
    },
    sleep: async (milliseconds) => waits.push(milliseconds),
  })

  assert.equal(calls, 2)
  assert.deepEqual(waits, [1_000])
  assert.equal(result.attempt_count, 2)
  assert.equal(result.raw_content_sha256, sourceHash)
})

test('official source verification retries a transient upstream HTTP failure', async () => {
  let calls = 0
  const result = await verifyOfficialSource({
    sourceUrl: officialUrl,
    expectedHash: sourceHash,
    fetchImpl: async () => {
      calls += 1
      return calls === 1
        ? { ok: false, status: 503, url: officialUrl, arrayBuffer: async () => sourceBody }
        : successResponse()
    },
    sleep: async () => {},
  })

  assert.equal(calls, 2)
  assert.equal(result.attempt_count, 2)
})

test('official source verification never retries a content hash mismatch', async () => {
  let calls = 0
  await assert.rejects(
    verifyOfficialSource({
      sourceUrl: officialUrl,
      expectedHash: sourceHash,
      fetchImpl: async () => {
        calls += 1
        return successResponse(Buffer.from('<html><body>changed</body></html>'))
      },
      sleep: async () => assert.fail('hash mismatches must not retry'),
    }),
    /Official source hash changed/,
  )
  assert.equal(calls, 1)
})
