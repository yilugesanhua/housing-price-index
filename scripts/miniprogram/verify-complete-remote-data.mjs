import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { verifyCompleteRemoteRelease } from './complete-remote-data.mjs'

const root = resolve(import.meta.dirname, '../..')
const explicitDir = process.argv.find((argument) => argument.startsWith('--dir='))?.slice('--dir='.length)
const latest = explicitDir ? null : JSON.parse(await readFile(resolve(root, 'work/miniprogram-complete-data/latest-candidate.json'), 'utf8'))
const inputRoot = resolve(root, explicitDir || `work/miniprogram-complete-data/${latest.dataset_version}`)
const sourceSnapshot = JSON.parse(await readFile(resolve(root, 'work/miniprogram-data-input/complete-snapshot.json'), 'utf8'))
const completeSnapshotText = await readFile(resolve(inputRoot, 'complete-snapshot.json'), 'utf8')
const manifestText = await readFile(resolve(inputRoot, 'manifest.json'), 'utf8')
const currentText = await readFile(resolve(inputRoot, 'current.candidate.json'), 'utf8')
const release = {
  completeSnapshot: JSON.parse(completeSnapshotText),
  completeSnapshotText,
  manifest: JSON.parse(manifestText),
  manifestText,
  current: JSON.parse(currentText),
  currentText,
}
const errors = verifyCompleteRemoteRelease(sourceSnapshot, release)
if (errors.length) throw new Error(`Complete remote release verification failed:\n- ${errors.join('\n- ')}`)
console.log(`Verified ${release.manifest.dataset_version}: one complete ${release.manifest.month_count}-month data file, ${release.manifest.complete_snapshot_bytes} bytes`)
