import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256 } from './remote-data-lib.mjs'
import { readState, transitionState, writeState } from './auto-update-state.mjs'

const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const datasetVersion = argument('dataset')
if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || '')) throw new Error('Use --dataset=<published-version>')
const pendingPath = resolve(root, 'data/releases/pending-auto-release.json')
const statePath = resolve(root, 'data/releases/auto-update-state.json')
const auditPath = resolve(root, 'data/releases', `${datasetVersion}.json`)
const pending = JSON.parse(await readFile(pendingPath, 'utf8'))
const auditText = await readFile(auditPath, 'utf8')
const audit = JSON.parse(auditText)
if (!['ready', 'published'].includes(pending.status) || pending.dataset_version !== datasetVersion) throw new Error('Pending release does not match the published dataset')
if (audit.status !== 'published' || audit.dataset_version !== datasetVersion) throw new Error('Publish audit does not prove a successful release')
const state = await readState(statePath)
if (!state || state.candidate_id !== pending.candidate_id) throw new Error('Durable auto-update state does not match the published candidate')
const publishedState = state.status === 'published'
  ? state
  : transitionState(transitionState(state, 'publishing', { updated_at: audit.published_at }), 'published', {
    published_at: audit.published_at,
    publish_audit_sha256: sha256(auditText),
    updated_at: audit.published_at,
  })
const completed = {
  ...pending,
  status: 'published',
  published_at: audit.published_at,
  publish_audit_sha256: sha256(auditText),
  github_run_id: audit.github_run_id,
  commit_sha: audit.commit_sha,
}
if (pending.status !== 'published') await writeFile(pendingPath, `${JSON.stringify(completed, null, 2)}\n`, 'utf8')
await writeFile(resolve(root, 'data/releases/latest-auto-release.json'), `${JSON.stringify(completed, null, 2)}\n`, 'utf8')
if (state.status !== 'published') await writeState(statePath, publishedState)
console.log(JSON.stringify(completed))
