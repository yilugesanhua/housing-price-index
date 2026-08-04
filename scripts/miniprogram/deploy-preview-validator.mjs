import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createTencentCloudClient, isMissingObjectError } from './tencent-cloud-sdk.mjs'

const root = resolve(import.meta.dirname, '../..')
const execFileAsync = promisify(execFile)
const functionName = 'getHousingDataManifestPreview'
const cloudEnvId = 'cloud1-d3gpdx70w5d05c68c'
const output = resolve(root, 'work/miniprogram-preview-function')
const isMissingFunction = (error) => error?.code === 'ResourceNotFound.Function'
  || isMissingObjectError(error)
  || /ResourceNotFound|FunctionNameNotFound|not found/i.test(String(error?.message || error))

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Preview validator deployment is allowed only in GitHub Actions')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifestPreview/index.js'), resolve(output, 'index.js'))
await cp(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifestPreview/package.json'), resolve(output, 'package.json'))
for (const name of ['audited-legacy-migrations.js', 'validate-current.js', 'validation-receipt.js']) {
  await cp(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifest', name), resolve(output, name))
}
await execFileAsync('zip', ['-X', '-q', 'getHousingDataManifestPreview.zip', 'index.js', 'package.json', 'audited-legacy-migrations.js', 'validate-current.js', 'validation-receipt.js'], { cwd: output })
const zipFile = await readFile(resolve(output, 'getHousingDataManifestPreview.zip'))
const cloud = createTencentCloudClient({ cloudEnvId })
let operation = 'updated'
try {
  await cloud.getFunction(functionName)
  await cloud.updateFunctionCode({ functionName, zipFile })
} catch (error) {
  if (!isMissingFunction(error)) throw error
  operation = 'created'
  await cloud.createFunction({ functionName, zipFile })
}
await writeFile(resolve(output, 'deploy-report.json'), `${JSON.stringify({ function_name: functionName, operation, zip_sha256: createHash('sha256').update(zipFile).digest('hex') }, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ function_name: functionName, operation }))
