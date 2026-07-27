import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256 } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const gatePath = resolve(root, argument('gate') || 'work/auto-release/gate-report.json')
const commitSha = argument('commit')
if (!/^[a-f0-9]{40}$/.test(commitSha || '')) throw new Error('Use --commit=<40-character SHA>')
const gate = JSON.parse(await readFile(gatePath, 'utf8'))
if (gate.status !== 'passed') throw new Error('Cannot bind a failed gate report')
gate.commit_sha = commitSha
gate.bound_at = new Date().toISOString()
const text = `${JSON.stringify(gate, null, 2)}\n`
await writeFile(gatePath, text, 'utf8')
console.log(JSON.stringify({ dataset_version: gate.dataset_version, commit_sha: commitSha, gate_report_sha256: sha256(text), gate_report_path: gatePath }))
