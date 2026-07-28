import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { byteLength, sha256, verifyReleaseAgainstSnapshot, verifyReleaseIntegrity } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const snapshot = require(resolve(root, 'apps/miniprogram/data/snapshot.js'))
const explicitDir = process.argv.find((argument) => argument.startsWith('--dir='))?.slice('--dir='.length)
const integrityOnly = process.argv.includes('--integrity-only')
const latest = explicitDir ? null : JSON.parse(await readFile(resolve(root, 'work/miniprogram-data/latest-candidate.json'), 'utf8'))
const inputRoot = resolve(root, explicitDir || `work/miniprogram-data/${latest.dataset_version}`)
const bootstrapText = await readFile(resolve(inputRoot, 'bootstrap.json'), 'utf8')
const manifestText = await readFile(resolve(inputRoot, 'manifest.json'), 'utf8')
const currentText = await readFile(resolve(inputRoot, 'current.candidate.json'), 'utf8')
const bootstrap = JSON.parse(bootstrapText)
const manifest = JSON.parse(manifestText)
const current = JSON.parse(currentText)
const cities = Object.fromEntries(await Promise.all(snapshot.cityIds.map(async (cityId) => {
  const text = await readFile(resolve(inputRoot, 'cities', `${cityId}.json`), 'utf8')
  return [cityId, { data: JSON.parse(text), text, sha256: sha256(text), bytes: byteLength(text), fileId: manifest.city_file_id_template?.replace('{city_id}', cityId) }]
})))
const totalBytes = byteLength(bootstrapText) + byteLength(manifestText) + Object.values(cities).reduce((sum, item) => sum + item.bytes, 0)
const release = { bootstrap, bootstrapText, manifest, manifestText, current, currentText, cities, totalBytes }
const errors = integrityOnly ? verifyReleaseIntegrity(release) : verifyReleaseAgainstSnapshot(snapshot, release)
if (errors.length) {
  console.error('Remote release verification failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  const scope = integrityOnly ? 'self-consistent full release reconstruction' : 'exact snapshot reconstruction'
  console.log(`Verified ${manifest.dataset_version}: 70 city shards, ${totalBytes} bytes, ${scope} passed`)
}
