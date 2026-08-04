import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '../..')
const execFileAsync = promisify(execFile)
const functionName = 'getHousingDataManifestPreview'
const cloudEnvId = 'cloud1-d3gpdx70w5d05c68c'
const output = resolve(root, 'work/miniprogram-preview-function')

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Preview validator deployment is allowed only in GitHub Actions')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const indexText = await readFile(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifestPreview/index.js'), 'utf8')
const deployableIndex = indexText
  .replace("require('../getHousingDataManifest/validate-current.js')", "require('./validate-current.js')")
  .replace("require('../getHousingDataManifest/validation-receipt.js')", "require('./validation-receipt.js')")
if (deployableIndex === indexText || deployableIndex.includes("require('../getHousingDataManifest/")) throw new Error('Preview function dependency rewrite failed')
await writeFile(resolve(output, 'index.js'), deployableIndex, 'utf8')
await cp(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifestPreview/package.json'), resolve(output, 'package.json'))
for (const name of ['audited-legacy-migrations.js', 'validate-current.js', 'validation-receipt.js']) {
  await cp(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifest', name), resolve(output, name))
}
await execFileAsync('npx', ['tcb', 'fn', 'deploy', functionName, '--force', '--dir', output, '--runtime', 'Nodejs18.15', '--deployMode', 'zip', '--env-id', cloudEnvId], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
const deployedIndex = await readFile(resolve(output, 'index.js'))
await writeFile(resolve(output, 'deploy-report.json'), `${JSON.stringify({ function_name: functionName, deployment: 'cloudbase-cli', source_sha256: createHash('sha256').update(deployedIndex).digest('hex') }, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ function_name: functionName, deployment: 'cloudbase-cli' }))
