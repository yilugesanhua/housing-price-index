import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import COS from 'cos-nodejs-sdk-v5'
import TencentCloudScf from 'tencentcloud-sdk-nodejs-scf'

export const DEFAULT_CLOUD_ENV_ID = 'cloud1-d3gpdx70w5d05c68c'
export const STORAGE_BUCKET_ID = '636c-cloud1-d3gpdx70w5d05c68c-1456861154'
export const STORAGE_REGION = 'ap-shanghai'
export const DEFAULT_COS_TIMEOUT_MS = 60_000
export const LARGE_TRANSFER_COS_TIMEOUT_MS = 180_000

const missingCodes = new Set(['NoSuchKey', 'NotFound', 'ResourceNotFound'])

function cloudError(operation, key, error) {
  const code = error?.code || error?.statusCode || 'unknown'
  return new Error(`COS ${operation} failed for ${key}: ${code} ${error?.message || ''}`.trim(), { cause: error })
}

export function isMissingObjectError(error) {
  const cause = error?.cause || error
  return cause?.statusCode === 404 || missingCodes.has(cause?.code)
}

export function assertRehearsalKey(key, runId) {
  const expectedPrefix = `housing-data/rehearsals/${runId}/`
  if (!/^\d+(?:-\d+)?$/.test(runId || '') || !key.startsWith(expectedPrefix) || key.includes('..')) {
    throw new Error(`Refusing non-rehearsal COS key: ${key}`)
  }
  return key
}

export function assertReleaseCleanupPrefix(datasetVersion) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || '')) {
    throw new Error('Invalid release cleanup dataset version')
  }
  return `housing-data/releases/${datasetVersion}/`
}

export function cosTimeoutForKey(key) {
  return /(?:^|\/)(?:bootstrap|complete-snapshot)\.json$/.test(key) ? LARGE_TRANSFER_COS_TIMEOUT_MS : DEFAULT_COS_TIMEOUT_MS
}

export function buildScfInvokeRequest(functionName, cloudEnvId, event) {
  const request = {
    FunctionName: functionName,
    Namespace: cloudEnvId,
    InvocationType: 'RequestResponse',
  }
  if (event === undefined) return request
  const prototype = event && typeof event === 'object' && !Array.isArray(event) ? Object.getPrototypeOf(event) : undefined
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.keys(event).length !== 1
    || event.action !== 'describe_validator') {
    throw new Error('SCF event is not an approved plain-object request')
  }
  return { ...request, ClientContext: '{"action":"describe_validator"}' }
}

export function createTencentCloudClient({
  secretId = process.env.TENCENTCLOUD_SECRET_ID,
  secretKey = process.env.TENCENTCLOUD_SECRET_KEY,
  cloudEnvId = DEFAULT_CLOUD_ENV_ID,
  bucket = STORAGE_BUCKET_ID,
  region = STORAGE_REGION,
} = {}) {
  if (!secretId || !secretKey) throw new Error('Tencent Cloud publisher credentials are required')
  if (!/^cloud[\w-]+$/.test(cloudEnvId)) throw new Error('Invalid CloudBase environment ID')

  const cos = new COS({ SecretId: secretId, SecretKey: secretKey, Timeout: DEFAULT_COS_TIMEOUT_MS })
  const largeTransferCos = new COS({ SecretId: secretId, SecretKey: secretKey, Timeout: LARGE_TRANSFER_COS_TIMEOUT_MS })
  const ScfClient = TencentCloudScf.scf.v20180416.Client
  const scf = new ScfClient({ credential: { secretId, secretKey }, region })

  const callCos = (method, key, extra = {}) => new Promise((resolveCall, reject) => {
    const client = cosTimeoutForKey(key) === LARGE_TRANSFER_COS_TIMEOUT_MS ? largeTransferCos : cos
    client[method]({ Bucket: bucket, Region: region, Key: key, ...extra }, (error, data) => {
      if (error) reject(cloudError(method, key, error))
      else resolveCall(data)
    })
  })

  const headObject = (key) => callCos('headObject', key)
  const getObject = async (key) => {
    const result = await callCos('getObject', key)
    return Buffer.isBuffer(result.Body) ? result.Body : Buffer.from(result.Body)
  }
  const downloadObject = async (key, destination) => {
    const body = await getObject(key)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, body)
    return body
  }
  const putObject = async (key, body) => callCos('putObject', key, { Body: body })
  const listObjects = async (prefix, marker = undefined) => callCos('getBucket', prefix, {
    Prefix: prefix,
    Marker: marker,
    MaxKeys: 1000,
  })
  const deleteObjects = async (keys) => {
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > 1000 || keys.some((key) => typeof key !== 'string' || key.length === 0)) {
      throw new Error('COS deletion requires 1 to 1000 explicit object keys')
    }
    return callCos('deleteMultipleObject', keys[0], { Objects: keys.map((Key) => ({ Key })), Quiet: true })
  }
  const uploadFile = async (source, key) => putObject(key, await readFile(source))
  const uploadDirectory = async (sourceRoot, keyPrefix) => {
    const uploaded = []
    async function visit(directory, relativeRoot = '') {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name
        const absolutePath = resolve(directory, entry.name)
        if (entry.isDirectory()) await visit(absolutePath, relativePath)
        else if (entry.isFile()) {
          const key = `${keyPrefix.replace(/\/$/, '')}/${relativePath}`
          await uploadFile(absolutePath, key)
          uploaded.push(key)
        }
      }
    }
    await visit(sourceRoot)
    return uploaded
  }
  const objectExists = async (key) => {
    try {
      await headObject(key)
      return true
    } catch (error) {
      if (isMissingObjectError(error)) return false
      throw error
    }
  }
  const invokeFunction = (functionName, event) => scf.Invoke(buildScfInvokeRequest(functionName, cloudEnvId, event))
  const updateFunctionCode = ({ functionName, zipFile, handler = 'index.main' }) => {
    if (!Buffer.isBuffer(zipFile) || zipFile.length === 0 || zipFile.length > 20 * 1024 * 1024) {
      throw new Error('Function deployment zip is missing or exceeds the SCF inline limit')
    }
    return scf.UpdateFunctionCode({
      FunctionName: functionName,
      Namespace: cloudEnvId,
      Handler: handler,
      ZipFile: zipFile.toString('base64'),
      InstallDependency: 'TRUE',
      Publish: 'FALSE',
    })
  }

  return {
    bucket,
    region,
    cloudEnvId,
    headObject,
    getObject,
    downloadObject,
    putObject,
    listObjects,
    deleteObjects,
    uploadFile,
    uploadDirectory,
    objectExists,
    invokeFunction,
    updateFunctionCode,
  }
}
