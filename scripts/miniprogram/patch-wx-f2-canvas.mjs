import { access, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const devtoolsProject = resolve(root, process.argv[2] || '70城小程序技术验证')
const targets = [
  { path: resolve(root, 'node_modules/@antv/wx-f2/src/index.js'), required: true },
  { path: resolve(root, 'node_modules/@antv/wx-f2/dist/index.js'), required: true },
  { path: resolve(root, 'apps/miniprogram/miniprogram_npm/@antv/wx-f2/index.js'), required: true },
  { path: resolve(devtoolsProject, 'node_modules/@antv/wx-f2/src/index.js'), required: false },
  { path: resolve(devtoolsProject, 'node_modules/@antv/wx-f2/dist/index.js'), required: false },
]

const originalPattern = /^([ \t]*)const pixelRatio = wx\.getSystemInfoSync\(\)\.pixelRatio;\r?\n[ \t]*\/\/[^\r\n]*\r?\n[ \t]*node\.width = width \* pixelRatio;\r?\n[ \t]*node\.height = height \* pixelRatio;\r?\n\r?\n[ \t]*const config = \{ context, width, height, pixelRatio \};/m
const logicalCanvasPattern = /^([ \t]*)const pixelRatio = 1;\r?\n[ \t]*node\.width = width;\r?\n[ \t]*node\.height = height;/m
const highDpiCanvasPattern = /^([ \t]*)const pixelRatio = wx\.getSystemInfoSync\(\)\.pixelRatio \|\| 1;\r?\n[ \t]*node\.width = width \* pixelRatio;\r?\n[ \t]*node\.height = height \* pixelRatio;/m
const resetTransformPattern = /context\.setTransform\(1, 0, 0, 1, 0, 0\)/
const chartGuardPattern = /const \{ node, width, height \} = res\[0\];\r?\n([ \t]*)const context = node\.getContext\('2d'\);/
const illegalOnInitPattern = /(onInit:\s*\{\s*type:\s*)'Function'/
const compatibleOnInitPattern = /onInit:\s*\{\s*type:\s*null/

function replacement(indent) {
  return `${indent}// Reset the matrix before F2 applies the device pixel ratio.
${indent}const pixelRatio = wx.getSystemInfoSync().pixelRatio || 1;
${indent}node.width = width * pixelRatio;
${indent}node.height = height * pixelRatio;
${indent}if (typeof context.setTransform === 'function') {
${indent}  context.setTransform(1, 0, 0, 1, 0, 0);
${indent}}

${indent}const config = { context, width, height, pixelRatio };`
}

for (const target of targets) {
  const { path } = target
  const relativePath = path.startsWith(`${root}\\`) ? path.slice(root.length + 1) : path
  const exists = await access(path).then(() => true, () => false)
  if (!exists && !target.required) {
    console.log(`Skipped missing optional target: ${relativePath}`)
    continue
  }
  const source = await readFile(path, 'utf8')
  if (highDpiCanvasPattern.test(source) && resetTransformPattern.test(source) && /if \(this\.chart\) return;/.test(source) && compatibleOnInitPattern.test(source)) {
    console.log(`Already patched: ${relativePath}`)
    continue
  }
  let patched
  if (highDpiCanvasPattern.test(source)) {
    patched = source
  } else if (logicalCanvasPattern.test(source)) {
    patched = source.replace(
      logicalCanvasPattern,
      (_, indent) => `${indent}const pixelRatio = wx.getSystemInfoSync().pixelRatio || 1;
${indent}node.width = width * pixelRatio;
${indent}node.height = height * pixelRatio;
${indent}if (typeof context.setTransform === 'function') {
${indent}  context.setTransform(1, 0, 0, 1, 0, 0);
${indent}}`,
    )
  } else if (originalPattern.test(source)) {
    patched = source.replace(originalPattern, (_, indent) => replacement(indent))
  } else {
    throw new Error(`Unsupported @antv/wx-f2 wrapper in ${relativePath}`)
  }
  if (!resetTransformPattern.test(patched)) {
    patched = patched.replace(/([ \t]*)node\.height = height(?: \* pixelRatio)?;/, '$&\n$1if (typeof context.setTransform === \'function\') {\n$1  context.setTransform(1, 0, 0, 1, 0, 0);\n$1}')
  }
  if (!/if \(this\.chart\) return;/.test(patched)) {
    patched = patched.replace(chartGuardPattern, (_, indent) => `const { node, width, height } = res[0];
${indent}if (this.chart) return;
${indent}const context = node.getContext('2d');`)
  }
  if (illegalOnInitPattern.test(patched)) {
    patched = patched.replace(illegalOnInitPattern, '$1null')
  }
  if (!compatibleOnInitPattern.test(patched)) {
    throw new Error(`Unsupported @antv/wx-f2 onInit property in ${relativePath}`)
  }
  await writeFile(path, patched, 'utf8')
  console.log(`Patched: ${relativePath}`)
}
