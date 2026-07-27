import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { readRollbackEligibleAudit, rollbackVersionOrNull } from './release-audit-lib.mjs'

const VERSION = '2026-06-0123456789ab'
const ENV_ID = 'cloud1-test'

async function fixture({ correction = null, cloudEnvId = ENV_ID } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'housing-release-audit-'))
  const releaseDir = resolve(root, 'data/releases')
  await mkdir(releaseDir, { recursive: true })
  await writeFile(resolve(releaseDir, `${VERSION}.json`), JSON.stringify({
    status: 'published',
    dataset_version: VERSION,
    cloud_env_id: cloudEnvId,
  }))
  if (correction) await writeFile(resolve(releaseDir, `${VERSION}.correction.json`), JSON.stringify(correction))
  return root
}

test('accepts a published release with no disabling correction', async () => {
  const root = await fixture()
  const audit = await readRollbackEligibleAudit(root, VERSION, ENV_ID)
  assert.equal(audit.dataset_version, VERSION)
  assert.equal(await rollbackVersionOrNull(root, VERSION, ENV_ID), VERSION)
})

test('rejects a release explicitly disabled by a correction record', async () => {
  const root = await fixture({ correction: {
    dataset_version: VERSION,
    rollback_allowed: false,
    reason: 'invalid cloud pointer',
  } })
  await assert.rejects(readRollbackEligibleAudit(root, VERSION, ENV_ID), /not eligible for rollback/)
  assert.equal(await rollbackVersionOrNull(root, VERSION, ENV_ID), null)
})

test('rejects releases from another cloud environment and malformed corrections', async () => {
  const wrongEnvironmentRoot = await fixture({ cloudEnvId: 'cloud1-other' })
  await assert.rejects(readRollbackEligibleAudit(wrongEnvironmentRoot, VERSION, ENV_ID), /requested cloud environment/)

  const malformedCorrectionRoot = await fixture({ correction: {
    dataset_version: '2026-06-ffffffffffff',
    rollback_allowed: false,
  } })
  await assert.rejects(readRollbackEligibleAudit(malformedCorrectionRoot, VERSION, ENV_ID), /malformed correction record/)
})
