import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(directory, "tokens.css");
const source = await readFile(sourcePath, "utf8");
const declarations = [...source.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);\s*$/gim)].map((match) => [match[1], match[2].trim()]);
if (declarations.length < 20) throw new Error("tokens.css 中未找到完整的语义令牌");

const banner = "/* Generated from tokens.css. Run npm run design-tokens:generate after editing the source. */";
const wxss = `${banner}\npage {\n${declarations.map(([name, value]) => `  ${name}: ${value};`).join("\n")}\n}\n`;
const json = `${JSON.stringify(Object.fromEntries(declarations), null, 2)}\n`;
const outputs = [
  [resolve(directory, "tokens.wxss"), wxss],
  [resolve(directory, "tokens.json"), json],
];

if (process.argv.includes("--check")) {
  const mismatches = [];
  for (const [outputPath, expected] of outputs) {
    const actual = await readFile(outputPath, "utf8").catch(() => "");
    if (actual !== expected) mismatches.push(outputPath);
  }
  if (mismatches.length > 0) throw new Error(`设计令牌生成文件不是最新版本：${mismatches.join("、")}`);
  console.log(`Design token outputs are current (${declarations.length} tokens).`);
} else {
  await Promise.all(outputs.map(([outputPath, content]) => writeFile(outputPath, content, "utf8")));
  console.log(`Generated WXSS and JSON from ${declarations.length} design tokens.`);
}
