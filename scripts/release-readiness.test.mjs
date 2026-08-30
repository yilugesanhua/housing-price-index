import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildManifestSha256, evidenceBundleSha256, normalizePublicOrigin, REQUIRED_ATTESTATIONS, validateAttestations, validateContactUrl } from './release-readiness.mjs'

const sourceCommit = 'a'.repeat(40)
const buildManifest = 'b'.repeat(64)
const datasetManifest = 'c'.repeat(64)
const releaseId = 'web-release-2026-08-30'
const now = new Date('2026-08-30T12:00:00.000Z')

function validRelease() {
  const binding = { source_commit_sha: sourceCommit, build_manifest_sha256: buildManifest, dataset_version: '2026-06-7231b82f3664', dataset_manifest_sha256: datasetManifest, public_origin: 'https://housing.example.com' }
  const entries = REQUIRED_ATTESTATIONS.map((id) => ({ id, result: 'passed', tester: 'fixture tester', device_or_os: id, version: 'fixture version', verified_at: '2026-08-20T12:00:00.000Z', evidence_sha256: 'd'.repeat(64) }))
  const evidenceBundle = { schema_version: 1, release_id: releaseId, ...binding, evidence_bundle_sha256: '', entries }
  evidenceBundle.evidence_bundle_sha256 = evidenceBundleSha256(evidenceBundle)
  const declaration = {
    schema_version: 2, release_id: releaseId, ...binding, evidence_bundle_sha256: evidenceBundle.evidence_bundle_sha256,
    issued_at: '2026-08-30T10:00:00.000Z', expires_at: '2026-09-19T10:00:00.000Z',
    attestations: Object.fromEntries(entries.map((entry) => [entry.id, { evidence_id: entry.id, evidence_sha256: entry.evidence_sha256, result: 'passed' }])),
  }
  return { binding, evidenceBundle, declaration }
}

test('accepts an HTTPS origin and safe correction contacts', () => {
  assert.equal(normalizePublicOrigin('https://housing.example.com'), 'https://housing.example.com')
  assert.equal(validateContactUrl('mailto:feedback@example.com'), 'mailto:feedback@example.com')
  assert.equal(validateContactUrl('https://housing.example.com/contact'), 'https://housing.example.com/contact')
})

test('rejects non-HTTPS site URLs and unsafe contacts', () => {
  assert.throws(() => normalizePublicOrigin('http://housing.example.com'), /HTTPS origin/)
  assert.throws(() => normalizePublicOrigin('https://housing.example.com/path'), /without a path/)
  assert.throws(() => validateContactUrl('javascript:alert(1)'), /https: or mailto:/)
  assert.throws(() => validateContactUrl('mailto:missing-address'), /email address/)
})

test('schema 2 accepts only a declaration bound to its build, data, origin, and evidence index', () => {
  const { binding, evidenceBundle, declaration } = validRelease()
  assert.deepEqual(validateAttestations(declaration, { binding, evidenceBundle, now }), [])
  assert.match(validateAttestations({ ...declaration, source_commit_sha: 'e'.repeat(40) }, { binding, evidenceBundle, now }).join('\n'), /source_commit_sha differs/)
  assert.match(validateAttestations({ ...declaration, build_manifest_sha256: 'e'.repeat(64) }, { binding, evidenceBundle, now }).join('\n'), /build_manifest_sha256 differs/)
  assert.match(validateAttestations({ ...declaration, dataset_version: '2026-07-other' }, { binding, evidenceBundle, now }).join('\n'), /dataset_version differs/)
  assert.match(validateAttestations({ ...declaration, dataset_manifest_sha256: 'e'.repeat(64) }, { binding, evidenceBundle, now }).join('\n'), /dataset_manifest_sha256 differs/)
  assert.match(validateAttestations({ ...declaration, public_origin: 'https://other.example.com' }, { binding, evidenceBundle, now }).join('\n'), /public_origin differs/)
})

test('build manifest identity changes for every built-file change', () => {
  const original = buildManifestSha256([{ path: 'assets/app.js', bytes: 3, sha256: 'a'.repeat(64) }])
  assert.notEqual(original, buildManifestSha256([{ path: 'assets/app.js', bytes: 4, sha256: 'a'.repeat(64) }]))
  assert.notEqual(original, buildManifestSha256([{ path: 'assets/app.js', bytes: 3, sha256: 'b'.repeat(64) }]))
})

test('schema 2 rejects altered evidence, expired records, and future timestamps', () => {
  const { binding, evidenceBundle, declaration } = validRelease()
  const tampered = { ...evidenceBundle, entries: evidenceBundle.entries.map((entry) => entry.id === 'android_wechat' ? { ...entry, evidence_sha256: 'e'.repeat(64) } : entry) }
  assert.match(validateAttestations(declaration, { binding, evidenceBundle: tampered, now }).join('\n'), /evidence bundle hash is invalid/)
  assert.match(validateAttestations({ ...declaration, expires_at: '2026-08-30T11:00:00.000Z' }, { binding, evidenceBundle, now }).join('\n'), /have expired/)
  const future = { ...evidenceBundle, entries: evidenceBundle.entries.map((entry) => entry.id === 'android_wechat' ? { ...entry, verified_at: '2026-09-01T12:00:00.000Z' } : entry) }
  future.evidence_bundle_sha256 = evidenceBundleSha256(future)
  assert.match(validateAttestations({ ...declaration, evidence_bundle_sha256: future.evidence_bundle_sha256 }, { binding, evidenceBundle: future, now }).join('\n'), /cannot be in the future/)
})
