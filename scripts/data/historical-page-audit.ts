import { createHash } from "node:crypto";
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

interface SourceBatch {
  source_batch_id: string;
  stat_month: string;
  source_url: string;
  final_url?: string | null;
  release_date: string;
  raw_content_sha256: string;
}

interface ParsedBatch {
  source_batch: SourceBatch;
}

interface StandardRecord {
  source_batch_id: string;
}

export interface HistoricalPageBaseline {
  source_batch_id: string;
  stat_month: string;
  source_url: string;
  final_url: string | null;
  release_date: string;
  raw_content_sha256: string;
}

export interface RecheckedPage {
  bytes: Buffer;
  final_url: string;
  http_status: number;
  content_type: string;
}

export interface IsolatedRevisionTask {
  format: "housing-isolated-historical-revision-task-v1";
  status: "pending_human_review";
  source_batch_id: string;
  stat_month: string;
  source_url: string;
  previous_final_url: string;
  previous_raw_content_sha256: string;
  observed_raw_content_sha256: string;
  observed_final_url: string;
  observed_http_status: number;
  observed_at: string;
  change_reasons: Array<"redirect" | "content_hash">;
  production_untouched: true;
  next_step: "review_official_page_then_prepare_historical_correction";
}

export interface HistoricalPageAuditReport {
  format: "housing-quarterly-historical-page-audit-v1";
  status: "passed" | "attention_required" | "failed";
  checked_at: string;
  production_untouched: true;
  source_count: number;
  unchanged_count: number;
  changed_count: number;
  failed_count: number;
  entries: Array<Record<string, unknown>>;
  isolated_revision_tasks: IsolatedRevisionTask[];
}

const OFFICIAL_SOURCE_BATCH_ID = /^official-html-20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/;
const OFFICIAL_RELEASE_PATHS = ["/sj/zxfb/", "/xxgk/sjfb/zxfb2020/"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Historical page audit rejected: ${message}`);
}

function canonicalTime(value: string): string {
  assert(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, "checked_at must be canonical ISO 8601");
  return value;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertOfficialUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Historical page audit rejected: ${label} is invalid`);
  }
  assert(url.protocol === "https:" && (url.hostname === "www.stats.gov.cn" || url.hostname === "stats.gov.cn"), `${label} is outside the official host`);
  assert(url.pathname.endsWith(".html") && OFFICIAL_RELEASE_PATHS.some((prefix) => url.pathname.startsWith(prefix)), `${label} is outside the official release allowlist`);
}

function toBaseline(batch: SourceBatch): HistoricalPageBaseline {
  assert(OFFICIAL_SOURCE_BATCH_ID.test(batch.source_batch_id || ""), "source batch ID is invalid");
  assert(/^20\d{2}-(0[1-9]|1[0-2])$/.test(batch.stat_month || "") && batch.source_batch_id.startsWith(`official-html-${batch.stat_month}-`), "source batch month is invalid");
  assertOfficialUrl(batch.source_url, "source URL");
  if (batch.final_url) assertOfficialUrl(batch.final_url, "final URL");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(batch.release_date || ""), "release date is invalid");
  assert(/^[a-f0-9]{64}$/.test(batch.raw_content_sha256 || ""), "archived raw hash is invalid");
  return {
    source_batch_id: batch.source_batch_id,
    stat_month: batch.stat_month,
    source_url: batch.source_url,
    final_url: batch.final_url ?? null,
    release_date: batch.release_date,
    raw_content_sha256: batch.raw_content_sha256,
  };
}

export function selectProductionHistoricalBaselines(records: StandardRecord[], batches: ParsedBatch[]): HistoricalPageBaseline[] {
  const referenced = new Set(records.map((record) => record.source_batch_id).filter(Boolean));
  assert(referenced.size > 0, "current normalized data has no source batch IDs");
  const selected = new Map<string, HistoricalPageBaseline>();
  for (const parsed of batches) {
    const batch = toBaseline(parsed?.source_batch);
    if (!referenced.has(batch.source_batch_id)) continue;
    assert(!selected.has(batch.source_batch_id), `source batch ${batch.source_batch_id} has more than one archive`);
    selected.set(batch.source_batch_id, batch);
  }
  const missing = [...referenced].filter((sourceBatchId) => !selected.has(sourceBatchId)).sort();
  assert(missing.length === 0, `current normalized data has no recoverable batch archive: ${missing.join(", ")}`);
  return [...selected.values()].sort((left, right) => left.source_batch_id.localeCompare(right.source_batch_id, "en"));
}

export async function recheckHistoricalPages({
  baselines,
  checkedAt,
  fetchPage,
}: {
  baselines: HistoricalPageBaseline[];
  checkedAt: string;
  fetchPage: (sourceUrl: string) => Promise<RecheckedPage>;
}): Promise<HistoricalPageAuditReport> {
  canonicalTime(checkedAt);
  assert(Array.isArray(baselines) && baselines.length > 0, "historical source baselines are missing");
  const unique = new Set<string>();
  const entries: Array<Record<string, unknown>> = [];
  const isolatedRevisionTasks: IsolatedRevisionTask[] = [];

  for (const baseline of [...baselines].sort((left, right) => left.source_batch_id.localeCompare(right.source_batch_id, "en"))) {
    assert(!unique.has(baseline.source_batch_id), `duplicate source batch ${baseline.source_batch_id}`);
    unique.add(baseline.source_batch_id);
    toBaseline(baseline);
    try {
      const response = await fetchPage(baseline.source_url);
      assert(response.http_status >= 200 && response.http_status < 300, `${baseline.source_batch_id}: official page returned HTTP ${response.http_status}`);
      assertOfficialUrl(response.final_url, `${baseline.source_batch_id}: final URL`);
      assert(/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.content_type.trim()), `${baseline.source_batch_id}: official response content type is not HTML`);
      assert(Buffer.isBuffer(response.bytes) && response.bytes.length > 0, `${baseline.source_batch_id}: official page body is empty`);
      const observedHash = sha256(response.bytes);
      const common = {
        source_batch_id: baseline.source_batch_id,
        stat_month: baseline.stat_month,
        source_url: baseline.source_url,
        archived_final_url: baseline.final_url ?? baseline.source_url,
        archived_raw_content_sha256: baseline.raw_content_sha256,
        observed_raw_content_sha256: observedHash,
        observed_final_url: response.final_url,
        observed_http_status: response.http_status,
        observed_content_type: response.content_type,
      };
      const previousFinalUrl = baseline.final_url ?? baseline.source_url;
      const changeReasons: Array<"redirect" | "content_hash"> = [];
      if (response.final_url !== previousFinalUrl) changeReasons.push("redirect");
      if (observedHash !== baseline.raw_content_sha256) changeReasons.push("content_hash");
      if (changeReasons.length === 0) {
        entries.push({ ...common, status: "unchanged" });
        continue;
      }
      const task: IsolatedRevisionTask = {
        format: "housing-isolated-historical-revision-task-v1",
        status: "pending_human_review",
        source_batch_id: baseline.source_batch_id,
        stat_month: baseline.stat_month,
        source_url: baseline.source_url,
        previous_final_url: previousFinalUrl,
        previous_raw_content_sha256: baseline.raw_content_sha256,
        observed_raw_content_sha256: observedHash,
        observed_final_url: response.final_url,
        observed_http_status: response.http_status,
        observed_at: checkedAt,
        change_reasons: changeReasons,
        production_untouched: true,
        next_step: "review_official_page_then_prepare_historical_correction",
      };
      isolatedRevisionTasks.push(task);
      entries.push({ ...common, status: "changed", change_reasons: changeReasons, isolated_revision_task: task });
    } catch (error) {
      entries.push({
        source_batch_id: baseline.source_batch_id,
        stat_month: baseline.stat_month,
        source_url: baseline.source_url,
        archived_raw_content_sha256: baseline.raw_content_sha256,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const unchangedCount = entries.filter((entry) => entry.status === "unchanged").length;
  const changedCount = entries.filter((entry) => entry.status === "changed").length;
  const failedCount = entries.filter((entry) => entry.status === "failed").length;
  return {
    format: "housing-quarterly-historical-page-audit-v1",
    status: failedCount > 0 ? "failed" : changedCount > 0 ? "attention_required" : "passed",
    checked_at: checkedAt,
    production_untouched: true,
    source_count: baselines.length,
    unchanged_count: unchangedCount,
    changed_count: changedCount,
    failed_count: failedCount,
    entries,
    isolated_revision_tasks: isolatedRevisionTasks,
  };
}

async function fetchOfficialPage(sourceUrl: string): Promise<RecheckedPage> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(sourceUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "HousingPriceIndexHistoricalAudit/1.0",
        },
      });
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        final_url: response.url,
        http_status: response.status,
        content_type: response.headers.get("content-type") ?? "",
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1_000));
    }
  }
  throw lastError;
}

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function assertWorkOutput(root: string, outputRoot: string): void {
  const workRoot = resolve(root, "work");
  const resolved = resolve(outputRoot);
  assert(resolved === workRoot || resolved.startsWith(`${workRoot}\\`) || resolved.startsWith(`${workRoot}/`), "output must stay under work/");
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "../..");
  const runId = argument("run-id") ?? `quarterly-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  assert(/^[a-zA-Z0-9._-]+$/.test(runId), "run ID is invalid");
  const outputRoot = resolve(root, argument("output-root") ?? `work/quarterly-historical-page-audit/${runId}`);
  assertWorkOutput(root, outputRoot);
  const records = JSON.parse(await readFile(resolve(root, "data/normalized/records.json"), "utf8")) as { records: StandardRecord[] };
  const batchPaths: string[] = [];
  for await (const path of glob(resolve(root, "data/raw/**/*.batch.json").replaceAll("\\", "/"))) batchPaths.push(path);
  const batches = await Promise.all(batchPaths.sort().map(async (path) => JSON.parse(await readFile(path, "utf8")) as ParsedBatch));
  const report = await recheckHistoricalPages({
    baselines: selectProductionHistoricalBaselines(records.records, batches),
    checkedAt: new Date().toISOString(),
    fetchPage: fetchOfficialPage,
  });
  await mkdir(resolve(outputRoot, "isolated-revision-tasks"), { recursive: true });
  await Promise.all(report.isolated_revision_tasks.map((task) => writeFile(
    resolve(outputRoot, "isolated-revision-tasks", `${task.source_batch_id}.json`),
    `${JSON.stringify(task, null, 2)}\n`,
    "utf8",
  )));
  await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify({
    ...report,
    source_archive_root: relative(root, resolve(root, "data/raw")).replaceAll("\\", "/"),
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: report.status, source_count: report.source_count, changed_count: report.changed_count, failed_count: report.failed_count, output: outputRoot }));
  if (report.status !== "passed") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) await main();
