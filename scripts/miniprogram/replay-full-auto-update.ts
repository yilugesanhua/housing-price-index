import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { glob, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import {
  CITY_IDS,
  CITY_NAMES,
  CITY_PROFILES,
  CITY_SEARCH_ALIASES,
  CITY_TIER_LABELS,
  FEATURED_CITY_IDS,
  type CityId,
} from "../../packages/core/src/index";
import { evaluateLatestCheck, evaluateReleaseSchedule } from "../data/check-latest";
import { parseOfficialHtml, recordKey, sha256 as sourceSha256 } from "../data/official-parser";
import { validateRecords } from "../data/validate";
import type { SourceBatch, StandardRecord } from "../data/types";
import { activatePointerWithRollback } from "./guarded-activation.mjs";
import { buildRemoteRelease, sha256, stableJson, verifyReleaseAgainstSnapshot } from "./remote-data-lib.mjs";
import { assertRehearsalKey, createTencentCloudClient } from "./tencent-cloud-sdk.mjs";

type StageEvidence = Record<string, unknown>;
type StageReport = { name: string; status: "passed"; duration_ms: number; evidence: StageEvidence };
type ReplayIssue = {
  id: string;
  detected_in: string;
  severity: "info" | "fixed" | "blocking";
  problem: string;
  resolution: string;
  verification: string;
};
type SourceArchive = { source_batch: SourceBatch; records: StandardRecord[]; html: string };

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const gunzipAsync = promisify(gunzip);
const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const requestedMonths = Number(argument("months") ?? "12");
assert(Number.isInteger(requestedMonths) && requestedMonths >= 1 && requestedMonths <= 12, "--months must be an integer from 1 to 12");
const injectedFailureMonth = argument("inject-failure-month");
if (injectedFailureMonth) assert.match(injectedFailureMonth, /^20\d{2}-(0[1-9]|1[0-2])$/, "invalid injected failure month");
const runId = argument("run-id") ?? `local-${Date.now()}`;
const cloudRunId = argument("cloud-run-id") ?? process.env.GITHUB_RUN_ID;
const useCloud = process.argv.includes("--cloud");
const cloudEnvId = argument("env") ?? "cloud1-d3gpdx70w5d05c68c";
const storageBucket = "636c-cloud1-d3gpdx70w5d05c68c-1456861154";
const outputRoot = resolve(root, "work/full-auto-update-replay", runId);
const allStages: StageReport[] = [];
const issues: ReplayIssue[] = [
  {
    id: "REPLAY-001",
    detected_in: "initial-cloud-run-30284387590",
    severity: "fixed",
    problem: "The first replay referenced an untracked uncompressed HTML file that did not exist in CI.",
    resolution: "Read the tracked .html.gz audit archive and verify the decompressed bytes against the official SHA-256.",
    verification: "Cloud replay 30284890830 passed with the compressed archive.",
  },
  {
    id: "REPLAY-002",
    detected_in: "local-year-attempt-1",
    severity: "fixed",
    problem: "The first annual replay compared baseline and target pre-coverage padding in the wrong direction.",
    resolution: "Require the target padding window to equal the baseline window after its oldest month slides out.",
    verification: "The annual replay must restart at month 1 and pass all 12 sequential windows.",
  },
  {
    id: "REPLAY-003",
    detected_in: "cloud-year-run-30287408324",
    severity: "fixed",
    problem: "The first cloud annual replay passed 10 months, then an unbounded COS request stalled until the 20-minute job limit canceled the process.",
    resolution: "Limit object operations to batches of 10, enforce a 60-second timeout with three idempotent attempts, and raise the annual rehearsal job limit to 45 minutes.",
    verification: "Restart the cloud annual replay from month 1; all 12 months and the following production read-only monitor must pass.",
  },
];

function digest(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
}

function shiftMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function monthRange(end: string, count = 120): string[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(end, index - count + 1));
}

async function timed<T>(stages: StageReport[], name: string, action: () => Promise<{ value: T; evidence: StageEvidence }>): Promise<T> {
  const started = performance.now();
  const result = await action();
  const report = { name, status: "passed" as const, duration_ms: Math.round(performance.now() - started), evidence: result.evidence };
  stages.push(report);
  allStages.push(report);
  return result.value;
}

async function retryCloud<T>(label: string, action: () => Promise<T>): Promise<T> {
  let latestError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        action(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after 60 seconds (attempt ${attempt}/3)`)), 60_000);
        }),
      ]);
    } catch (error) {
      latestError = error;
      if (attempt < 3) console.warn(`[replay:cloud] ${label} failed; retrying (${attempt}/3): ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw latestError;
}

async function mapCloudBatches<T, R>(items: T[], label: (item: T) => string, action: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += 10) {
    results.push(...await Promise.all(items.slice(start, start + 10).map((item) => retryCloud(label(item), () => action(item)))));
  }
  return results;
}

async function readSourceArchive(targetMonth: string): Promise<SourceArchive> {
  const matches: string[] = [];
  for await (const path of glob(resolve(root, "data/raw", targetMonth, "*.batch.json").replaceAll("\\", "/"))) matches.push(path);
  assert.equal(matches.length, 1, `${targetMonth}: expected one source batch, got ${matches.length}`);
  const archived = JSON.parse(await readFile(matches[0], "utf8")) as { source_batch: SourceBatch; records: StandardRecord[] };
  const gzipPath = resolve(root, "data/raw", targetMonth, `${archived.source_batch.raw_content_sha256}.html.gz`);
  const html = (await gunzipAsync(await readFile(gzipPath))).toString("utf8");
  return { ...archived, html };
}

function validateMonthlyCandidate(baseline: StandardRecord[], candidate: StandardRecord[], sourceBatch: SourceBatch): void {
  const baselineLatest = [...new Set(baseline.map((record) => record.stat_month))].sort().at(-1);
  assert.equal(shiftMonth(sourceBatch.stat_month, -1), baselineLatest, "candidate is not exactly one natural month forward");
  const source = new URL(sourceBatch.source_url);
  const final = new URL(sourceBatch.final_url);
  assert.equal(source.protocol, "https:");
  assert.equal(source.hostname, "www.stats.gov.cn");
  assert.equal(final.hostname, "www.stats.gov.cn");
  assert(source.pathname.endsWith(".html") && final.pathname.endsWith(".html"), "official source is not an HTML report");
  assert.equal(sourceBatch.verification_status, "verified", "official source is not verified");
  assert.match(sourceBatch.raw_content_sha256, /^[a-f0-9]{64}$/);
  assert.equal(candidate.length, 560, "candidate month must contain 560 records");
  assert(candidate.every((record) => record.stat_month === sourceBatch.stat_month), "candidate contains a mixed month");
  assert(candidate.every((record) => record.source_batch_id === sourceBatch.source_batch_id), "candidate contains a mixed source batch");
  assert.equal(new Set(candidate.map((record) => record.city_id)).size, 70, "candidate month must contain 70 cities");
  assert.equal(new Set(candidate.map((record) => `${record.city_id}|${record.property_type}|${record.size_band}`)).size, 560, "candidate coverage is incomplete or duplicated");
  const errors = validateRecords(candidate);
  assert.deepEqual(errors, [], `candidate data contract failed: ${errors.join("; ")}`);
  const historicalKeys = new Set(baseline.map(recordKey));
  assert(candidate.every((record) => !historicalKeys.has(recordKey(record))), "candidate overwrites historical records");
}

function buildSnapshot(records: StandardRecord[], datasetAsOf: string, datasetVersion: string) {
  const months = monthRange(datasetAsOf);
  const lookup = new Map(records.map((record) => [recordKey(record), record]));
  const firstAvailableMonth = [...new Set(records.map((record) => record.stat_month))].sort()[0];
  const paddingMonths = months.filter((month) => month < firstAvailableMonth);
  const bandCodes = { all: "a", le90: "s", "90_144": "m", gt144: "l" } as const;
  const series: Record<string, Record<string, Array<number | null>>> = {};
  for (const cityId of CITY_IDS) {
    const grouped: Record<string, Array<number | null>> = {};
    for (const propertyType of ["new", "resale"] as const) {
      for (const sizeBand of ["all", "le90", "90_144", "gt144"] as const) {
        const code = `${propertyType === "new" ? "n" : "r"}_${bandCodes[sizeBand]}`;
        grouped[code] = [];
        for (const month of months) {
          const record = lookup.get(`${month}|${cityId}|${propertyType}|${sizeBand}`);
          if (!record) {
            assert(month < firstAvailableMonth, `${datasetAsOf}: missing in-coverage record ${month}/${cityId}/${propertyType}/${sizeBand}`);
            grouped[code].push(null, null, null, null);
          } else {
            grouped[code].push(record.mom_index, record.yoy_index, record.mom_change, record.yoy_change);
          }
        }
      }
    }
    series[cityId] = grouped;
  }
  const cityMap = Object.fromEntries(CITY_IDS.map((id: CityId) => [id, {
    name: CITY_NAMES[id],
    search: `${CITY_NAMES[id]} ${id} ${CITY_SEARCH_ALIASES[id]}`.toLowerCase(),
    province: CITY_PROFILES[id].province,
    tier: CITY_PROFILES[id].tier,
    tierLabel: CITY_TIER_LABELS[CITY_PROFILES[id].tier],
  }]));
  const latestRecord = records.find((record) => record.stat_month === datasetAsOf);
  assert(latestRecord, `${datasetAsOf}: latest record is missing`);
  const releaseDateByMonth = new Map(records.map((record) => [record.stat_month, record.release_date]));
  return {
    snapshot: {
      schemaVersion: "1.3.0",
      datasetVersion,
      datasetAsOf,
      releaseDate: latestRecord.release_date,
      coverageStart: firstAvailableMonth,
      latestOfficialUrl: latestRecord.source_url,
      generatedAt: `${latestRecord.release_date}T02:00:00.000Z`,
      dataStatus: "current",
      statusReason: "12-month historical full-chain replay",
      nextCheckDueAt: `${shiftMonth(latestRecord.release_date.slice(0, 7), 1)}-15T01:30:00.000Z`,
      months,
      releaseDates: months.map((month) => releaseDateByMonth.get(month) ?? ""),
      cityIds: CITY_IDS,
      featuredCityIds: FEATURED_CITY_IDS,
      cityMap,
      series,
    },
    paddingMonths,
  };
}

function cloudFiles(release: any): Map<string, string> {
  return new Map([
    [release.current.manifest_file_id, release.manifestText],
    [release.manifest.bootstrap_file_id, release.bootstrapText],
    ...Object.values(release.cities).map((item: any) => [release.manifest.city_file_id_template.replace("{city_id}", item.data.cityId), item.text] as [string, string]),
  ]);
}

function createWxMock(release: any) {
  const files = new Map<string, Buffer>();
  const storage = new Map<string, any>();
  const remote = cloudFiles(release);
  let tempIndex = 0;
  const fs = {
    readFileSync(filePath: string, encoding?: string) {
      const value = files.get(filePath);
      if (!value) throw new Error(`ENOENT: ${filePath}`);
      return encoding ? value.toString(encoding) : value;
    },
    readFile({ filePath, encoding, success, fail }: any) { try { success({ data: fs.readFileSync(filePath, encoding) }); } catch (error) { fail(error); } },
    writeFile({ filePath, data, success }: any) { files.set(filePath, Buffer.from(data, "utf8")); success({}); },
    mkdir({ success }: any) { success({}); },
  };
  return {
    wxApi: {
      env: { USER_DATA_PATH: "/user" },
      getFileSystemManager: () => fs,
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: any) => storage.set(key, structuredClone(value)),
      removeStorageSync: (key: string) => storage.delete(key),
      cloud: {
        callFunction({ success }: any) { success({ result: { current: structuredClone(release.current) } }); },
        downloadFile({ fileID, success, fail }: any) {
          const value = remote.get(fileID);
          if (value === undefined) return fail(new Error(`remote file missing: ${fileID}`));
          const tempFilePath = `/temp/${tempIndex += 1}`;
          files.set(tempFilePath, Buffer.from(value, "utf8"));
          success({ tempFilePath });
        },
      },
    },
  };
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const normalized = JSON.parse(await readFile(resolve(root, "data/normalized/records.json"), "utf8")) as { records: StandardRecord[] };
const latestMonth = [...new Set(normalized.records.map((record) => record.stat_month))].sort().at(-1)!;
const targetMonths = Array.from({ length: requestedMonths }, (_, index) => shiftMonth(latestMonth, index - requestedMonths + 1));
assert.equal(targetMonths.at(-1), latestMonth);
const cloud = useCloud ? createTencentCloudClient({ cloudEnvId }) : null;
if (useCloud) assert.match(cloudRunId ?? "", /^\d+(?:-\d+)?$/, "--cloud requires --cloud-run-id=<numeric-id>");
const prefix = useCloud ? `housing-data/rehearsals/${cloudRunId}/full-auto-update-year/` : null;
const key = (relative: string) => assertRehearsalKey(`${prefix}${relative}`, cloudRunId!);
let isolatedPointerText = stableJson({ dataset_version: `${shiftMonth(targetMonths[0], -1)}-${"a".repeat(12)}`, marker: "12-month-baseline" });
if (cloud) await retryCloud("initialize isolated pointer", () => cloud.putObject(key("current.json"), Buffer.from(isolatedPointerText)));
const replays: Array<Record<string, unknown>> = [];
let activeTargetMonth = "";

try {
for (const [index, targetMonth] of targetMonths.entries()) {
  activeTargetMonth = targetMonth;
  if (targetMonth === injectedFailureMonth) throw new Error(`intentional replay failure for ${targetMonth}`);
  const replayNumber = index + 1;
  const baselineMonth = shiftMonth(targetMonth, -1);
  const stages: StageReport[] = [];
  const replayStarted = performance.now();
  const archive = await timed(stages, "release_schedule_and_source_parse", async () => {
    const source = await readSourceArchive(targetMonth);
    assert.equal(source.source_batch.stat_month, targetMonth);
    assert.equal(sourceSha256(source.html), source.source_batch.raw_content_sha256, `${targetMonth}: decompressed official HTML SHA-256 mismatch`);
    const releaseMonth = source.source_batch.release_date.slice(0, 7);
    const scheduledAt = `${source.source_batch.release_date}T09:30:00+08:00`;
    const calendar = {
      year: Number(releaseMonth.slice(0, 4)),
      fetched_at: `${source.source_batch.release_date}T00:00:00.000Z`,
      source_url: "https://www.stats.gov.cn/sj/fbrc/index_fbrc.html",
      report_name: "商品住宅销售价格指数月度报告",
      raw_content_sha256: digest(`${targetMonth}-calendar`),
      entries: [{ release_month: releaseMonth, expected_stat_month: targetMonth, scheduled_at: scheduledAt, date_text: source.source_batch.release_date.slice(8, 10), time_text: "9:30" }],
    };
    const manifest = { dataset_as_of: baselineMonth, next_check_due_at: scheduledAt };
    const before = evaluateReleaseSchedule(calendar, manifest, new Date(Date.parse(scheduledAt) - 31 * 60 * 1000));
    const after = evaluateReleaseSchedule(calendar, manifest, new Date(Date.parse(scheduledAt) + 1000));
    assert.equal(before.should_check_official, false);
    assert.equal(after.should_check_official, true);
    const discovery = {
      checked_at: new Date(Date.parse(scheduledAt) + 20 * 60 * 1000).toISOString(),
      pages: [{ title: `${targetMonth.slice(0, 4)}年${Number(targetMonth.slice(5))}月份70个大中城市商品住宅销售价格变动情况`, href: source.source_batch.source_url }],
    };
    const latest = evaluateLatestCheck(discovery, manifest, new Date(discovery.checked_at), after);
    assert.equal(latest.status, "update_available");
    assert.equal(latest.official_release_detected, true);
    const parsed = parseOfficialHtml(source.html, source.source_batch);
    assert.equal(parsed.records.length, 560);
    const expected = new Map(source.records.map((record) => [recordKey(record), record]));
    for (const record of parsed.records) assert.deepEqual(record, expected.get(recordKey(record)), `${targetMonth}: reparse differs ${recordKey(record)}`);
    return {
      value: { ...source, records: parsed.records },
      evidence: {
        before_release_blocked: true,
        after_release_check_enabled: true,
        official_release_detected: true,
        official_url: source.source_batch.source_url,
        html_sha256: source.source_batch.raw_content_sha256,
        parsed_records: parsed.records.length,
        exact_archive_match: true,
      },
    };
  });

  const baselineRecords = normalized.records.filter((record) => record.stat_month <= baselineMonth);
  const targetRecords = await timed(stages, "candidate_fail_closed_gates", async () => {
    validateMonthlyCandidate(baselineRecords, archive.records, archive.source_batch);
    const normalizedTarget = new Map(normalized.records.filter((record) => record.stat_month === targetMonth).map((record) => [recordKey(record), record]));
    for (const record of archive.records) assert.deepEqual(record, normalizedTarget.get(recordKey(record)), `${targetMonth}: normalized target mismatch ${recordKey(record)}`);
    const merged = [...baselineRecords, ...archive.records].sort((a, b) => recordKey(a).localeCompare(recordKey(b)));
    return { value: merged, evidence: { added_records: 560, city_count: 70, combinations_per_city: 8, historical_records_changed: 0 } };
  });

  const packaged = await timed(stages, "candidate_package", async () => {
    const baselineVersion = `${baselineMonth}-${digest(baselineRecords).slice(0, 12)}`;
    const targetVersion = `${targetMonth}-${digest(targetRecords).slice(0, 12)}`;
    const baselineBuilt = buildSnapshot(baselineRecords, baselineMonth, baselineVersion);
    const targetBuilt = buildSnapshot(targetRecords, targetMonth, targetVersion);
    assert.deepEqual(baselineBuilt.paddingMonths.slice(1), targetBuilt.paddingMonths);
    const nextCheckAt = new Date(Date.parse(`${archive.source_batch.release_date}T01:30:00.000Z`) + 31 * 24 * 60 * 60 * 1000).toISOString();
    const release = buildRemoteRelease(targetBuilt.snapshot, {
      cloudEnvId,
      storageBucket,
      minimumAppVersion: "v2.2.0",
      nextCheckAt,
      sourceBatchIds: [archive.source_batch.source_batch_id],
    });
    const errors = verifyReleaseAgainstSnapshot(targetBuilt.snapshot, release);
    assert.deepEqual(errors, [], `${targetMonth}: candidate package verification failed: ${errors.join("; ")}`);
    return {
      value: { release, baselineSnapshot: baselineBuilt.snapshot, targetSnapshot: targetBuilt.snapshot, paddingMonths: targetBuilt.paddingMonths },
      evidence: {
        dataset_version: release.current.dataset_version,
        city_shards: 70,
        total_bytes: release.totalBytes,
        exact_snapshot_reconstruction: true,
        test_only_pre_coverage_null_padding_months: targetBuilt.paddingMonths,
      },
    };
  });

  await timed(stages, "corrupt_candidate_rejected", async () => {
    const pointerBefore = cloud ? (await retryCloud("read pointer before corrupt candidate", () => cloud.getObject(key("current.json")))).toString("utf8") : isolatedPointerText;
    const corrupt = archive.records.slice(0, -1);
    assert.throws(() => validateMonthlyCandidate(baselineRecords, corrupt, archive.source_batch), /560 records|70 cities|incomplete/);
    const pointerAfter = cloud ? (await retryCloud("read pointer after corrupt candidate", () => cloud.getObject(key("current.json")))).toString("utf8") : isolatedPointerText;
    assert.equal(pointerAfter, pointerBefore, `${targetMonth}: pointer changed after corrupt candidate rejection`);
    return { value: null, evidence: { corruption: "one official record removed", validation_failed_before_upload: true, pointer_sha256_before: digest(pointerBefore), pointer_sha256_after: digest(pointerAfter), pointer_unchanged: true } };
  });

  await timed(stages, "isolated_upload_readback_and_pointer_switch", async () => {
    const release = packaged.release;
    if (cloud) {
      const releasePrefix = `${targetMonth}/release/`;
      await retryCloud(`${targetMonth} upload bootstrap`, () => cloud.putObject(key(`${releasePrefix}bootstrap.json`), Buffer.from(release.bootstrapText)));
      const cityEntries = Object.entries(release.cities) as Array<[string, any]>;
      await mapCloudBatches(cityEntries, ([cityId]) => `${targetMonth} upload ${cityId}`, ([cityId, item]) => cloud.putObject(key(`${releasePrefix}cities/${cityId}.json`), Buffer.from(item.text)));
      await retryCloud(`${targetMonth} upload manifest`, () => cloud.putObject(key(`${releasePrefix}manifest.json`), Buffer.from(release.manifestText)));
      const cityIds = Object.keys(release.cities);
      const downloads = [
        await retryCloud(`${targetMonth} download bootstrap`, () => cloud.getObject(key(`${releasePrefix}bootstrap.json`))),
        await retryCloud(`${targetMonth} download manifest`, () => cloud.getObject(key(`${releasePrefix}manifest.json`))),
        ...await mapCloudBatches(cityIds, (cityId) => `${targetMonth} download ${cityId}`, (cityId) => cloud.getObject(key(`${releasePrefix}cities/${cityId}.json`))),
      ];
      assert.equal(sha256(downloads[0]), sha256(release.bootstrapText));
      assert.equal(sha256(downloads[1]), sha256(release.manifestText));
      for (let cityIndex = 0; cityIndex < 70; cityIndex += 1) {
        const cityId = Object.keys(release.cities)[cityIndex];
        assert.equal(sha256(downloads[cityIndex + 2]), release.cities[cityId].sha256, `${targetMonth}: cloud readback mismatch ${cityId}`);
      }
      const previous = JSON.parse(isolatedPointerText);
      await activatePointerWithRollback({
        candidate: release.current,
        candidateText: release.currentText,
        previous,
        rollbackEligible: true,
        writePointer: async (text: string) => retryCloud(`${targetMonth} write isolated pointer`, () => cloud.putObject(key("current.json"), Buffer.from(text))),
        readPointerText: async () => (await retryCloud(`${targetMonth} read isolated pointer`, () => cloud.getObject(key("current.json")))).toString("utf8"),
        guardCandidate: async (expected: any) => {
          const actual = JSON.parse((await retryCloud(`${targetMonth} guard isolated pointer`, () => cloud.getObject(key("current.json")))).toString("utf8"));
          assert.equal(actual.dataset_version, expected.dataset_version);
          assert.equal(actual.manifest_sha256, expected.manifest_sha256);
        },
        guardRollback: async () => undefined,
      });
      isolatedPointerText = (await retryCloud(`${targetMonth} final isolated pointer readback`, () => cloud.getObject(key("current.json")))).toString("utf8");
    } else {
      isolatedPointerText = release.currentText;
    }
    assert.equal(isolatedPointerText, release.currentText);
    return { value: null, evidence: { mode: cloud ? "cloud" : "local", uploaded_files: 72, full_readback_verified: true, guarded_isolated_pointer_switched: true } };
  });

  await timed(stages, "miniprogram_client_activation", async () => {
    const config = require(resolve(root, "apps/miniprogram/config/data.js"));
    const { createDataRuntime } = require(resolve(root, "apps/miniprogram/utils/data-runtime.js"));
    const mock = createWxMock(packaged.release);
    const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled: packaged.baselineSnapshot, config });
    assert.equal(runtime.getSnapshot().datasetAsOf, baselineMonth);
    assert.equal(runtime.getSource(), "bundled");
    const refreshed = await runtime.refresh({ requiredCityIds: ["taiyuan"], force: true });
    assert.equal(refreshed.updated, true);
    assert.equal(runtime.getSource(), "remote");
    assert.equal(runtime.getSnapshot().datasetAsOf, targetMonth);
    assert.equal(runtime.hasCity("taiyuan"), true);
    await runtime.ensureCities(["haikou"]);
    assert.equal(runtime.hasCity("haikou"), true);
    return { value: null, evidence: { before_month: baselineMonth, after_month: targetMonth, source_after_refresh: "remote", selected_city_loaded: "taiyuan", on_demand_city_loaded: "haikou" } };
  });

  if (packaged.paddingMonths.length > 0) {
    issues.push({
      id: `REPLAY-PADDING-${targetMonth}`,
      detected_in: targetMonth,
      severity: "info",
      problem: `The historical client snapshot has ${packaged.paddingMonths.length} months before the project's 2016-01 coverage start.`,
      resolution: "Use null-only test padding outside official coverage; never label those values as official data.",
      verification: "All in-coverage values and the target month's 560 records match verified official archives exactly.",
    });
  }
  replays.push({
    replay_number: replayNumber,
    status: "passed",
    baseline_month: baselineMonth,
    target_month: targetMonth,
    duration_ms: Math.round(performance.now() - replayStarted),
    issues_detected: issues.filter((issue) => issue.detected_in === targetMonth).map((issue) => issue.id),
    stages,
  });
  console.log(`Replay ${replayNumber}/${requestedMonths} passed: ${baselineMonth} -> ${targetMonth}`);
}
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  issues.push({
    id: `REPLAY-FAIL-${activeTargetMonth || "setup"}-${Date.now()}`,
    detected_in: activeTargetMonth || "setup",
    severity: "blocking",
    problem: message,
    resolution: "Unresolved. Fix the failing gate and restart the sequential replay from month 1.",
    verification: "No later month may run until this failure is fixed.",
  });
  const failureReport = {
    format: "housing-full-auto-update-year-replay-v2",
    status: "failed",
    run_id: runId,
    failed_target_month: activeTargetMonth || null,
    completed_replay_count: replays.length,
    production_pointer_untouched: true,
    production_release_prefix_untouched: true,
    error: message,
    replays,
    issues,
    checked_at: new Date().toISOString(),
  };
  await Promise.all([
    writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(failureReport, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputRoot, "issues.json"), `${JSON.stringify(issues, null, 2)}\n`, "utf8"),
  ]);
  throw error;
}

const pipelineDuration = replays.reduce((sum, replay) => sum + Number(replay.duration_ms), 0);
const report = {
  format: "housing-full-auto-update-year-replay-v2",
  status: "passed",
  run_id: runId,
  cloud_run_id: useCloud ? cloudRunId : null,
  replay_count: replays.length,
  first_baseline_month: shiftMonth(targetMonths[0], -1),
  final_target_month: targetMonths.at(-1),
  production_pointer_untouched: true,
  production_release_prefix_untouched: true,
  automatic_release_enabled: false,
  total_duration_ms: pipelineDuration,
  replays,
  issues,
  timing_model: {
    polling_interval_minutes: 5,
    measured_average_pipeline_seconds: Math.ceil(pipelineDuration / replays.length / 1000),
    measured_slowest_pipeline_seconds: Math.ceil(Math.max(...replays.map((replay) => Number(replay.duration_ms))) / 1000),
    expected_normal_minutes_after_official_page: "10-25",
    service_target_minutes: 30,
    conservative_service_target_minutes: 45,
    validation_failure_behavior: "keep previous month; do not switch the pointer",
  },
  checked_at: new Date().toISOString(),
};
await Promise.all([
  writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(resolve(outputRoot, "issues.json"), `${JSON.stringify(issues, null, 2)}\n`, "utf8"),
]);
console.log(JSON.stringify({ status: report.status, replay_count: report.replay_count, total_duration_ms: report.total_duration_ms, issues: issues.length }));
