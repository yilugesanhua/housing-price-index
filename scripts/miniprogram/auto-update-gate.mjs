import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sha256 } from './remote-data-lib.mjs'
import { isOfficialReleaseUrl } from './official-source-url.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(`Automatic update gate rejected: ${message}`)
}

function addOneMonth(value) {
  assert(/^20\d{2}-(0[1-9]|1[0-2])$/.test(value || ''), 'current dataset month is invalid')
  const date = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function calendarText(calendar) {
  return JSON.stringify({ year: calendar.year, source_urls: calendar.source_urls ?? [calendar.source_url], raw_content_sha256: calendar.raw_content_sha256, entries: calendar.entries })
}

export function validateDiscoveryGate({ handoff, discoveryReportText, discoveryCalendar, freshReport, freshCalendar, trigger }) {
  assert(handoff?.format === 'housing-data-discovery-handoff-v1' && handoff.status === 'update_available', 'handoff format or status is invalid')
  assert(trigger.workflow_name === 'monthly-data-check', 'triggering workflow is not the read-only discovery workflow')
  assert(trigger.conclusion === 'success', 'discovery workflow did not complete successfully')
  assert(trigger.event === 'schedule' || trigger.event === 'workflow_dispatch', 'discovery event is not trusted')
  assert(trigger.head_branch === trigger.default_branch, 'discovery did not run on the default branch')
  assert(/^[a-f0-9]{40}$/.test(trigger.head_sha || ''), 'trigger commit SHA is invalid')
  assert(String(handoff.discovery_run_id) === String(trigger.run_id), 'discovery run ID mismatch')
  assert(handoff.repository_commit_sha === trigger.head_sha, 'discovery commit SHA mismatch')
  assert(handoff.report_sha256 === sha256(discoveryReportText), 'discovery report hash mismatch')
  const discoveryReport = JSON.parse(discoveryReportText)
  assert(discoveryReport.status === 'update_available' && discoveryReport.official_release_detected === true, 'discovery report did not detect a release')
  assert(handoff.dataset_as_of === discoveryReport.dataset_as_of, 'handoff current month mismatch')
  assert(handoff.expected_stat_month === addOneMonth(handoff.dataset_as_of), 'candidate month is not exactly next')
  assert(handoff.expected_stat_month === discoveryReport.expected_stat_month && handoff.expected_stat_month === discoveryReport.latest_official_month, 'discovery month fields disagree')
  assert(handoff.official_url === discoveryReport.latest_official_url && isOfficialReleaseUrl(handoff.official_url), 'official release URL is invalid')
  assert(handoff.scheduled_release_at === discoveryReport.scheduled_release_at, 'scheduled release time mismatch')
  const discoveryCalendarText = calendarText(discoveryCalendar)
  assert(handoff.calendar_sha256 === sha256(discoveryCalendarText), 'discovery release calendar hash mismatch')
  assert(handoff.calendar_raw_content_sha256 === discoveryCalendar.raw_content_sha256, 'discovery release calendar source hash mismatch')
  const discoveryEntry = discoveryCalendar.entries?.find((item) => item.expected_stat_month === handoff.expected_stat_month)
  assert(discoveryEntry?.scheduled_at === handoff.scheduled_release_at, 'handoff does not match the discovery release schedule')
  const entry = freshCalendar.entries?.find((item) => item.expected_stat_month === handoff.expected_stat_month)
  assert(freshReport.status === 'update_available' && freshReport.official_release_detected === true, 'fresh official check did not confirm the update')
  assert(freshReport.expected_stat_month === handoff.expected_stat_month && freshReport.latest_official_month === handoff.expected_stat_month, 'fresh official month mismatch')
  assert(freshReport.latest_official_url === handoff.official_url, 'fresh official URL mismatch')
  assert(entry?.scheduled_at === freshReport.scheduled_release_at, 'candidate does not match the freshly verified release schedule')
  const handoffIdempotencyKey = sha256(`${handoff.expected_stat_month}\n${handoff.official_url}\n${discoveryCalendarText}`)
  assert(handoff.idempotency_key === handoffIdempotencyKey, 'discovery idempotency key mismatch')
  const freshCalendarText = calendarText(freshCalendar)
  const idempotencyKey = sha256(`${handoff.expected_stat_month}\n${handoff.official_url}\n${freshCalendarText}`)
  return {
    format: 'housing-data-discovery-gate-v1',
    status: 'passed',
    dataset_as_of: handoff.dataset_as_of,
    expected_stat_month: handoff.expected_stat_month,
    official_url: handoff.official_url,
    scheduled_release_at: handoff.scheduled_release_at,
    discovery_run_id: String(trigger.run_id),
    discovery_commit_sha: trigger.head_sha,
    idempotency_key: idempotencyKey,
    calendar_changed_after_discovery: handoff.calendar_sha256 !== sha256(freshCalendarText),
    discovery_scheduled_release_at: handoff.scheduled_release_at,
    fresh_scheduled_release_at: entry.scheduled_at,
    handoff_sha256: sha256(`${JSON.stringify(handoff, null, 2)}\n`),
    fresh_checked_at: freshReport.checked_at,
    verified_at: new Date().toISOString(),
  }
}

async function main() {
  const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  const handoffPath = argument('handoff')
  const discoveryReportPath = argument('discovery-report')
  const freshReportPath = argument('fresh-report')
  const calendarPath = argument('calendar')
  const discoveryCalendarPath = argument('discovery-calendar')
  const triggerPath = argument('trigger')
  assert(handoffPath && discoveryReportPath && discoveryCalendarPath && freshReportPath && calendarPath && triggerPath, 'required input path is missing')
  const [handoff, discoveryReportText, discoveryCalendar, freshReport, freshCalendar, trigger] = await Promise.all([
    readFile(resolve(handoffPath), 'utf8').then(JSON.parse),
    readFile(resolve(discoveryReportPath), 'utf8'),
    readFile(resolve(discoveryCalendarPath), 'utf8').then(JSON.parse),
    readFile(resolve(freshReportPath), 'utf8').then(JSON.parse),
    readFile(resolve(calendarPath), 'utf8').then(JSON.parse),
    readFile(resolve(triggerPath), 'utf8').then(JSON.parse),
  ])
  const result = validateDiscoveryGate({ handoff, discoveryReportText, discoveryCalendar, freshReport, freshCalendar, trigger })
  const outputRoot = resolve('work/auto-release')
  await mkdir(outputRoot, { recursive: true })
  await writeFile(resolve(outputRoot, 'discovery-gate.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
