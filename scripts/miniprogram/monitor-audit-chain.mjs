import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import {
  migrationAuditFileName,
  migrationDescriptor,
  validateMigrationAuditTransition,
} from './legacy-control-migration.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(`Monitor audit chain rejected: ${message}`)
}

export async function loadExplicitMigrationAudit({
  root,
  directory,
  datasetVersion,
  sourceDatasetVersion,
  manifestSha256,
  cloudEnvId,
  storageBucket,
} = {}) {
  assert(typeof root === 'string' && root, 'repository root is missing')
  assert(typeof directory === 'string' && directory && !isAbsolute(directory), 'migration audit directory must be repository-relative')

  const workRoot = resolve(root, 'work/control-migrations')
  const auditRoot = resolve(root, directory)
  const relativePath = relative(workRoot, auditRoot)
  assert(relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath), 'migration audit directory is outside work/control-migrations')
  const pathParts = relativePath.split(sep)
  assert(pathParts.length === 2 && pathParts[1] === 'immutable-audit', 'migration audit directory has an invalid layout')

  const migrationId = pathParts[0]
  const descriptor = migrationDescriptor(migrationId)
  assert(descriptor.dataset_version === datasetVersion, 'migration audit directory targets a different dataset')

  const directoryStat = await lstat(auditRoot)
  assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), 'migration audit path is not a real directory')
  assert(relative(auditRoot, await realpath(auditRoot)) === '', 'migration audit directory resolves through a symbolic link')

  const entries = await readdir(auditRoot, { withFileTypes: true })
  assert(entries.length === 1, 'migration audit directory must contain exactly one file')
  const entry = entries[0]
  assert(entry.isFile() && !entry.isSymbolicLink(), 'migration audit entry must be a regular file')
  assert(/^legacy-control-migration-.+\.json$/.test(entry.name), 'migration audit filename is invalid')

  const filePath = resolve(auditRoot, entry.name)
  assert(relative(auditRoot, filePath) === entry.name, 'migration audit file escapes its directory')
  const text = await readFile(filePath, 'utf8')
  let audit
  try {
    audit = JSON.parse(text)
  } catch (_) {
    throw new Error('Monitor audit chain rejected: migration audit is not JSON')
  }
  assert(audit?.migration_id === migrationId, 'migration audit ID differs from its directory')
  assert(entry.name === migrationAuditFileName(audit), 'migration audit filename is not canonical')
  validateMigrationAuditTransition(audit, {
    datasetVersion,
    sourceDatasetVersion,
    manifestSha256,
    cloudEnvId,
    storageBucket,
  })
  return { audit, fileName: entry.name, text }
}

export function mergeMigrationAuditEntries(repositoryEntries = [], explicitEntries = []) {
  assert(Array.isArray(repositoryEntries) && Array.isArray(explicitEntries), 'migration audit entry lists are invalid')
  const merged = new Map()
  for (const entry of [...repositoryEntries, ...explicitEntries]) {
    assert(entry && typeof entry.fileName === 'string' && typeof entry.text === 'string' && entry.audit, 'migration audit entry is invalid')
    const previous = merged.get(entry.fileName)
    if (previous) {
      assert(previous.text === entry.text, `migration audit bytes conflict for ${entry.fileName}`)
      continue
    }
    merged.set(entry.fileName, entry)
  }
  return [...merged.values()].sort((left, right) => left.fileName.localeCompare(right.fileName, 'en'))
}

export function assertMonitorPointerStable(initialText, finalText) {
  assert(typeof initialText === 'string' && typeof finalText === 'string', 'monitor pointer bytes are unavailable')
  assert(finalText === initialText, 'production pointer changed during the monitor run')
  return true
}
