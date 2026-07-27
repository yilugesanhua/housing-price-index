import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const searchPath = process.argv[2];
if (!searchPath) throw new Error("用法: npm run data:import-search -- <AnySearch结果文件>");
const text = await readFile(searchPath, "utf8");
const blocks = text.split(/^## Query \d+:/m).slice(1);
const pages: Array<{ title: string; href: string }> = [];
const missing: string[] = [];
for (const block of blocks) {
  const queryLine = block.split("\n", 1)[0];
  const month = queryLine.match(/(20\d{2})年(\d{1,2})月份/)?.slice(1, 3);
  if (!month) continue;
  const prefix = `${month[0]}年${month[1]}月份70个大中城市`;
  const results = [...block.matchAll(/^### \d+\. (.+)\r?\n- \*\*URL\*\*: (https:\/\/www\.stats\.gov\.cn\/sj\/zxfb\/[^\s]+\.html)/gm)].map((match) => ({ title: match[1].trim(), href: match[2].trim() }));
  const match = results.find((item) => item.title.includes(prefix) && item.title.includes("住宅销售价格") && item.title.includes("变动情况"));
  if (match) pages.push(match); else missing.push(`${month[0]}-${month[1].padStart(2, "0")}`);
}
const existingPath = resolve("data", "discovered-official-pages.json");
const existing = JSON.parse(await readFile(existingPath, "utf8")) as { pages: Array<{ title: string; href: string }>; [key: string]: unknown };
const merged = [...new Map([...existing.pages, ...pages].map((item) => [`${item.title}|${item.href}`, item])).values()].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
await writeFile(existingPath, JSON.stringify({ ...existing, historical_search_imported_at: new Date().toISOString(), historical_search_source: "AnySearch exact-title official-domain search", historical_search_missing: missing, pages: merged }, null, 2) + "\n", "utf8");
console.log(`Imported ${pages.length} historical official URLs; ${missing.length} months unresolved; total ${merged.length}`);
if (missing.length > 0) console.log(`Unresolved: ${missing.join(", ")}`);

