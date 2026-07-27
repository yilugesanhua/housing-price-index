import { execFile } from 'node:child_process'
import { glob, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { validateCandidateData } from './candidate-data-gate.mjs'
import { sha256 } from './remote-data-lib.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const discoveryGatePath = resolve(argument('discovery-gate') || 'work/auto-release/discovery-gate.json')
const calendarPath = resolve(argument('calendar') || 'work/monthly-data-check/release-calendar.json')
const outputRoot = resolve(root, 'work/auto-release')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

async function run(args) {
  const result = await execFileAsync(npm, args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: process.env })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
}

async function matchingBatch(month, officialUrl) {
  const matches = []
  for await (const path of await glob(`data/raw/${month}/*.batch.json`)) {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (parsed.source_batch.source_url === officialUrl || parsed.source_batch.final_url === officialUrl) matches.push({ path, parsed })
  }
  if (matches.length !== 1) throw new Error(`Expected one fetched source batch for ${month}; got ${matches.length}`)
  return matches[0]
}

await mkdir(outputRoot, { recursive: true })
const startedAt = new Date().toISOString()
try {
  const discoveryGate = JSON.parse(await readFile(discoveryGatePath, 'utf8'))
  if (discoveryGate.status !== 'passed') throw new Error('Discovery gate has not passed')
  if (!/^cloud[\w-]+$/.test(cloudEnvId)) throw new Error('Cloud environment ID is invalid')
  const previousPayload = JSON.parse(await readFile(resolve(root, 'apps/web/public/data/data.json'), 'utf8'))
  await run(['run', 'data:fetch', '--', discoveryGate.official_url])
  const fetched = await matchingBatch(discoveryGate.expected_stat_month, discoveryGate.official_url)
  await run(['run', 'data:audit', '--', fetched.path])
  await run(['run', 'data:audit', '--', '--report-only'])
  const verifiedBatch = JSON.parse(await readFile(fetched.path, 'utf8'))
  await run(['run', 'data:publish'])
  const candidatePayload = JSON.parse(await readFile(resolve(root, 'apps/web/public/data/data.json'), 'utf8'))
  const dataGate = validateCandidateData({ previousPayload, candidatePayload, expectedMonth: discoveryGate.expected_stat_month, sourceBatch: verifiedBatch.source_batch })
  await writeFile(resolve(outputRoot, 'data-gate.json'), `${JSON.stringify(dataGate, null, 2)}\n`, 'utf8')
  await run(['run', 'miniprogram:data'])
  await run(['run', 'miniprogram:data:stage', '--', `--calendar=${calendarPath}`, `--env=${cloudEnvId}`])
  await run(['run', 'miniprogram:data:verify-remote'])
  await run(['run', 'check'])
  await run(['run', 'test:e2e'])
  const latest = JSON.parse(await readFile(resolve(root, 'work/miniprogram-data/latest-candidate.json'), 'utf8'))
  const releaseReportPath = resolve(root, 'work/miniprogram-data', latest.dataset_version, 'release-report.json')
  const releaseReportText = await readFile(releaseReportPath, 'utf8')
  const releaseReport = JSON.parse(releaseReportText)
  if (releaseReport.dataset_as_of !== discoveryGate.expected_stat_month || releaseReport.cloud_env_id !== cloudEnvId) throw new Error('Staged release does not match the discovery gate')
  const gateReport = {
    format: 'housing-data-production-gate-v1',
    status: 'passed',
    cloud_env_id: cloudEnvId,
    dataset_version: latest.dataset_version,
    source_dataset_version: latest.source_dataset_version,
    dataset_as_of: releaseReport.dataset_as_of,
    official_url: discoveryGate.official_url,
    discovery_run_id: discoveryGate.discovery_run_id,
    discovery_commit_sha: discoveryGate.discovery_commit_sha,
    commit_sha: process.env.GITHUB_SHA || discoveryGate.discovery_commit_sha,
    idempotency_key: discoveryGate.idempotency_key,
    source_batch_id: dataGate.source_batch_id,
    source_raw_sha256: dataGate.source_raw_sha256,
    historical_revision_count: 0,
    added_record_count: dataGate.added_record_count,
    manifest_sha256: releaseReport.manifest_sha256,
    release_report_sha256: sha256(releaseReportText),
    checks: ['official-source-refetch', 'full-record-audit', 'zero-historical-mutation', '70-city-completeness', 'validate:data', 'check', 'test:e2e', 'test:miniprogram', 'remote-snapshot-reconstruction'],
    started_at: startedAt,
    passed_at: new Date().toISOString(),
  }
  await writeFile(resolve(outputRoot, 'gate-report.json'), `${JSON.stringify(gateReport, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(gateReport))
} catch (error) {
  const failure = { format: 'housing-data-production-gate-v1', status: 'failed', cloud_env_id: cloudEnvId, started_at: startedAt, failed_at: new Date().toISOString(), error: String(error?.message || error).slice(0, 1000) }
  await writeFile(resolve(outputRoot, 'gate-report.json'), `${JSON.stringify(failure, null, 2)}\n`, 'utf8')
  throw error
}
