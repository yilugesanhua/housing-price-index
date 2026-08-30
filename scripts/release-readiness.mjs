import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SHA256 = /^[a-f0-9]{64}$/
const COMMIT_SHA = /^[a-f0-9]{40}$/

export const REQUIRED_ATTESTATIONS = Object.freeze([
  'android_wechat', 'iphone_wechat', 'chrome_current', 'chrome_previous',
  'edge_current', 'edge_previous', 'safari_current', 'safari_previous', 'legal_review',
])

function sha256(value) { return createHash('sha256').update(value).digest('hex') }
function canonicalJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
function canonicalIso(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value }
function hasText(value) { return typeof value === 'string' && value.trim().length > 0 }

export function normalizePublicOrigin(value) {
  if (!value) throw new Error('VITE_PUBLIC_SITE_URL is required')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) throw new Error('VITE_PUBLIC_SITE_URL must be an HTTPS origin without a path, query, or hash')
  return url.origin
}

export function validateContactUrl(value) {
  if (!value) throw new Error('VITE_CONTACT_URL is required')
  const url = new URL(value)
  if (url.protocol === 'mailto:' && !url.pathname.includes('@')) throw new Error('mailto contact must contain an email address')
  if (url.protocol !== 'mailto:' && url.protocol !== 'https:') throw new Error('VITE_CONTACT_URL must use https: or mailto:')
  return value
}

export function buildManifestSha256(entries) {
  const lines = [...entries].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))
    .map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join('')
  return sha256(Buffer.from(lines, 'utf8'))
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(current, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(root, path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

export async function collectBuildManifest(root) {
  const dist = resolve(root, 'apps', 'web', 'dist')
  const entries = await Promise.all((await listFiles(dist)).map(async (path) => {
    const bytes = await readFile(path)
    return { path: relative(dist, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes) }
  }))
  return { entries, sha256: buildManifestSha256(entries) }
}

export function evidenceBundleSha256(bundle) {
  return sha256(Buffer.from(canonicalJson({
    ...bundle,
    evidence_bundle_sha256: '',
    entries: [...(bundle.entries || [])].map((entry) => ({ ...entry })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
  }), 'utf8'))
}

function validationBindingErrors(value, binding) {
  const errors = []
  if (!hasText(value.release_id)) errors.push('release_id is required')
  if (!COMMIT_SHA.test(value.source_commit_sha || '')) errors.push('source_commit_sha must be a full lowercase commit SHA')
  if (!SHA256.test(value.build_manifest_sha256 || '')) errors.push('build_manifest_sha256 must be a lowercase SHA-256')
  if (!hasText(value.dataset_version)) errors.push('dataset_version is required')
  if (!SHA256.test(value.dataset_manifest_sha256 || '')) errors.push('dataset_manifest_sha256 must be a lowercase SHA-256')
  if (!hasText(value.public_origin)) errors.push('public_origin is required')
  if (!SHA256.test(value.evidence_bundle_sha256 || '')) errors.push('evidence_bundle_sha256 must be a lowercase SHA-256')
  if (binding) for (const field of ['source_commit_sha', 'build_manifest_sha256', 'dataset_version', 'dataset_manifest_sha256', 'public_origin']) {
    if (value[field] && value[field] !== binding[field]) errors.push(`${field} differs from this release build`)
  }
  return errors
}

export function validateEvidenceBundle(bundle, declaration, { now = new Date() } = {}) {
  const errors = []
  if (!bundle || typeof bundle !== 'object' || bundle.schema_version !== 1 || !Array.isArray(bundle.entries)) return { errors: ['release evidence bundle schema_version must be 1'], entries: new Map() }
  if (bundle.evidence_bundle_sha256 !== evidenceBundleSha256(bundle)) errors.push('evidence bundle hash is invalid')
  for (const field of ['release_id', 'source_commit_sha', 'build_manifest_sha256', 'dataset_version', 'dataset_manifest_sha256', 'public_origin']) {
    if (bundle[field] !== declaration[field]) errors.push(`evidence bundle ${field} differs from release declaration`)
  }
  const byId = new Map()
  for (const entry of bundle.entries) {
    if (!entry || typeof entry !== 'object' || !hasText(entry.id) || !/^[a-z0-9_]+$/.test(entry.id)) { errors.push('evidence bundle entry ID is invalid'); continue }
    if (byId.has(entry.id)) { errors.push(`evidence bundle entry is duplicated: ${entry.id}`); continue }
    byId.set(entry.id, entry)
    if (entry.result !== 'passed') errors.push(`${entry.id} evidence result must be passed`)
    for (const field of ['tester', 'device_or_os', 'version']) if (!hasText(entry[field])) errors.push(`${entry.id} ${field} is required`)
    if (!canonicalIso(entry.verified_at)) errors.push(`${entry.id} verified_at must be a canonical ISO timestamp`)
    else if (Date.parse(entry.verified_at) > now.getTime()) errors.push(`${entry.id} verified_at cannot be in the future`)
    if (!SHA256.test(entry.evidence_sha256 || '')) errors.push(`${entry.id} evidence_sha256 must be a lowercase SHA-256`)
  }
  for (const id of REQUIRED_ATTESTATIONS) if (!byId.has(id)) errors.push(`${id} evidence is missing`)
  return { errors, entries: byId }
}

export function validateAttestations(value, { binding = null, evidenceBundle = null, now = new Date() } = {}) {
  const errors = []
  if (!value || typeof value !== 'object' || value.schema_version !== 2) return ['release attestations schema_version must be 2']
  errors.push(...validationBindingErrors(value, binding))
  if (!canonicalIso(value.issued_at)) errors.push('issued_at must be a canonical ISO timestamp')
  if (!canonicalIso(value.expires_at)) errors.push('expires_at must be a canonical ISO timestamp')
  if (canonicalIso(value.issued_at) && canonicalIso(value.expires_at)) {
    if (Date.parse(value.issued_at) > now.getTime()) errors.push('issued_at cannot be in the future')
    if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) errors.push('expires_at must be later than issued_at')
    if (Date.parse(value.expires_at) <= now.getTime()) errors.push('release attestations have expired')
  }
  const bundleResult = validateEvidenceBundle(evidenceBundle, value, { now })
  errors.push(...bundleResult.errors)
  if (!value.attestations || typeof value.attestations !== 'object') return [...errors, 'attestations object is required']
  for (const id of REQUIRED_ATTESTATIONS) {
    const item = value.attestations[id]
    if (!item || typeof item !== 'object') { errors.push(`${id} attestation is missing`); continue }
    if (item.result !== 'passed') errors.push(`${id} attestation result must be passed`)
    if (item.evidence_id !== id || !bundleResult.entries.has(id)) errors.push(`${id} attestation does not bind its evidence entry`)
    const evidence = bundleResult.entries.get(id)
    if (evidence && item.evidence_sha256 !== evidence.evidence_sha256) errors.push(`${id} attestation evidence hash differs from its evidence entry`)
    if (evidence && canonicalIso(value.issued_at)) {
      const maxAgeDays = id === 'legal_review' ? 90 : 30
      if (Date.parse(evidence.verified_at) < Date.parse(value.issued_at) - maxAgeDays * 24 * 60 * 60 * 1000) errors.push(`${id} evidence exceeds its maximum validity period`)
    }
  }
  return errors
}

async function validateBuiltSite(root, origin, contactUrl) {
  const errors = []
  const dist = resolve(root, 'apps', 'web', 'dist')
  const html = await readFile(resolve(dist, 'index.html'), 'utf8')
  if (!html.includes(`property="og:url" content="${origin}/"`)) errors.push('built og:url is not the configured absolute HTTPS URL')
  if (!html.includes(`property="og:image" content="${origin}/share-card.png"`)) errors.push('built og:image is not the configured absolute HTTPS URL')
  if (!html.includes(`rel="canonical" href="${origin}/"`)) errors.push('built canonical URL is not the configured absolute HTTPS URL')
  const png = await readFile(resolve(dist, 'share-card.png'))
  if (png.length < 24 || png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) errors.push('share-card.png must be 1200x630')
  const scriptContents = await Promise.all((await readdir(resolve(dist, 'assets'))).filter((name) => name.endsWith('.js')).map((name) => readFile(resolve(dist, 'assets', name), 'utf8')))
  if (!scriptContents.some((content) => content.includes(contactUrl))) errors.push('built application does not contain the configured correction contact URL')
  const manifestText = await readFile(resolve(dist, 'data', 'manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestText)
  if (manifest.validation_status !== 'passed' || manifest.data_status !== 'current') errors.push('release data manifest must be passed and current')
  const buildManifest = await collectBuildManifest(root)
  return { errors, binding: {
    build_manifest_sha256: buildManifest.sha256,
    dataset_version: manifest.dataset_version,
    dataset_manifest_sha256: sha256(Buffer.from(manifestText, 'utf8')),
    public_origin: origin,
  } }
}

async function readGitCommit(root) {
  const [{ stdout }, { stdout: status }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }),
    execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }),
  ])
  const commit = stdout.trim()
  if (!COMMIT_SHA.test(commit)) throw new Error('current Git commit SHA is invalid')
  if (status.trim()) throw new Error('source working tree is not clean')
  return commit
}

export async function runReleaseReadiness({ root = process.cwd(), env = process.env, now = new Date() } = {}) {
  const errors = []
  if (env.VITE_APP_ENV !== 'public') errors.push('VITE_APP_ENV must be public for a release build')
  let origin; let contactUrl
  try { origin = normalizePublicOrigin(env.VITE_PUBLIC_SITE_URL) } catch (error) { errors.push(error.message) }
  try { contactUrl = validateContactUrl(env.VITE_CONTACT_URL) } catch (error) { errors.push(error.message) }
  let built
  if (origin && contactUrl) {
    try { built = await validateBuiltSite(root, origin, contactUrl); errors.push(...built.errors) } catch (error) { errors.push(`cannot validate built site: ${error.message}`) }
  }
  let commit
  try { commit = await readGitCommit(root) } catch (error) { errors.push(`cannot identify current source commit: ${error.message}`) }
  try {
    const [attestations, evidenceBundle] = await Promise.all([
      readFile(resolve(root, env.RELEASE_ATTESTATIONS_PATH || 'release/attestations.json'), 'utf8').then(JSON.parse),
      readFile(resolve(root, env.RELEASE_EVIDENCE_INDEX_PATH || 'release/evidence-index.json'), 'utf8').then(JSON.parse),
    ])
    errors.push(...validateAttestations(attestations, { binding: built && commit ? { ...built.binding, source_commit_sha: commit } : null, evidenceBundle, now }))
  } catch (error) {
    errors.push(`cannot read release declaration or evidence bundle: ${error.message}`)
  }
  return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = await runReleaseReadiness()
  if (errors.length > 0) {
    console.error('Release readiness failed:')
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else console.log('Release readiness passed: declaration, source commit, build identity, data identity, origin, evidence hashes, and expiry are all bound.')
}
