import { glob, readFile, writeFile } from 'node:fs/promises'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync = promisify(gzip)
let count = 0
let sourceBytes = 0
let compressedBytes = 0
for await (const path of await glob('data/raw/**/*.html')) {
  const source = await readFile(path)
  const compressed = await gzipAsync(source, { level: 9 })
  await writeFile(`${path}.gz`, compressed)
  count += 1
  sourceBytes += source.byteLength
  compressedBytes += compressed.byteLength
}
if (count === 0) throw new Error('No raw HTML archives found')
console.log(`Compressed ${count} raw archives: ${sourceBytes} -> ${compressedBytes} bytes`)
