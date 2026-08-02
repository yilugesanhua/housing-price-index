import { createHash } from 'node:crypto'
import { validateOfficialReleaseUrl } from './official-source-url.mjs'

const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const sourceUrl = argument('url')
const expectedHash = argument('sha256')
if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) throw new Error('Use --sha256=<official raw hash>')
const url = validateOfficialReleaseUrl(sourceUrl)
const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'HousingPriceIndexBot/0.1 (+automated source verification)' }, signal: AbortSignal.timeout(30_000) })
if (!response.ok) throw new Error(`Official source returned HTTP ${response.status}`)
const finalUrl = new URL(response.url)
validateOfficialReleaseUrl(finalUrl.href)
const body = Buffer.from(await response.arrayBuffer())
const actualHash = createHash('sha256').update(body).digest('hex')
if (actualHash !== expectedHash) throw new Error(`Official source hash changed: expected ${expectedHash}, got ${actualHash}`)
console.log(JSON.stringify({ status: 'passed', source_url: sourceUrl, final_url: response.url, http_status: response.status, raw_content_sha256: actualHash, bytes: body.byteLength, verified_at: new Date().toISOString() }))
