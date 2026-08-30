import { createHash } from 'node:crypto'

const INCIDENT_MARKER_PREFIX = 'housing-data-incident:v1:'
const INCIDENT_META_PREFIX = 'housing-data-incident-meta:v1:'
const ACK_MARKER_PREFIX = 'housing-data-incident-ack:v1:'
const ESCALATION_MARKER_PREFIX = 'housing-data-incident-escalation:v1:'
const RECOVERY_MARKER_PREFIX = 'housing-data-incident-recovery:v1:'
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/
const OWNER_PATTERN = /^[A-Za-z0-9-]{1,39}$/

function assert(condition, message) {
  if (!condition) throw new Error(`Incident lifecycle rejected: ${message}`)
}

function canonicalTime(value, label) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, `${label} must be a canonical ISO 8601 timestamp`)
  return value
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right, 'en')).map(([key, item]) => [key, canonicalize(item)]))
  return value
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function text(value, label, { minimum = 1, maximum = 2000 } = {}) {
  assert(typeof value === 'string' && value.trim() === value && value.length >= minimum && value.length <= maximum, `${label} is invalid`)
  return value
}

function metadataMarker(metadata) {
  return `<!-- ${INCIDENT_META_PREFIX}${Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url')} -->`
}

function parseMetadata(body) {
  if (typeof body !== 'string') return null
  const match = new RegExp(`<!-- ${INCIDENT_META_PREFIX}([A-Za-z0-9_-]+) -->`).exec(body)
  if (!match) return null
  try {
    const value = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'))
    if (!value || typeof value !== 'object' || !FINGERPRINT_PATTERN.test(value.fingerprint || '')) return null
    return value
  } catch {
    return null
  }
}

function marker(prefix, fingerprint) {
  return `<!-- ${prefix}${fingerprint} -->`
}

function issueUrl(repository, number) {
  return `https://github.com/${repository}/issues/${number}`
}

function issueMetadata(issue) {
  const metadata = parseMetadata(issue?.body)
  return metadata && Number.isSafeInteger(issue?.number) ? metadata : null
}

function findIssue(issues, fingerprint) {
  assert(Array.isArray(issues), 'GitHub issues response is invalid')
  return issues.find((issue) => !issue.pull_request && issueMetadata(issue)?.fingerprint === fingerprint) ?? null
}

function markerComment(comments, prefix, fingerprint, owner = '') {
  assert(Array.isArray(comments), 'GitHub issue comments response is invalid')
  return comments.find((comment) => (
    typeof comment?.body === 'string'
    && comment.body.includes(marker(prefix, fingerprint))
    && (!owner || comment?.user?.login === owner)
  )) ?? null
}

export function buildIncident({
  kind,
  scope,
  condition,
  summary,
  owner,
  occurredAt,
  acknowledgeWithinMinutes = 30,
  evidenceUrl = '',
}) {
  text(kind, 'incident kind', { maximum: 80 })
  text(scope, 'incident scope', { maximum: 200 })
  text(condition, 'incident condition', { maximum: 500 })
  text(summary, 'incident summary', { maximum: 2000 })
  assert(OWNER_PATTERN.test(owner || ''), 'incident owner is invalid')
  canonicalTime(occurredAt, 'incident occurrence time')
  assert(Number.isSafeInteger(acknowledgeWithinMinutes) && acknowledgeWithinMinutes >= 5 && acknowledgeWithinMinutes <= 24 * 60, 'acknowledgement window is invalid')
  if (evidenceUrl) assert(/^https:\/\/github\.com\//.test(evidenceUrl), 'incident evidence URL is invalid')
  const fingerprint = sha256({ format: 'housing-data-incident-fingerprint-v1', kind, scope, condition })
  const acknowledgeBy = new Date(Date.parse(occurredAt) + acknowledgeWithinMinutes * 60_000).toISOString()
  const metadata = {
    format: 'housing-data-incident-v1',
    fingerprint,
    kind,
    scope,
    condition,
    owner,
    occurred_at: occurredAt,
    acknowledge_by: acknowledgeBy,
  }
  const body = [
    marker(INCIDENT_MARKER_PREFIX, fingerprint),
    metadataMarker(metadata),
    '# Housing data automation incident',
    '',
    `- Status: open`,
    `- Owner: @${owner}`,
    `- Acknowledge by: ${acknowledgeBy}`,
    `- Fault fingerprint: \`${fingerprint}\``,
    `- Kind: ${kind}`,
    `- Scope: ${scope}`,
    `- Condition: ${condition}`,
    ...(evidenceUrl ? [`- Evidence: ${evidenceUrl}`] : []),
    '',
    '## Summary',
    '',
    summary,
  ].join('\n')
  return {
    fingerprint,
    metadata,
    title: `[housing-data] ${kind}: ${scope}`,
    body,
  }
}

async function githubRequest({ fetchImpl, repository, token, method, path, body }) {
  assert(typeof repository === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'repository is invalid')
  assert(typeof token === 'string' && token.length > 0, 'GitHub token is missing')
  const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const raw = await response.text()
  let payload = null
  if (raw) {
    try { payload = JSON.parse(raw) } catch { throw new Error(`Incident lifecycle rejected: GitHub returned invalid JSON for ${method} ${path}`) }
  }
  if (!response.ok) throw new Error(`Incident lifecycle rejected: GitHub ${method} ${path} returned HTTP ${response.status}`)
  return payload
}

async function listIssues(api, state = 'open') {
  const payload = await api('GET', `/issues?state=${state}&per_page=100`)
  assert(Array.isArray(payload), 'GitHub issues response is invalid')
  return payload
}

async function listComments(api, number) {
  const payload = await api('GET', `/issues/${number}/comments?per_page=100`)
  assert(Array.isArray(payload), 'GitHub issue comments response is invalid')
  return payload
}

export async function openIncident({ repository, token, incident, fetchImpl = fetch }) {
  assert(incident?.fingerprint && incident?.metadata && incident?.title && incident?.body, 'incident input is invalid')
  const api = (method, path, body) => githubRequest({ fetchImpl, repository, token, method, path, body })
  const existing = findIssue(await listIssues(api), incident.fingerprint)
  if (existing) return { status: 'deduplicated', fingerprint: incident.fingerprint, issue_number: existing.number, issue_url: issueUrl(repository, existing.number) }
  const created = await api('POST', '/issues', {
    title: incident.title,
    body: incident.body,
    assignees: [incident.metadata.owner],
  })
  assert(Number.isSafeInteger(created?.number), 'GitHub did not return an issue number')
  return { status: 'opened', fingerprint: incident.fingerprint, issue_number: created.number, issue_url: created.html_url || issueUrl(repository, created.number) }
}

export async function acknowledgeIncident({ repository, token, fingerprint, owner, acknowledgedAt, note, fetchImpl = fetch }) {
  assert(FINGERPRINT_PATTERN.test(fingerprint || ''), 'incident fingerprint is invalid')
  assert(OWNER_PATTERN.test(owner || ''), 'incident owner is invalid')
  canonicalTime(acknowledgedAt, 'acknowledgement time')
  text(note, 'acknowledgement note', { maximum: 2000 })
  const api = (method, path, body) => githubRequest({ fetchImpl, repository, token, method, path, body })
  const issue = findIssue(await listIssues(api), fingerprint)
  assert(issue, 'open incident was not found')
  const metadata = issueMetadata(issue)
  assert(metadata.owner === owner, 'only the assigned owner may acknowledge this incident')
  if (markerComment(await listComments(api, issue.number), ACK_MARKER_PREFIX, fingerprint, owner)) {
    return { status: 'already_acknowledged', fingerprint, issue_number: issue.number, issue_url: issueUrl(repository, issue.number) }
  }
  await api('POST', `/issues/${issue.number}/comments`, {
    body: [
      marker(ACK_MARKER_PREFIX, fingerprint),
      `Acknowledged by @${owner} at ${acknowledgedAt}.`,
      '',
      note,
    ].join('\n'),
  })
  return { status: 'acknowledged', fingerprint, issue_number: issue.number, issue_url: issueUrl(repository, issue.number) }
}

export async function evaluateIncidents({ repository, token, now, fetchImpl = fetch }) {
  canonicalTime(now, 'evaluation time')
  const api = (method, path, body) => githubRequest({ fetchImpl, repository, token, method, path, body })
  const incidents = []
  for (const issue of await listIssues(api)) {
    if (issue.pull_request) continue
    const metadata = issueMetadata(issue)
    if (!metadata) continue
    const comments = await listComments(api, issue.number)
    const acknowledged = markerComment(comments, ACK_MARKER_PREFIX, metadata.fingerprint, metadata.owner)
    if (acknowledged) {
      incidents.push({ status: 'acknowledged', fingerprint: metadata.fingerprint, issue_number: issue.number })
      continue
    }
    if (Date.parse(now) < Date.parse(metadata.acknowledge_by)) {
      incidents.push({ status: 'waiting_for_acknowledgement', fingerprint: metadata.fingerprint, issue_number: issue.number })
      continue
    }
    if (markerComment(comments, ESCALATION_MARKER_PREFIX, metadata.fingerprint)) {
      incidents.push({ status: 'already_escalated', fingerprint: metadata.fingerprint, issue_number: issue.number })
      continue
    }
    await api('POST', `/issues/${issue.number}/comments`, {
      body: [
        marker(ESCALATION_MARKER_PREFIX, metadata.fingerprint),
        `Escalation: @${metadata.owner} has not acknowledged this incident by ${metadata.acknowledge_by}.`,
        '',
        'Keep production data and release controls unchanged until this incident is acknowledged and recovery evidence is recorded.',
      ].join('\n'),
    })
    incidents.push({ status: 'escalated', fingerprint: metadata.fingerprint, issue_number: issue.number })
  }
  return { evaluated_at: now, incidents }
}

export async function recoverIncident({ repository, token, fingerprint, recoveredAt, recoveryEvidenceSha256, summary, fetchImpl = fetch }) {
  assert(FINGERPRINT_PATTERN.test(fingerprint || ''), 'incident fingerprint is invalid')
  canonicalTime(recoveredAt, 'recovery time')
  assert(FINGERPRINT_PATTERN.test(recoveryEvidenceSha256 || ''), 'recovery evidence SHA-256 is invalid')
  text(summary, 'recovery summary', { maximum: 2000 })
  const api = (method, path, body) => githubRequest({ fetchImpl, repository, token, method, path, body })
  const issue = findIssue(await listIssues(api, 'all'), fingerprint)
  assert(issue, 'incident was not found')
  const comments = await listComments(api, issue.number)
  if (markerComment(comments, RECOVERY_MARKER_PREFIX, fingerprint)) {
    return { status: 'already_recovered', fingerprint, issue_number: issue.number, issue_url: issueUrl(repository, issue.number) }
  }
  await api('POST', `/issues/${issue.number}/comments`, {
    body: [
      marker(RECOVERY_MARKER_PREFIX, fingerprint),
      `Recovered at ${recoveredAt}.`,
      `Recovery evidence SHA-256: \`${recoveryEvidenceSha256}\``,
      '',
      summary,
    ].join('\n'),
  })
  if (issue.state !== 'closed') await api('PATCH', `/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' })
  return { status: 'recovered', fingerprint, issue_number: issue.number, issue_url: issueUrl(repository, issue.number) }
}

function argument(name, fallback = '') {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
}

async function main() {
  const action = argument('action')
  const repository = process.env.GITHUB_REPOSITORY || ''
  const token = process.env.GITHUB_TOKEN || ''
  const now = argument('now', new Date().toISOString())
  let result
  if (action === 'open') {
    const incident = buildIncident({
      kind: argument('kind'),
      scope: argument('scope'),
      condition: argument('condition'),
      summary: argument('summary'),
      owner: argument('owner', process.env.HOUSING_DATA_INCIDENT_OWNER || ''),
      occurredAt: argument('occurred-at', now),
      acknowledgeWithinMinutes: Number(argument('acknowledge-within-minutes', '30')),
      evidenceUrl: argument('evidence-url'),
    })
    result = await openIncident({ repository, token, incident })
  } else if (action === 'acknowledge') {
    result = await acknowledgeIncident({
      repository,
      token,
      fingerprint: argument('fingerprint'),
      owner: argument('owner', process.env.HOUSING_DATA_INCIDENT_OWNER || ''),
      acknowledgedAt: argument('acknowledged-at', now),
      note: argument('note'),
    })
  } else if (action === 'evaluate') {
    result = await evaluateIncidents({ repository, token, now })
  } else if (action === 'recover') {
    result = await recoverIncident({
      repository,
      token,
      fingerprint: argument('fingerprint'),
      recoveredAt: argument('recovered-at', now),
      recoveryEvidenceSha256: argument('recovery-evidence-sha256'),
      summary: argument('summary'),
    })
  } else {
    throw new Error('Incident lifecycle rejected: --action must be open, acknowledge, evaluate, or recover')
  }
  console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) await main()
