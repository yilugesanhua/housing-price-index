import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertReleaseCleanupPrefix, createTencentCloudClient } from './tencent-cloud-sdk.mjs'
import { sha256 } from './remote-data-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const datasetVersion = argument('dataset')
const expectedCurrentVersion = argument('expected-current')
const cloudEnvId = argument('env') || 'cloud1-d3gpdx70w5d05c68c'
const reportPath = resolve(root, 'work/candidate-cleanup/report.json')

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_WORKFLOW !== 'monthly-data-candidate-cleanup') {
  throw new Error('Remote candidate cleanup is allowed only in its dedicated GitHub Actions workflow')
}
if (!String(process.env.GITHUB_WORKFLOW_REF || '').includes('/.github/workflows/monthly-data-candidate-cleanup.yml@refs/heads/')) {
  throw new Error('Remote candidate cleanup workflow reference is invalid')
}
if (process.env.GITHUB_REF !== `refs/heads/${process.env.CI_DEFAULT_BRANCH}`) {
  throw new Error('Remote candidate cleanup must run on the default branch')
}
if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(expectedCurrentVersion || '')) {
  throw new Error('Use --expected-current=<published-version>')
}

const prefix = assertReleaseCleanupPrefix(datasetVersion)
const cloud = createTencentCloudClient({ cloudEnvId })

async function readCurrent() {
  const text = (await cloud.getObject('housing-data/current.json')).toString('utf8')
  const pointer = JSON.parse(text)
  if (pointer.dataset_version !== expectedCurrentVersion || pointer.dataset_version === datasetVersion) {
    throw new Error('Current production pointer is not the expected protected version')
  }
  return { text, pointer }
}

async function listReleaseKeys() {
  const keys = []
  let marker
  do {
    const page = await cloud.listObjects(prefix, marker)
    for (const item of page.Contents || []) {
      if (typeof item.Key !== 'string' || !item.Key.startsWith(prefix)) throw new Error('COS returned an object outside the requested cleanup prefix')
      keys.push(item.Key)
    }
    marker = page.IsTruncated ? page.NextMarker : undefined
    if (page.IsTruncated && (!marker || typeof marker !== 'string')) throw new Error('COS returned an invalid continuation marker')
  } while (marker)
  return keys
}

const before = await readCurrent()
const keys = await listReleaseKeys()
for (let index = 0; index < keys.length; index += 1000) await cloud.deleteObjects(keys.slice(index, index + 1000))
const remainingKeys = await listReleaseKeys()
if (remainingKeys.length !== 0) throw new Error('Candidate release prefix is not empty after deletion')
const after = await readCurrent()
if (after.text !== before.text) throw new Error('Production current.json changed during candidate cleanup')

const report = {
  status: 'deleted',
  dataset_version: datasetVersion,
  deleted_object_count: keys.length,
  release_prefix: prefix,
  protected_current_dataset_version: expectedCurrentVersion,
  current_sha256_before: sha256(before.text),
  current_sha256_after: sha256(after.text),
  deleted_at: new Date().toISOString(),
}
await mkdir(resolve(root, 'work/candidate-cleanup'), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report))
