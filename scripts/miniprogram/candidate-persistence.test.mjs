import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCandidatePaths } from './candidate-persistence.mjs'

const valid = [
  'data/raw/2026-07/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.batch.json',
  'data/raw/2026-07/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html.gz',
  'data/audit-report.json',
  'data/normalized/records.json',
  'apps/web/public/data/manifest.json',
  'apps/web/public/data/data.json',
  'apps/miniprogram/data/snapshot.js',
  'data/releases/pending-auto-release.json',
]

test('allows only generated source, normalized, public, snapshot, and pending files', () => {
  assert.deepEqual(validateCandidatePaths(valid, '2026-07'), [...valid].sort())
})

for (const path of ['scripts/data/publish.ts', '.github/workflows/ci.yml', 'apps/miniprogram/pages/home/index.js', 'package-lock.json', 'data/raw/2026-07/source.html', 'docs/screenshots/desktop-1440x900.png']) {
  test(`rejects non-generated candidate path ${path}`, () => {
    assert.throws(() => validateCandidatePaths([...valid, path], '2026-07'), /not allowlisted/)
  })
}

test('requires both compressed raw evidence and generated consumers for the target month', () => {
  assert.throws(() => validateCandidatePaths(valid.filter((path) => !path.endsWith('.html.gz')), '2026-07'), /required generated artifacts/)
})
