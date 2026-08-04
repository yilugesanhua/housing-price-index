import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const source = resolve(root, 'apps/miniprogram')
const target = resolve(process.argv[2] || '70城小程序技术验证')
await access(target).catch(() => {
  throw new Error(`微信开发者工具项目目录不存在: ${target}`)
})
for (const name of ['app.js', 'app.json', 'app.wxss', 'package.json', 'sitemap.json', 'pages', 'data', 'styles', 'config', 'utils', 'assets', 'cloudfunctions']) {
  const destination = resolve(target, name)
  await rm(destination, { recursive: true, force: true })
  await cp(resolve(source, name), destination, { recursive: true })
}
await rm(resolve(target, 'miniprogram_npm'), { recursive: true, force: true })
await mkdir(resolve(target, 'miniprogram_npm'), { recursive: true })
await cp(resolve(source, 'miniprogram_npm'), resolve(target, 'miniprogram_npm'), { recursive: true, force: true })
await import('./patch-wx-f2-canvas.mjs')
const project = JSON.parse(await readFile(resolve(source, 'project.config.json'), 'utf8'))
project.projectname = '住房小二'
const targetProjectPath = resolve(target, 'project.config.json')
const targetProjectText = await readFile(targetProjectPath, 'utf8').catch(() => '')
const targetHadFinalNewline = /\r?\n$/.test(targetProjectText)
await writeFile(targetProjectPath, `${JSON.stringify(project, null, 2)}${targetHadFinalNewline ? '\n' : ''}`, 'utf8')
console.log(`Synced formal mini program to ${target}`)
