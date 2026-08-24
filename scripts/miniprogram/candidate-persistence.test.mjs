import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCandidatePaths, validateCandidateRunId } from './candidate-persistence.mjs'

const valid = [
  'data/raw/2026-07/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.batch.json',
  'data/raw/2026-07/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html.gz',
  'data/releases/pending-auto-release.json',
  'data/releases/auto-update-state.json',
]

test('allows only raw source evidence and a pending state', () => {
  assert.deepEqual(validateCandidatePaths(valid, '2026-07'), [...valid].sort())
})

for (const path of ['scripts/data/publish.ts', '.github/workflows/ci.yml', 'apps/miniprogram/pages/home/index.js', 'package-lock.json', 'data/raw/2026-07/source.html', 'docs/screenshots/desktop-1440x900.png', 'data/audit-report.json', 'data/normalized/records.json', 'apps/web/public/data/manifest.json', 'apps/miniprogram/data/snapshot.js']) {
  test(`rejects non-generated candidate path ${path}`, () => {
    assert.throws(() => validateCandidatePaths([...valid, path], '2026-07'), /not allowlisted/)
  })
}

test('requires both compressed raw evidence files and durable state for the target month', () => {
  assert.throws(() => validateCandidatePaths(valid.filter((path) => !path.endsWith('.html.gz')), '2026-07'), /required generated artifacts/)
})

test('requires an immutable artifact run identifier for later recovery', () => {
  assert.equal(validateCandidateRunId(456), '456')
  for (const value of ['', ' 456', '456\n789', 'run-456', null]) {
    assert.throws(() => validateCandidateRunId(value), /candidate workflow run ID is invalid/)
  }
})
