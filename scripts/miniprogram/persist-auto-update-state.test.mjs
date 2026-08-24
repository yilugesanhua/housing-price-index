import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { persistStateForFailure, sourceEvidencePaths } from './persist-auto-update-state.mjs'
import { buildReleaseKey } from './auto-update-state.mjs'

const execFileAsync = promisify(execFile)

test('persists only the exact raw evidence and durable state paths', () => {
  const paths = sourceEvidencePaths({ dataset_as_of: '2026-07', source_raw_sha256: 'a'.repeat(64) })
  assert.deepEqual(paths, [
    'data/releases/auto-update-state.json',
    `data/raw/2026-07/${'a'.repeat(64)}.batch.json`,
    `data/raw/2026-07/${'a'.repeat(64)}.html.gz`,
  ])
})

test('rejects incomplete source identity before staging anything', () => {
  assert.throws(() => sourceEvidencePaths({ dataset_as_of: '2026-07', source_raw_sha256: 'bad' }), /valid source identity/)
})

test('failure persistence stages only source evidence and a failed durable state', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'housing-data-persist-state-'))
  try {
    await execFileAsync('git', ['init', '-q'], { cwd: rootPath })
    const sourceRawSha256 = 'b'.repeat(64)
    const state = {
      format: 'housing-data-auto-update-state-v1',
      status: 'preparing',
      dataset_as_of: '2026-07',
      source_raw_sha256: sourceRawSha256,
      release_key: buildReleaseKey('2026-07', sourceRawSha256),
      official_url: 'https://www.stats.gov.cn/example.html',
      time_seed: '2026-07-15T00:00:00.000Z',
      next_check_at: '2026-07-15T00:10:00.000Z',
      updated_at: '2026-07-15T00:00:00.000Z',
    }
    const evidence = sourceEvidencePaths(state)
    await mkdir(join(rootPath, 'data/releases'), { recursive: true })
    await mkdir(join(rootPath, 'data/raw/2026-07'), { recursive: true })
    await writeFile(join(rootPath, evidence[0]), `${JSON.stringify(state)}\n`)
    await writeFile(join(rootPath, evidence[1]), `${JSON.stringify({ source_batch: { stat_month: '2026-07', raw_content_sha256: sourceRawSha256 } })}\n`)
    await writeFile(join(rootPath, evidence[2]), 'official source bytes')
    await writeFile(join(rootPath, 'apps-web-generated.txt'), 'must not be staged')

    const result = await persistStateForFailure({
      rootPath,
      stateFile: join(rootPath, evidence[0]),
      message: 'injected failure',
    })
    assert.equal(result.persisted, true)
    assert.equal(result.status, 'failed')
    const stateAfter = JSON.parse(await readFile(join(rootPath, evidence[0]), 'utf8'))
    assert.equal(stateAfter.status, 'failed')
    assert.equal(stateAfter.error, 'injected failure')
    const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: rootPath, encoding: 'utf8' })
    assert.deepEqual(stdout.trim().split(/\r?\n/).sort(), evidence.slice().sort())
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
