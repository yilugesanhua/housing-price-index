import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acknowledgeIncident,
  buildIncident,
  evaluateIncidents,
  openIncident,
  recoverIncident,
} from './incident-lifecycle.mjs'

const repository = 'example/housing-price-index'
const token = 'test-token'
const occurredAt = '2026-08-30T02:00:00.000Z'

function incident() {
  return buildIncident({
    kind: 'workflow_failure',
    scope: 'monthly-data-check',
    condition: 'workflow_conclusion=failure',
    summary: 'The discovery workflow failed before a trustworthy handoff was created.',
    owner: 'data-owner',
    occurredAt,
    acknowledgeWithinMinutes: 30,
    evidenceUrl: 'https://github.com/example/housing-price-index/actions/runs/123',
  })
}

function mockGithub({ issues = [], comments = new Map() } = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname.replace(`/repos/${repository}`, '') + new URL(url).search
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ method: options.method, path, body })
    if (options.method === 'GET' && path.startsWith('/issues?')) {
      const state = new URL(url).searchParams.get('state')
      return new Response(JSON.stringify(issues.filter((issue) => state === 'all' || issue.state === state)), { status: 200 })
    }
    const commentsMatch = /^\/issues\/(\d+)\/comments/.exec(path)
    if (options.method === 'GET' && commentsMatch) return new Response(JSON.stringify(comments.get(Number(commentsMatch[1])) || []), { status: 200 })
    if (options.method === 'POST' && path === '/issues') {
      const created = { number: issues.length + 1, state: 'open', body: body.body, html_url: `https://github.com/${repository}/issues/${issues.length + 1}` }
      issues.push(created)
      comments.set(created.number, [])
      return new Response(JSON.stringify(created), { status: 201 })
    }
    if (options.method === 'POST' && commentsMatch) {
      const number = Number(commentsMatch[1])
      const entry = { body: body.body, user: { login: 'data-owner' } }
      comments.set(number, [...(comments.get(number) || []), entry])
      return new Response(JSON.stringify(entry), { status: 201 })
    }
    const patchMatch = /^\/issues\/(\d+)$/.exec(path)
    if (options.method === 'PATCH' && patchMatch) {
      const issue = issues.find((item) => item.number === Number(patchMatch[1]))
      issue.state = body.state
      return new Response(JSON.stringify(issue), { status: 200 })
    }
    return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
  }
  return { issues, comments, calls, fetchImpl }
}

test('incident opening assigns one owner and deduplicates the same active fault', async () => {
  const github = mockGithub()
  const first = await openIncident({ repository, token, incident: incident(), fetchImpl: github.fetchImpl })
  assert.equal(first.status, 'opened')
  assert.equal(github.issues.length, 1)
  assert.match(github.issues[0].body, /housing-data-incident:v1:/)
  const duplicate = await openIncident({ repository, token, incident: incident(), fetchImpl: github.fetchImpl })
  assert.equal(duplicate.status, 'deduplicated')
  assert.equal(github.issues.length, 1)
  assert.equal(github.calls.filter((call) => call.method === 'POST' && call.path === '/issues').length, 1)
})

test('an owner acknowledgement is idempotent and prevents escalation', async () => {
  const github = mockGithub()
  const source = incident()
  await openIncident({ repository, token, incident: source, fetchImpl: github.fetchImpl })
  const acknowledgement = await acknowledgeIncident({
    repository, token, fingerprint: source.fingerprint, owner: 'data-owner',
    acknowledgedAt: '2026-08-30T02:10:00.000Z', note: 'Investigating the failed discovery run.', fetchImpl: github.fetchImpl,
  })
  assert.equal(acknowledgement.status, 'acknowledged')
  const repeated = await acknowledgeIncident({
    repository, token, fingerprint: source.fingerprint, owner: 'data-owner',
    acknowledgedAt: '2026-08-30T02:11:00.000Z', note: 'Repeated confirmation.', fetchImpl: github.fetchImpl,
  })
  assert.equal(repeated.status, 'already_acknowledged')
  const result = await evaluateIncidents({ repository, token, now: '2026-08-30T03:00:00.000Z', fetchImpl: github.fetchImpl })
  assert.deepEqual(result.incidents.map((item) => item.status), ['acknowledged'])
})

test('a missed acknowledgement escalates once and recovery records evidence before closing', async () => {
  const github = mockGithub()
  const source = incident()
  await openIncident({ repository, token, incident: source, fetchImpl: github.fetchImpl })
  const firstEvaluation = await evaluateIncidents({ repository, token, now: '2026-08-30T02:31:00.000Z', fetchImpl: github.fetchImpl })
  assert.deepEqual(firstEvaluation.incidents.map((item) => item.status), ['escalated'])
  const secondEvaluation = await evaluateIncidents({ repository, token, now: '2026-08-30T02:32:00.000Z', fetchImpl: github.fetchImpl })
  assert.deepEqual(secondEvaluation.incidents.map((item) => item.status), ['already_escalated'])
  const recovery = await recoverIncident({
    repository, token, fingerprint: source.fingerprint, recoveredAt: '2026-08-30T02:40:00.000Z',
    recoveryEvidenceSha256: 'a'.repeat(64), summary: 'The retry completed and the evidence report passed.', fetchImpl: github.fetchImpl,
  })
  assert.equal(recovery.status, 'recovered')
  assert.equal(github.issues[0].state, 'closed')
  assert.match(github.comments.get(1).at(-1).body, /Recovery evidence SHA-256/)
  const repeated = await recoverIncident({
    repository, token, fingerprint: source.fingerprint, recoveredAt: '2026-08-30T02:41:00.000Z',
    recoveryEvidenceSha256: 'a'.repeat(64), summary: 'Duplicate recovery call.', fetchImpl: github.fetchImpl,
  })
  assert.equal(repeated.status, 'already_recovered')
})

test('invalid owner and recovery evidence are rejected before contacting GitHub', async () => {
  assert.throws(() => buildIncident({
    kind: 'workflow_failure', scope: 'monthly-data-check', condition: 'failure', summary: 'Failure', owner: '', occurredAt,
  }), /owner/)
  await assert.rejects(() => recoverIncident({
    repository, token, fingerprint: 'a'.repeat(64), recoveredAt: occurredAt,
    recoveryEvidenceSha256: 'not-a-hash', summary: 'Recovered.', fetchImpl: mockGithub().fetchImpl,
  }), /recovery evidence/)
})
