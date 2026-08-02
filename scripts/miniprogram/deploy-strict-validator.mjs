import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createTencentCloudClient } from './tencent-cloud-sdk.mjs'

const root = resolve(import.meta.dirname, '../..')
const functionName = 'getHousingDataManifest'
const expectedEnvironment = 'housing-data-production'
const expectedCloudEnvId = 'cloud1-d3gpdx70w5d05c68c'
const expectedSourceFiles = new Set([
  'audited-legacy-migrations.js',
  'index.js',
  'package.json',
  'validate-current.js',
  'validation-receipt.js',
])

function argument(name) {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || ''
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

const zipPathArgument = argument('zip')
const sourceFilesArgument = argument('source-files')
if (!zipPathArgument || !sourceFilesArgument) throw new Error('Both --zip and --source-files are required')
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Strict validator deployment is allowed only in GitHub Actions')
if (process.env.CI_PRODUCTION_ENVIRONMENT !== expectedEnvironment) throw new Error('Strict validator deployment requires the protected production environment')
if (process.env.LEGACY_CONTROL_MIGRATION_AUTHORIZED !== 'true') throw new Error('Strict validator deployment requires the job-scoped migration authorization')
if (process.env.AUTOMATIC_RELEASE_ENABLED !== 'false') throw new Error('Automatic release must remain disabled while deploying the strict validator')
if (process.env.PRODUCTION_RELEASE_AUTHORIZED && process.env.PRODUCTION_RELEASE_AUTHORIZED !== 'false') {
  throw new Error('Production release authorization must remain false or unset while deploying the strict validator')
}

const zipPath = resolve(root, zipPathArgument)
const sourceFilesPath = resolve(root, sourceFilesArgument)
if (!zipPath.startsWith(`${root}/`) && !zipPath.startsWith(`${root}\\`)) throw new Error('Deployment zip must be inside the repository workspace')
if (!sourceFilesPath.startsWith(`${root}/`) && !sourceFilesPath.startsWith(`${root}\\`)) throw new Error('Deployment file list must be inside the repository workspace')
if (basename(zipPath) !== 'getHousingDataManifest.zip') throw new Error('Deployment zip name is invalid')

const sourceFiles = new Set((await readFile(sourceFilesPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean))
if (sourceFiles.size !== expectedSourceFiles.size || [...sourceFiles].some((entry) => !expectedSourceFiles.has(entry))) {
  throw new Error('Deployment zip source list differs from the reviewed strict validator source set')
}
const zipFile = await readFile(zipPath)
if (zipFile.length === 0) throw new Error('Deployment zip is empty')

const cloud = createTencentCloudClient({ cloudEnvId: expectedCloudEnvId })
const response = await cloud.updateFunctionCode({ functionName, zipFile })
console.log(JSON.stringify({
  deployed_function: functionName,
  cloud_env_id: expectedCloudEnvId,
  deployment_zip_sha256: sha256(zipFile),
  request_id: response.RequestId || null,
  production_writes: 1,
}))
