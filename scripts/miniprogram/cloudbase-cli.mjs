import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const cli = resolve(root, 'node_modules/@cloudbase/cli/bin/tcb')

export async function runTcb(args, { allowFailure = false } = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
    return { ok: true, stdout: result.stdout || '', stderr: result.stderr || '', command: ['tcb', ...args] }
  } catch (error) {
    const result = { ok: false, stdout: error.stdout || '', stderr: error.stderr || error.message || '', command: ['tcb', ...args], exitCode: error.code }
    if (!allowFailure) throw new Error(`CloudBase CLI failed: ${result.command.join(' ')}\n${result.stderr || result.stdout}`)
    return result
  }
}

export function isMissingCloudFile(result) {
  return !result.ok && /not\s*found|no\s*such\s*(key|file)|does\s*not\s*exist|不存在|未找到/i.test(`${result.stdout}\n${result.stderr}`)
}

export function tcbPlanForRelease(datasetVersion, cloudEnvId, localRoot) {
  const cloudRoot = `housing-data/releases/${datasetVersion}`
  return [
    ['storage', 'detail', `${cloudRoot}/manifest.json`, '--json', '-e', cloudEnvId],
    ['storage', 'upload', resolve(localRoot, 'bootstrap.json'), `${cloudRoot}/bootstrap.json`, '--times', '3', '--json', '-e', cloudEnvId],
    ['storage', 'upload', resolve(localRoot, 'cities'), `${cloudRoot}/cities`, '--times', '3', '--json', '-e', cloudEnvId],
    ['storage', 'upload', resolve(localRoot, 'manifest.json'), `${cloudRoot}/manifest.json`, '--times', '3', '--json', '-e', cloudEnvId],
    ['storage', 'download', `${cloudRoot}/`, '<remote-verify-dir>', '--dir', '--json', '-e', cloudEnvId],
    ['storage', 'upload', '<confirmed-current.json>', 'housing-data/current.json', '--times', '3', '--json', '-e', cloudEnvId],
  ]
}
