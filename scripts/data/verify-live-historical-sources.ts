import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { detectOfficialMetadata, parseOfficialHtml, recordKey } from "./official-parser";
import type { ParsedBatch, StandardRecord } from "./types";

const root = resolve(import.meta.dirname, "../..");
const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const requestedMonths = Number(argument("months") ?? "36");
const runId = argument("run-id") ?? `live-${Date.now()}`;
assert(Number.isInteger(requestedMonths) && requestedMonths >= 1 && requestedMonths <= 36, "--months must be an integer from 1 to 36");
assert.match(runId, /^[a-zA-Z0-9._-]+$/, "invalid run id");

const outputRoot = resolve(root, "work/live-historical-source-verification", runId);
const outputPath = resolve(outputRoot, "report.json");

function shiftMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertExactRecords(actual: StandardRecord[], expected: StandardRecord[], label: string): void {
  assert.equal(actual.length, expected.length, `${label}: record count differs`);
  const expectedByKey = new Map(expected.map((record) => [recordKey(record), record]));
  assert.equal(expectedByKey.size, expected.length, `${label}: archived records contain duplicate keys`);
  for (const record of actual) {
    const key = recordKey(record);
    assert.deepEqual(record, expectedByKey.get(key), `${label}: record differs at ${key}`);
    expectedByKey.delete(key);
  }
  assert.equal(expectedByKey.size, 0, `${label}: live page omitted archived records`);
}

async function readArchivedBatch(month: string): Promise<{ path: string; batch: ParsedBatch }> {
  const matches: string[] = [];
  for await (const path of glob(resolve(root, "data/raw", month, "*.batch.json").replaceAll("\\", "/"))) matches.push(path);
  assert.equal(matches.length, 1, `${month}: expected one archived batch, got ${matches.length}`);
  return { path: matches[0], batch: JSON.parse(await readFile(matches[0], "utf8")) as ParsedBatch };
}

async function fetchOfficialPage(url: string): Promise<{ bytes: Buffer; finalUrl: string; status: number; contentType: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "housing-price-index-release-rehearsal/1.0",
        },
      });
      assert.equal(response.status, 200, `official page returned HTTP ${response.status}`);
      const final = new URL(response.url);
      assert(final.hostname === "www.stats.gov.cn" || final.hostname === "stats.gov.cn", `unexpected final host ${final.hostname}`);
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        finalUrl: response.url,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 1_000));
    }
  }
  throw lastError;
}

await mkdir(outputRoot, { recursive: true });
const normalized = JSON.parse(await readFile(resolve(root, "data/normalized/records.json"), "utf8")) as { records: StandardRecord[] };
const latestMonth = [...new Set(normalized.records.map((record) => record.stat_month))].sort().at(-1)!;
const targetMonths = Array.from({ length: requestedMonths }, (_, index) => shiftMonth(latestMonth, index - requestedMonths + 1));
const months: Array<Record<string, unknown>> = [];
const issues: Array<Record<string, unknown>> = [];

for (const month of targetMonths) {
  const startedAt = performance.now();
  try {
    const { path, batch } = await readArchivedBatch(month);
    assert.equal(batch.source_batch.verification_status, "verified", `${month}: archived batch is not verified`);
    const live = await fetchOfficialPage(batch.source_batch.source_url);
    const liveHtml = live.bytes.toString("utf8");
    const metadata = detectOfficialMetadata(liveHtml, batch.source_batch.source_url);
    assert.equal(metadata.statMonth, month, `${month}: live page statistical month differs`);
    assert.equal(metadata.releaseDate, batch.source_batch.release_date, `${month}: live page release date differs from archived batch`);
    const parsed = parseOfficialHtml(liveHtml, batch.source_batch);
    assertExactRecords(parsed.records, batch.records, `${month}: live official reparse`);
    months.push({
      month,
      status: "passed",
      source_url: batch.source_batch.source_url,
      final_url: live.finalUrl,
      http_status: live.status,
      content_type: live.contentType,
      live_content_sha256: sha256(live.bytes),
      archived_content_sha256: batch.source_batch.raw_content_sha256,
      live_bytes_equal_archived: sha256(live.bytes) === batch.source_batch.raw_content_sha256,
      release_date: metadata.releaseDate,
      parsed_records: parsed.records.length,
      exact_archive_match: true,
      archived_batch_path: path.replaceAll("\\", "/"),
      duration_ms: Math.round(performance.now() - startedAt),
    });
    console.log(`Official source ${months.length}/${targetMonths.length} passed: ${month}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    months.push({ month, status: "failed", error: message, duration_ms: Math.round(performance.now() - startedAt) });
    issues.push({ id: `LIVE-SOURCE-${month}`, month, severity: "blocking", problem: message, resolution: "Unresolved; keep the previous dataset and investigate the official source before any replay or publication." });
    break;
  }
}

const status = months.length === targetMonths.length && months.every((month) => month.status === "passed") ? "passed" : "failed";
const report = {
  format: "housing-live-historical-source-verification-v1",
  status,
  run_id: runId,
  requested_months: requestedMonths,
  completed_months: months.filter((month) => month.status === "passed").length,
  first_month: targetMonths[0],
  final_month: targetMonths.at(-1),
  production_untouched: true,
  months,
  issues,
  checked_at: new Date().toISOString(),
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status, completed_months: report.completed_months, issues: issues.length, report: outputPath }));
if (status !== "passed") process.exitCode = 1;
