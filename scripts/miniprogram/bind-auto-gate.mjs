import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256 } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const gatePath = resolve(root, argument('gate') || 'work/auto-release/gate-report.json')
const commitSha = argument('commit')
const ordinaryCiPath = argument('ordinary-ci')
if (!/^[a-f0-9]{40}$/.test(commitSha || '')) throw new Error('Use --commit=<40-character SHA>')
if (!ordinaryCiPath) throw new Error('Use --ordinary-ci=<ordinary-ci-evidence.json>')
const gate = JSON.parse(await readFile(gatePath, 'utf8'))
const ordinaryCi = JSON.parse(await readFile(resolve(root, ordinaryCiPath), 'utf8'))
if (gate.status !== 'passed') throw new Error('Cannot bind a failed gate report')
if (ordinaryCi.workflow !== 'ci.yml' || ordinaryCi.event !== 'push' || ordinaryCi.conclusion !== 'success'
  || !/^\d+$/.test(String(ordinaryCi.run_id || '')) || ordinaryCi.commit_sha !== commitSha) {
  throw new Error('Candidate ordinary CI evidence is invalid or belongs to another commit')
}
gate.commit_sha = commitSha
gate.ordinary_ci = ordinaryCi
gate.bound_at = new Date().toISOString()
const text = `${JSON.stringify(gate, null, 2)}\n`
await writeFile(gatePath, text, 'utf8')
console.log(JSON.stringify({ dataset_version: gate.dataset_version, commit_sha: commitSha, gate_report_sha256: sha256(text), gate_report_path: gatePath }))
