import { createHash } from 'node:crypto'
import { validateOfficialReleaseUrl } from './official-source-url.mjs'

export const OFFICIAL_SOURCE_MAX_ATTEMPTS = 3
export const OFFICIAL_SOURCE_TIMEOUT_MS = 30_000
const RETRY_BACKOFF_MS = 1_000
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const RETRYABLE_NETWORK_CODES = new Set(['ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT'])

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function retryableFailure(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.retryableOfficialSourceFailure = true
  return error
}

function isRetryableNetworkFailure(error) {
  const code = String(error?.code || error?.cause?.code || '')
  return error?.name === 'AbortError'
    || error?.name === 'TimeoutError'
    || RETRYABLE_NETWORK_CODES.has(code)
}

function isRetryableFailure(error) {
  return error?.retryableOfficialSourceFailure === true || isRetryableNetworkFailure(error)
}

export async function verifyOfficialSource({
  sourceUrl,
  expectedHash,
  fetchImpl = globalThis.fetch,
  maxAttempts = OFFICIAL_SOURCE_MAX_ATTEMPTS,
  timeoutMs = OFFICIAL_SOURCE_TIMEOUT_MS,
  sleep = wait,
}) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) throw new Error('Use --sha256=<official raw hash>')
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('Official source max attempts must be a positive integer')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('Official source timeout must be a positive integer')

  const url = validateOfficialReleaseUrl(sourceUrl)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'HousingPriceIndexBot/0.1 (+automated source verification)' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        const message = `Official source returned HTTP ${response.status}`
        throw RETRYABLE_HTTP_STATUS.has(response.status) ? retryableFailure(message) : new Error(message)
      }

      const finalUrl = new URL(response.url)
      validateOfficialReleaseUrl(finalUrl.href)
      const body = Buffer.from(await response.arrayBuffer())
      const actualHash = createHash('sha256').update(body).digest('hex')
      if (actualHash !== expectedHash) throw new Error(`Official source hash changed: expected ${expectedHash}, got ${actualHash}`)

      return {
        status: 'passed',
        source_url: sourceUrl,
        final_url: response.url,
        http_status: response.status,
        raw_content_sha256: actualHash,
        bytes: body.byteLength,
        attempt_count: attempt,
        verified_at: new Date().toISOString(),
      }
    } catch (error) {
      if (!isRetryableFailure(error) || attempt === maxAttempts) {
        if (attempt === maxAttempts && isRetryableFailure(error)) {
          throw new Error(`Official source remained unavailable after ${maxAttempts} attempts: ${error.message}`, { cause: error })
        }
        throw error
      }
      await sleep(RETRY_BACKOFF_MS * attempt)
    }
  }
  throw new Error('Official source verification reached an unreachable state')
}
