import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const APP_VERSION = /^v(\d+)\.(\d+)\.(\d+)$/
const COMMIT_SHA = /^[a-f0-9]{40}$/
const SHA256 = /^[a-f0-9]{64}$/

const CURRENT_SNAPSHOT_MARKERS = Object.freeze([
  {
    path: 'docs/DOCUMENT_INDEX.md',
    label: 'document index source-version snapshot',
    pattern: /截至本次整理其值为 `(v\d+\.\d+\.\d+)`/u,
  },
  {
    path: 'docs/DOCUMENT_INDEX.md',
    label: 'document index current-candidate snapshot',
    pattern: /当前 `(v\d+\.\d+\.\d+)` 是包含月度严格只读发现器/u,
  },
  {
    path: 'docs/IMPLEMENTATION_STATUS.md',
    label: 'implementation status source-version snapshot',
    pattern: /唯一源码版本为 `(v\d+\.\d+\.\d+)`/u,
  },
])

function fail(message) {
  throw new Error(`Mini-program version identity rejected: ${message}`)
}

function assertInsideRoot(root, input, label) {
  const resolved = resolve(root, input)
  const relativePath = relative(root, resolved)
  if (!relativePath || relativePath.startsWith('..') || /^[\\/]/.test(relativePath)) fail(`${label} must stay inside the repository`)
  return resolved
}

export function parseAppVersion(sourceText, label = 'version.js') {
  const version = sourceText.match(/version:\s*['"](v\d+\.\d+\.\d+)['"]/u)?.[1]
  if (!APP_VERSION.test(version || '')) fail(`${label} does not contain a semantic vX.Y.Z version`)
  return version
}

export async function readSourceVersion(root = process.cwd()) {
  return parseAppVersion(await readFile(resolve(root, 'apps/miniprogram/config/version.js'), 'utf8'))
}

function compareVersions(left, right) {
  const leftParts = left.match(APP_VERSION).slice(1).map(Number)
  const rightParts = right.match(APP_VERSION).slice(1).map(Number)
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

export function validateCurrentSnapshotText({ sourceVersion, documents }) {
  for (const marker of CURRENT_SNAPSHOT_MARKERS) {
    const text = documents[marker.path]
    if (typeof text !== 'string') fail(`cannot read ${marker.path}`)
    const matches = [...text.matchAll(new RegExp(marker.pattern.source, `${marker.pattern.flags.replace('g', '')}g`))]
    if (matches.length !== 1) fail(`${marker.label} must occur exactly once`)
    if (matches[0][1] !== sourceVersion) fail(`${marker.label} differs from apps/miniprogram/config/version.js`)
  }
}

function validateCandidateManifest(candidate, sourceVersion, label) {
  if (!candidate || candidate.schema_version !== 1 || candidate.app_version !== sourceVersion) fail(`${label} app_version differs from the source version`)
  if (!COMMIT_SHA.test(candidate.source_commit_sha || '') || !SHA256.test(candidate.archive_sha256 || '') || !SHA256.test(candidate.candidate_manifest_sha256 || '')) {
    fail(`${label} identity fields are invalid`)
  }
  if (candidate.candidate_id !== `${sourceVersion}+${candidate.source_commit_sha}+${candidate.archive_sha256}`) fail(`${label} candidate_id is invalid`)
  if (candidate.archive_file !== `小程序源码-${sourceVersion}.zip`) fail(`${label} archive filename differs from the source version`)
}

export function validateCandidateIdentity({ candidate, sourceVersion, releaseManifest = null, directoryName = null }) {
  validateCandidateManifest(candidate, sourceVersion, 'candidate manifest')
  if (!releaseManifest) return
  if (!directoryName || !directoryName.startsWith(`${sourceVersion}_`)) fail('stable archive directory does not start with the source version')
  if (releaseManifest.schema_version !== 1 || releaseManifest.app_version !== sourceVersion) fail('release manifest app_version differs from the source version')
  for (const field of ['candidate_id', 'candidate_manifest_sha256', 'source_commit_sha', 'archive_file', 'archive_sha256']) {
    if (releaseManifest[field] !== candidate[field]) fail(`release manifest differs from candidate ${field}`)
  }
}

export function assertClientChangeHasVersionBump({ baseVersion, sourceVersion, changedPaths }) {
  if (!APP_VERSION.test(baseVersion || '') || !APP_VERSION.test(sourceVersion || '')) fail('client version comparison is invalid')
  const changedClientFiles = changedPaths.filter((path) => path.startsWith('apps/miniprogram/') && path !== 'apps/miniprogram/config/version.js')
  if (changedClientFiles.length > 0 && compareVersions(sourceVersion, baseVersion) <= 0) {
    fail(`client files changed without a version increase from ${baseVersion}`)
  }
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    fail(`cannot read ${label}: ${error.message}`)
  }
}

async function validateGitVersionBump(root, base, sourceVersion) {
  if (!COMMIT_SHA.test(base || '')) fail('--base must be a full lowercase commit SHA')
  let baseVersionText
  let changedPathsText
  try {
    [baseVersionText, changedPathsText] = await Promise.all([
      execFileAsync('git', ['show', `${base}:apps/miniprogram/config/version.js`], { cwd: root, encoding: 'utf8' }).then(({ stdout }) => stdout),
      execFileAsync('git', ['diff', '--name-only', base, 'HEAD', '--', 'apps/miniprogram'], { cwd: root, encoding: 'utf8' }).then(({ stdout }) => stdout),
    ])
  } catch (error) {
    fail(`cannot compare the base commit: ${error.message}`)
  }
  assertClientChangeHasVersionBump({
    baseVersion: parseAppVersion(baseVersionText, 'base version.js'),
    sourceVersion,
    changedPaths: changedPathsText.split(/\r?\n/u).filter(Boolean),
  })
}

export async function validateVersionIdentity({ root = process.cwd(), candidateDir = null, releaseDir = null, base = null } = {}) {
  const sourceVersion = await readSourceVersion(root)
  const documents = Object.fromEntries(await Promise.all(
    [...new Set(CURRENT_SNAPSHOT_MARKERS.map((marker) => marker.path))].map(async (path) => [path, await readFile(resolve(root, path), 'utf8')]),
  ))
  validateCurrentSnapshotText({ sourceVersion, documents })

  if (candidateDir || releaseDir) {
    const effectiveCandidateDir = candidateDir ? assertInsideRoot(root, candidateDir, 'candidate directory') : assertInsideRoot(root, releaseDir, 'release directory')
    const candidate = await readJson(resolve(effectiveCandidateDir, 'candidate-manifest.json'), 'candidate manifest')
    const releaseManifest = releaseDir ? await readJson(resolve(assertInsideRoot(root, releaseDir, 'release directory'), 'release-manifest.json'), 'release manifest') : null
    validateCandidateIdentity({ candidate, sourceVersion, releaseManifest, directoryName: releaseDir ? relative(root, assertInsideRoot(root, releaseDir, 'release directory')).split(/[\\/]/u).at(-1) : null })
  }
  if (base) await validateGitVersionBump(root, base, sourceVersion)
  return { source_version: sourceVersion, candidate_checked: Boolean(candidateDir || releaseDir), base_checked: Boolean(base) }
}

function argument(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}

if (process.argv[1]?.endsWith('version-identity-gate.mjs')) {
  const root = resolve(import.meta.dirname, '../..')
  console.log(JSON.stringify(await validateVersionIdentity({
    root,
    candidateDir: argument('candidate'),
    releaseDir: argument('release'),
    base: argument('base'),
  })))
}
