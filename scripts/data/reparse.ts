import { globSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { detectOfficialMetadata, PARSER_VERSION, parseOfficialHtml } from "./official-parser";
import { readRawArchiveSync } from "./raw-archive";
import type { ParsedBatch } from "./types";

const requestedPath = process.argv[2];
const paths = requestedPath ? [requestedPath] : globSync("data/raw/**/*.batch.json");
if (paths.length === 0) throw new Error("No raw source batches found for reparse");
let updated = 0;
for (const batchPath of paths) {
  const old = JSON.parse(readFileSync(batchPath, "utf8")) as ParsedBatch;
  const htmlPath = resolve(dirname(batchPath), `${old.source_batch.raw_content_sha256}.html`);
  const html = readRawArchiveSync(htmlPath).toString("utf8");
  const metadata = detectOfficialMetadata(html, old.source_batch.source_url);
  old.source_batch.stat_month = metadata.statMonth;
  old.source_batch.release_date = metadata.releaseDate;
  old.source_batch.parser_version = PARSER_VERSION;
  old.source_batch.verification_status = "unverified";
  old.source_batch.verification_method = "pending-full-record-audit";
  delete old.source_batch.audited_records_sha256;
  const parsed = parseOfficialHtml(html, old.source_batch);
  const temporaryBatchPath = `${batchPath}.tmp`;
  rmSync(temporaryBatchPath, { force: true });
  writeFileSync(temporaryBatchPath, JSON.stringify({ ...parsed, source_batch: old.source_batch }, null, 2) + "\n", "utf8");
  renameSync(temporaryBatchPath, batchPath);
  updated += 1;
  (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
  if (updated % 10 === 0 || updated === paths.length) console.log(`Reparsed ${updated}/${paths.length} batches`);
}
console.log(`Reparsed ${updated} batches`);
