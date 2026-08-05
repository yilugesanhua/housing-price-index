import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { loadValidatedAuditEvidence } from './audit-evidence.mjs'
import { verifyCompleteRemoteRelease } from './complete-remote-data.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const versionConfig = require(resolve(root, 'apps/miniprogram/config/version.js'))
const explicitDir = process.argv.find((argument) => argument.startsWith('--dir='))?.slice('--dir='.length)
const latest = explicitDir ? null : JSON.parse(await readFile(resolve(root, 'work/miniprogram-complete-data/latest-candidate.json'), 'utf8'))
const inputRoot = resolve(root, explicitDir || `work/miniprogram-complete-data/${latest.dataset_version}`)
const sourceSnapshot = JSON.parse(await readFile(resolve(root, 'work/miniprogram-data-input/complete-snapshot.json'), 'utf8'))
const completeSnapshotText = await readFile(resolve(inputRoot, 'complete-snapshot.json'), 'utf8')
const manifestText = await readFile(resolve(inputRoot, 'manifest.json'), 'utf8')
const currentText = await readFile(resolve(inputRoot, 'current.candidate.json'), 'utf8')
const release = {
  completeSnapshot: JSON.parse(completeSnapshotText),
  completeSnapshotText,
  manifest: JSON.parse(manifestText),
  manifestText,
  current: JSON.parse(currentText),
  currentText,
}
const errors = verifyCompleteRemoteRelease(sourceSnapshot, release)
const publishedManifest = JSON.parse(await readFile(resolve(root, 'apps/web/public/data/manifest.json'), 'utf8'))
const { identity: auditIdentity } = await loadValidatedAuditEvidence(root, {
  expectedParserVersion: publishedManifest.parser_version,
  expectedCoverageEnd: release.manifest.dataset_as_of,
})
if (release.manifest.minimum_app_version !== versionConfig.version) errors.push('complete minimum app version differs from the current client')
if (release.manifest.audit_version !== auditIdentity.auditVersion || release.manifest.audit_method !== auditIdentity.auditMethod || release.manifest.audit_repository_commit_sha !== auditIdentity.repositoryCommitSha || release.manifest.audit_code_sha256 !== auditIdentity.auditCodeSha256 || release.manifest.audit_report_sha256 !== auditIdentity.reportSha256) errors.push('complete audit identity differs from the current verified report')
if (JSON.stringify(release.manifest.parser_versions) !== JSON.stringify(auditIdentity.parserVersions) || release.manifest.source_records_sha256 !== auditIdentity.recordsSha256 || release.manifest.source_index_sha256 !== auditIdentity.sourceIndexSha256) errors.push('complete source identity differs from the current verified report')
if (errors.length) throw new Error(`Complete remote release verification failed:\n- ${errors.join('\n- ')}`)
console.log(`Verified ${release.manifest.dataset_version}: one complete ${release.manifest.month_count}-month data file, ${release.manifest.complete_snapshot_bytes} bytes`)
