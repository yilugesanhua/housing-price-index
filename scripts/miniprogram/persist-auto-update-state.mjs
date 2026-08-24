import { execFile } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { readState, transitionState, writeState } from './auto-update-state.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const statePath = resolve(root, 'data/releases/auto-update-state.json')
const errorMessage = process.argv.find((value) => value.startsWith('--error='))?.slice('--error='.length) || 'automatic update workflow interrupted'

export function sourceEvidencePaths(state) {
  if (!state || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(state.dataset_as_of || '') || !/^[a-f0-9]{64}$/.test(state.source_raw_sha256 || '')) {
    throw new Error('Automatic update state has no valid source identity')
  }
  const prefix = `data/raw/${state.dataset_as_of}/${state.source_raw_sha256}`
  return [
    'data/releases/auto-update-state.json',
    `${prefix}.batch.json`,
    `${prefix}.html.gz`,
  ]
}

async function assertSourceBatch(rootPath, state) {
  const batchPath = resolve(rootPath, sourceEvidencePaths(state)[1])
  const batch = JSON.parse(await readFile(batchPath, 'utf8'))
  if (batch.source_batch?.stat_month !== state.dataset_as_of || batch.source_batch?.raw_content_sha256 !== state.source_raw_sha256) {
    throw new Error('Automatic update source batch does not match durable state')
  }
  await access(resolve(rootPath, sourceEvidencePaths(state)[2]))
}

export async function persistStateForFailure({ rootPath = root, stateFile = statePath, message = errorMessage } = {}) {
  const state = await readState(stateFile)
  if (!state) return { persisted: false, reason: 'no-state' }
  const next = state.status === 'published'
    ? state
    : transitionState(state, 'failed', { error: message.slice(0, 1000), updated_at: new Date().toISOString() })
  if (next !== state) await writeState(stateFile, next)
  await assertSourceBatch(rootPath, next)
  const paths = sourceEvidencePaths(next)
  await execFileAsync('git', ['reset', '--'], { cwd: rootPath, encoding: 'utf8' })
  await execFileAsync('git', ['add', '--', ...paths], { cwd: rootPath, encoding: 'utf8' })
  return { persisted: true, status: next.status, dataset_as_of: next.dataset_as_of, release_key: next.release_key, paths }
}

if (process.argv[1]?.endsWith('persist-auto-update-state.mjs')) {
  console.log(JSON.stringify(await persistStateForFailure()))
}
