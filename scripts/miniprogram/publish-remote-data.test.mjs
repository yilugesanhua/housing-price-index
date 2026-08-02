import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./publish-remote-data.mjs', import.meta.url), 'utf8')

test('idempotent publication verifies the active revocation registry and unchanged pointer before audit recovery', () => {
  const start = source.indexOf('if (previous?.dataset_version === datasetVersion)')
  const end = source.indexOf("const current = JSON.parse(await readFile(resolve(localRoot, 'current.candidate.json')", start)
  assert.ok(start >= 0 && end > start)
  const block = source.slice(start, end)
  const loadRegistry = block.indexOf('await loadBaseRevocationRegistry')
  const rejectRevoked = block.indexOf('assertTargetNotRevoked(activeRegistry')
  const verifyFunction = block.indexOf("cloud.invokeFunction('getHousingDataManifest')")
  const verifyBaseline = block.indexOf("assertRemoteCurrentBaseline(previousCurrentText, 'idempotent recovery completion')")
  const writeAudit = block.indexOf('writeOrVerifyPublishAudit')
  assert.ok(loadRegistry >= 0 && rejectRevoked > loadRegistry)
  assert.ok(verifyFunction > rejectRevoked && verifyBaseline > verifyFunction && writeAudit > verifyBaseline)
})

test('production publication has no local interactive bypass and preserves local dry-run', () => {
  assert.match(source, /if \(!dryRun && !ciMode\) throw new Error\('Production publication is allowed only in an authorized GitHub Actions workflow; use --dry-run locally'\)/)
  assert.match(source, /const ciGate = dryRun \? null : await authorizeCiRelease/)
  assert.doesNotMatch(source, /createInterface|stdin\.isTTY|prompt\.question/)
})

test('candidate and automatic rollback writes verify their expected exact pointer baselines before upload', () => {
  const writerStart = source.indexOf('writePointer: async (text, label) =>')
  const writerEnd = source.indexOf('readPointerText:', writerStart)
  assert.ok(writerStart >= 0 && writerEnd > writerStart)
  const writer = source.slice(writerStart, writerEnd)
  const candidateCheck = writer.indexOf("assertRemoteCurrentBaseline(previousCurrentText, 'candidate activation')")
  const rollbackCheck = writer.indexOf("assertRemoteCurrentBaseline(confirmedCurrentText, 'automatic rollback')")
  const upload = writer.indexOf("cloud.uploadFile(path, 'housing-data/current.json')")
  assert.ok(candidateCheck >= 0 && rollbackCheck >= 0)
  assert.ok(upload > candidateCheck && upload > rollbackCheck)
})
