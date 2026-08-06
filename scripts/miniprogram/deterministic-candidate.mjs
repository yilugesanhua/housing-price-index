import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const ZIP_LOCAL = 0x04034b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_END = 0x06054b50
const UTF8_FLAG = 0x0800
const DEFAULT_EXCLUDES = [
  /(^|\/)node_modules\//,
  /(^|\/)project\.private\.config\.json$/,
  /(^|\/)(?:logs?|screenshots?|coverage|tmp|temp)\//i,
  /(^|\/)(?:\.DS_Store|.*\.swp|.*~)$/,
]
const CANDIDATE_TOP_LEVEL_FILES = new Set(['app.js', 'app.json', 'app.wxss', 'package.json', 'project.config.json', 'sitemap.json'])
const CANDIDATE_TOP_LEVEL_DIRECTORIES = new Set(['assets', 'cloudfunctions', 'config', 'data', 'miniprogram_npm', 'pages', 'styles', 'utils'])
const DEVTOOLS_ALLOWED_EXTRA_FILES = new Set(['package-lock.json', 'project.private.config.json'])
const DEVTOOLS_ALLOWED_EXTRA_PREFIXES = ['node_modules/']

function fail(message) { throw new Error(`Deterministic candidate rejected: ${message}`) }

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function crc32(value) {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) fail(`invalid archive timestamp: ${value}`)
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()))
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  }
}

export function normalizeArchiveEntries(entries, { excludes = DEFAULT_EXCLUDES } = {}) {
  const normalized = []
  for (const entry of entries) {
    const path = String(entry.path).replaceAll('\\', '/')
    if (!path || path.startsWith('/') || path.includes('../') || path.includes('/./') || path.endsWith('/')) fail(`invalid archive path: ${path}`)
    if (excludes.some((pattern) => pattern.test(path))) continue
    if (!Buffer.isBuffer(entry.data)) fail(`archive entry is not a Buffer: ${path}`)
    normalized.push({ path, data: entry.data })
  }
  normalized.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)))
  for (let index = 1; index < normalized.length; index += 1) if (normalized[index - 1].path === normalized[index].path) fail(`duplicate archive path: ${normalized[index].path}`)
  if (normalized.length === 0) fail('archive contains no files')
  return normalized
}

export function assertCandidatePaths(entries) {
  for (const entry of entries) {
    const [topLevel, ...rest] = entry.path.split('/')
    const allowed = rest.length === 0 ? CANDIDATE_TOP_LEVEL_FILES.has(topLevel) : CANDIDATE_TOP_LEVEL_DIRECTORIES.has(topLevel)
    if (!allowed) fail(`file is outside the mini-program source whitelist: ${entry.path}`)
  }
  return entries
}

function u16(value) { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value); return buffer }
function u32(value) { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value); return buffer }

export function createDeterministicZip(entries, { timestamp }) {
  const files = normalizeArchiveEntries(entries)
  const dos = dosDateTime(timestamp)
  const local = []
  const central = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8')
    const compressed = deflateRawSync(file.data, { level: 9 })
    const method = compressed.length < file.data.length ? 8 : 0
    const payload = method === 8 ? compressed : file.data
    const crc = crc32(file.data)
    const header = Buffer.concat([
      u32(ZIP_LOCAL), u16(20), u16(UTF8_FLAG), u16(method), u16(dos.time), u16(dos.date),
      u32(crc), u32(payload.length), u32(file.data.length), u16(name.length), u16(0), name,
    ])
    local.push(header, payload)
    const centralHeader = Buffer.concat([
      u32(ZIP_CENTRAL), u16(20), u16(20), u16(UTF8_FLAG), u16(method), u16(dos.time), u16(dos.date),
      u32(crc), u32(payload.length), u32(file.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ])
    central.push(centralHeader)
    offset += header.length + payload.length
  }
  const centralBytes = Buffer.concat(central)
  const end = Buffer.concat([u32(ZIP_END), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralBytes.length), u32(offset), u16(0)])
  return Buffer.concat([...local, centralBytes, end])
}

function findEnd(zip) {
  for (let index = zip.length - 22; index >= Math.max(0, zip.length - 65557); index -= 1) if (zip.readUInt32LE(index) === ZIP_END) return index
  fail('ZIP end record is missing')
}

export function readZipInventory(zip) {
  if (!Buffer.isBuffer(zip) || zip.length < 22) fail('ZIP is empty or truncated')
  const end = findEnd(zip)
  const count = zip.readUInt16LE(end + 10)
  const centralSize = zip.readUInt32LE(end + 12)
  const centralOffset = zip.readUInt32LE(end + 16)
  if (centralOffset + centralSize > end) fail('ZIP central directory exceeds archive')
  const files = []
  const seen = new Set()
  let cursor = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== ZIP_CENTRAL) fail('ZIP central directory entry is invalid')
    const flags = zip.readUInt16LE(cursor + 8)
    const method = zip.readUInt16LE(cursor + 10)
    const crc = zip.readUInt32LE(cursor + 16)
    const compressedSize = zip.readUInt32LE(cursor + 20)
    const size = zip.readUInt32LE(cursor + 24)
    const nameLength = zip.readUInt16LE(cursor + 28)
    const extraLength = zip.readUInt16LE(cursor + 30)
    const commentLength = zip.readUInt16LE(cursor + 32)
    const localOffset = zip.readUInt32LE(cursor + 42)
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString((flags & UTF8_FLAG) ? 'utf8' : 'ascii')
    if (!name || name.startsWith('/') || name.includes('../') || name.includes('\\') || seen.has(name)) fail(`ZIP entry path is unsafe or duplicated: ${name}`)
    seen.add(name)
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== ZIP_LOCAL) fail(`ZIP local entry is invalid: ${name}`)
    const localNameLength = zip.readUInt16LE(localOffset + 26)
    const localExtraLength = zip.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > zip.length) fail(`ZIP entry is truncated: ${name}`)
    const compressed = zip.subarray(dataStart, dataEnd)
    let data
    if (method === 0) data = Buffer.from(compressed)
    else if (method === 8) data = inflateRawSync(compressed)
    else fail(`ZIP compression method is unsupported: ${method}`)
    if (data.length !== size || crc32(data) !== crc) fail(`ZIP entry checksum mismatch: ${name}`)
    files.push({ path: name, size: data.length, sha256: sha256(data), data })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (cursor !== centralOffset + centralSize) fail('ZIP central directory has trailing bytes')
  return files
}

export function inventoryDigest(files) {
  const normalized = [...files].sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)))
  const lines = normalized.map((file) => `${file.path}\0${file.size}\0${file.sha256}\n`).join('')
  return sha256(Buffer.from(lines, 'utf8'))
}

function candidateManifestBytes(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export function buildCandidateManifest({ appVersion, sourceCommitSha, sourceCommitTime, archiveFile, archiveSha256, archiveInventorySha256, snapshot, parserVersion, auditVersion, createdAt = '1970-01-01T00:00:00.000Z' }) {
  const manifest = {
    schema_version: 1,
    candidate_id: `${appVersion}+${sourceCommitSha}+${archiveSha256}`,
    candidate_manifest_sha256: '',
    app_version: appVersion,
    source_commit_sha: sourceCommitSha,
    source_commit_time: sourceCommitTime,
    archive_file: archiveFile,
    archive_sha256: archiveSha256,
    archive_inventory_sha256: archiveInventorySha256,
    dataset_as_of: snapshot.datasetAsOf,
    source_dataset_version: snapshot.datasetVersion,
    bundled_snapshot_sha256: sha256(Buffer.from(snapshot.rawText, 'utf8')),
    parser_version: parserVersion,
    audit_version: auditVersion,
    created_at: createdAt,
  }
  manifest.candidate_manifest_sha256 = sha256(candidateManifestBytes(manifest))
  return manifest
}

export async function parseGitEntries(root, sourceCommitSha) {
  const { stdout } = await execFileAsync('git', ['ls-tree', '-r', '-z', sourceCommitSha, '--', 'apps/miniprogram'], { cwd: root, encoding: 'buffer' })
  return Promise.all(stdout.toString('utf8').split('\0').filter(Boolean).map(async (entry) => {
    const tab = entry.indexOf('\t')
    const header = entry.slice(0, tab).split(' ')
    const path = entry.slice(tab + 1)
    if (header[1] !== 'blob') return null
    const { stdout: data } = await execFileAsync('git', ['show', `${sourceCommitSha}:${path}`], { cwd: root, encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 })
    return { path: path.slice('apps/miniprogram/'.length), data }
  })).then((items) => assertCandidatePaths(normalizeArchiveEntries(items.filter(Boolean))))
}

async function gitValue(root, args) {
  const { stdout } = await execFileAsync('git', args, { cwd: root, encoding: 'utf8' })
  return stdout.trim()
}

async function assertClean(root) {
  const status = await gitValue(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status) fail('working tree must be clean before candidate generation')
}

async function listFiles(rootPath, directory = rootPath) {
  const files = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name)
    if (item.isDirectory()) files.push(...await listFiles(rootPath, path))
    else if (item.isFile()) files.push(relative(rootPath, path).replaceAll('\\', '/'))
  }
  return files
}

export async function compareDevtools(root, entries, devtoolsRoot) {
  const rootPath = resolve(root, devtoolsRoot)
  const expectedPaths = new Set(entries.map((entry) => entry.path))
  const extraPaths = (await listFiles(rootPath)).filter((path) => !expectedPaths.has(path))
  const unexpectedPaths = extraPaths.filter((path) => !DEVTOOLS_ALLOWED_EXTRA_FILES.has(path) && !DEVTOOLS_ALLOWED_EXTRA_PREFIXES.some((prefix) => path.startsWith(prefix)))
  if (unexpectedPaths.length > 0) fail(`developer tools directory contains unexpected files: ${unexpectedPaths.sort().join(', ')}`)
  for (const entry of entries) {
    const target = resolve(rootPath, entry.path)
    const targetRelative = relative(rootPath, target)
    if (targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) fail(`invalid developer tools target: ${entry.path}`)
    let actual
    try { actual = await readFile(target) } catch { fail(`developer tools file is missing: ${entry.path}`) }
    const isText = !entry.data.includes(0) && !actual.includes(0)
    const canonical = (value) => {
      if (!isText) return value
      const text = value.toString('utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
      if (entry.path === 'project.config.json') {
        try { return Buffer.from(`${JSON.stringify(JSON.parse(text))}\n`, 'utf8') } catch { fail(`developer tools JSON is invalid: ${entry.path}`) }
      }
      return Buffer.from(text, 'utf8')
    }
    if (!canonical(actual).equals(canonical(entry.data))) fail(`developer tools file differs: ${entry.path}`)
  }
}

export function parseSnapshot(rawText) {
  const generatedHeader = '(?:\\/\\/ Generated by npm run miniprogram:data\\. Do not edit\\.\\r?\\n)?'
  const plainExport = rawText.match(new RegExp(`^${generatedHeader}module\\.exports\\s*=\\s*(\\{[\\s\\S]*\\})\\s*;?\\s*$`))
  const compressedExport = rawText.match(new RegExp(`^${generatedHeader}module\\.exports\\s*=\\s*require\\((['"])\\.\\.\\/utils\\/snapshot-codec\\.js\\1\\)\\.decodeSnapshot\\((\\{[\\s\\S]*\\})\\)\\s*;?\\s*$`))
  const jsonText = plainExport?.[1] ?? compressedExport?.[2]
  if (!jsonText) fail('snapshot.js does not contain an approved JSON export')
  try { return { ...JSON.parse(jsonText), rawText } } catch (error) { fail(`snapshot.js is invalid JSON: ${error.message}`) }
}

export async function generateCandidate({ root = process.cwd(), sourceCommitSha, output = 'work/miniprogram-release-candidates', devtools = '70城小程序技术验证', createdAt }) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommitSha || '')) fail('source commit SHA must be a full 40-character lowercase SHA')
  await assertClean(root)
  const entries = await parseGitEntries(root, sourceCommitSha)
  await compareDevtools(root, entries, devtools)
  const sourceVersionText = (await execFileAsync('git', ['show', `${sourceCommitSha}:apps/miniprogram/config/version.js`], { cwd: root, encoding: 'utf8' })).stdout
  const version = sourceVersionText.match(/version:\s*['"](v\d+\.\d+\.\d+)['"]/)?.[1]
  if (!version) fail('version.js does not contain a semantic vX.Y.Z version')
  const sourceCommitTime = await gitValue(root, ['show', '-s', '--format=%cI', sourceCommitSha])
  const candidateCreatedAt = createdAt ?? sourceCommitTime
  const snapshotText = (await execFileAsync('git', ['show', `${sourceCommitSha}:apps/miniprogram/data/snapshot.js`], { cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })).stdout
  const snapshot = parseSnapshot(snapshotText)
  const auditText = (await execFileAsync('git', ['show', `${sourceCommitSha}:data/audit-report.json`], { cwd: root, encoding: 'utf8' })).stdout
  let audit
  try { audit = JSON.parse(auditText) } catch (error) { fail(`audit-report.json is invalid JSON: ${error.message}`) }
  if (audit.result !== 'passed' || typeof audit.audit_version !== 'string' || !audit.audit_version) fail('data/audit-report.json is not a passed machine-readable audit')
  const batchPaths = (await execFileAsync('git', ['ls-tree', '-r', '--name-only', sourceCommitSha, '--', `data/raw/${snapshot.datasetAsOf}`], { cwd: root, encoding: 'utf8' })).stdout.split(/\r?\n/).filter((path) => path.endsWith('.batch.json'))
  if (batchPaths.length === 0) fail(`no source batch found for ${snapshot.datasetAsOf}`)
  let batch
  try { batch = JSON.parse((await execFileAsync('git', ['show', `${sourceCommitSha}:${batchPaths[0]}`], { cwd: root, encoding: 'utf8' })).stdout) } catch (error) { fail(`source batch is invalid JSON: ${error.message}`) }
  const parserVersion = batch.source_batch?.parser_version || batch.parser_version
  if (typeof parserVersion !== 'string' || !parserVersion) fail('source batch has no parser_version')
  const auditVersion = audit.audit_version
  const archiveFile = `小程序源码-${version}.zip`
  const zip = createDeterministicZip(entries, { timestamp: sourceCommitTime })
  const inventory = readZipInventory(zip)
  const archiveInventorySha256 = inventoryDigest(inventory)
  const archiveSha256 = sha256(zip)
  const manifest = buildCandidateManifest({ appVersion: version, sourceCommitSha, sourceCommitTime, archiveFile, archiveSha256, archiveInventorySha256, snapshot, parserVersion, auditVersion, createdAt: candidateCreatedAt })
  const outputDir = resolve(root, output, `${version}-${sourceCommitSha.slice(0, 12)}-${archiveSha256.slice(0, 12)}`)
  try { await stat(outputDir); fail(`candidate output already exists: ${outputDir}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(outputDir, { recursive: true })
  await writeFile(resolve(outputDir, archiveFile), zip)
  await writeFile(resolve(outputDir, 'candidate-manifest.json'), candidateManifestBytes(manifest))
  await writeFile(resolve(outputDir, 'SHA256.txt'), `${archiveFile}  ${archiveSha256}\n`, 'utf8')
  return { outputDir, version, sourceCommitSha, archiveFile, archiveSha256, archiveInventorySha256, candidateId: manifest.candidate_id, fileCount: inventory.length }
}

if (process.argv[1]?.endsWith('deterministic-candidate.mjs')) {
  const root = resolve(import.meta.dirname, '../..')
  const commit = process.argv.find((value) => value.startsWith('--commit='))?.slice('--commit='.length) || await gitValue(root, ['rev-parse', 'HEAD'])
  const output = process.argv.find((value) => value.startsWith('--output='))?.slice('--output='.length) || 'work/miniprogram-release-candidates'
  const result = await generateCandidate({ root, sourceCommitSha: commit, output })
  console.log(JSON.stringify(result, null, 2))
}
