import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')

for (const [label, path] of [
  ['production', 'apps/miniprogram/cloudfunctions/getHousingDataManifest/index.js'],
  ['preview', 'apps/miniprogram/cloudfunctions/getHousingDataManifestPreview/index.js'],
]) {
  test(`${label} manifest function requires the exact historical revision manifest byte length`, async () => {
    const source = await readFile(resolve(root, path), 'utf8')
    assert.match(source, /expectedBytes\s*=\s*null/u)
    assert.match(source, /fileContent\.length\s*!==\s*expectedBytes/u)
    assert.match(source, /revision_manifest_sha256,\s*manifest\.revision_manifest_bytes/u)
  })
}
