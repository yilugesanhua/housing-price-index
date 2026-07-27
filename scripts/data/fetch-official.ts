import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { detectOfficialMetadata, sha256, PARSER_VERSION, SCHEMA_VERSION, parseOfficialFile } from "./official-parser";
import type { ParsedBatch, SourceBatch } from "./types";

const gzipAsync = promisify(gzip);

export async function fetchOfficialPage(sourceUrl: string): Promise<ParsedBatch> {
  const maxAttempts = 3;
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetch(sourceUrl, { headers: { "User-Agent": "HousingPriceIndexBot/0.1 (+local development)" }, signal: AbortSignal.timeout(30_000) });
      if (response.ok) break;
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 800));
    }
  }
  if (!response?.ok) throw new Error(`抓取官方页面失败: ${String(lastError)}`);
  const fetchedAt = new Date().toISOString();
  const html = Buffer.from(await response.arrayBuffer());
  const digest = sha256(html);
  const detected = detectOfficialMetadata(html.toString("utf8"), response.url || sourceUrl);
  const archiveDir = resolve("data", "raw", detected.statMonth);
  const archivePath = resolve(archiveDir, `${digest}.html`);
  const sourceBatch: SourceBatch = {
    source_batch_id: `official-html-${detected.statMonth}-${digest.slice(0, 12)}`,
    source_type: "official-html",
    source_url: sourceUrl,
    fetched_at: fetchedAt,
    raw_content_sha256: digest,
    raw_archive_uri: `data/raw/${detected.statMonth}/${digest}.html`,
    parser_version: PARSER_VERSION,
    schema_version: SCHEMA_VERSION,
    verification_status: "sampled",
    verification_method: "parser-structural-check-plus-target-city-sample",
    http_status: response.status,
    final_url: response.url,
    redirect_chain: response.url === sourceUrl ? [] : [sourceUrl, response.url],
    stat_month: detected.statMonth,
    release_date: detected.releaseDate,
  };
  await mkdir(archiveDir, { recursive: true });
  await writeFile(archivePath, html);
  await writeFile(`${archivePath}.gz`, await gzipAsync(html, { level: 9 }));
  const result = await parseOfficialFile(archivePath, sourceBatch);
  await writeFile(resolve(archiveDir, `${digest}.batch.json`), JSON.stringify({ ...result, source_batch: sourceBatch }, null, 2) + "\n", "utf8");
  console.log(`Fetched ${sourceUrl}`);
  console.log(`Archived ${archivePath}`);
  console.log(`Parsed ${result.records.length} target-city records in ${sourceBatch.source_batch_id}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const sourceUrl = process.argv[2];
  if (!sourceUrl) throw new Error("用法: npm run data:fetch -- <official-url>");
  await fetchOfficialPage(sourceUrl);
}
