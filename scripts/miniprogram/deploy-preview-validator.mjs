import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '../..')
const execFileAsync = promisify(execFile)
const functionName = 'getHousingDataManifestPreview'
const cloudEnvId = 'cloud1-d3gpdx70w5d05c68c'
const outputRoot = resolve(root, 'work/miniprogram-preview-function')
const output = resolve(outputRoot, functionName)
const prepareOnly = process.argv.includes('--prepare-only')

if (process.env.GITHUB_ACTIONS !== 'true' && !prepareOnly) throw new Error('Preview validator deployment requires GitHub Actions or --prepare-only')
await rm(outputRoot, { recursive: true, force: true })
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
await writeFile(resolve(outputRoot, 'cloudbaserc.json'), `${JSON.stringify({
  envId: cloudEnvId,
  functionRoot: '.',
  functions: [{ name: functionName, handler: 'index.main', runtime: 'Nodejs18.15', timeout: 10, memorySize: 128 }],
}, null, 2)}\n`, 'utf8')
if (prepareOnly) {
  console.log(JSON.stringify({ function_name: functionName, deployment: 'prepared_for_local_cloudbase_cli', directory: outputRoot }))
  process.exit(0)
}
await execFileAsync('npx', ['tcb', 'fn', 'deploy', functionName, '--force', '--dir', output, '--runtime', 'Nodejs18.15', '--deployMode', 'zip', '--env-id', cloudEnvId], { cwd: outputRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
const deployedIndex = await readFile(resolve(output, 'index.js'))
await writeFile(resolve(outputRoot, 'deploy-report.json'), `${JSON.stringify({ function_name: functionName, deployment: 'cloudbase-cli', source_sha256: createHash('sha256').update(deployedIndex).digest('hex') }, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ function_name: functionName, deployment: 'cloudbase-cli' }))
