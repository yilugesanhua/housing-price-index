import { glob, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchOfficialPage } from "./fetch-official";
import type { ParsedBatch } from "./types";

interface DiscoveryFile {
  pages: Array<{ title: string; href: string }>;
}

const discovery = JSON.parse(await readFile(resolve("data", "discovered-official-pages.json"), "utf8")) as DiscoveryFile;
const existingUrls = new Set<string>();
for await (const path of await glob("data/raw/**/*.batch.json")) {
  const batch = JSON.parse(await readFile(path, "utf8")) as ParsedBatch;
  existingUrls.add(batch.source_batch.source_url);
}
const requestedLimit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? "0");
const pending = discovery.pages.filter((page) => !existingUrls.has(page.href));
const selected = requestedLimit > 0 ? pending.slice(0, requestedLimit) : pending;
const errors: Array<{ url: string; error: string; failed_at: string }> = [];
for (const [index, page] of selected.entries()) {
  try {
    console.log(`[${index + 1}/${selected.length}] ${page.title}`);
    await fetchOfficialPage(page.href);
  } catch (error) {
    errors.push({ url: page.href, error: String(error), failed_at: new Date().toISOString() });
    console.error(`Failed ${page.href}: ${String(error)}`);
  }
  if (index + 1 < selected.length) await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
}
await writeFile(resolve("data", "fetch-errors.json"), JSON.stringify({ generated_at: new Date().toISOString(), errors }, null, 2) + "\n", "utf8");
console.log(`Fetched ${selected.length - errors.length}/${selected.length} pending pages; ${errors.length} failed`);
if (errors.length > 0) process.exitCode = 1;

