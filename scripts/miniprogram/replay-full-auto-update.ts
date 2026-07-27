import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CITY_IDS, CITY_NAMES, CITY_PROFILES, CITY_SEARCH_ALIASES, CITY_TIER_LABELS, FEATURED_CITY_IDS, type CityId } from "../../packages/core/src/index";
import { evaluateLatestCheck, evaluateReleaseSchedule } from "../data/check-latest";
import { parseOfficialHtml, recordKey, sha256 as sourceSha256 } from "../data/official-parser";
import { validateRecords } from "../data/validate";
import type { SourceBatch, StandardRecord } from "../data/types";
import { buildRemoteRelease, sha256, stableJson, verifyReleaseAgainstSnapshot } from "./remote-data-lib.mjs";
import { assertRehearsalKey, createTencentCloudClient } from "./tencent-cloud-sdk.mjs";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const runId = argument("run-id") ?? `local-${Date.now()}`;
const cloudRunId = argument("cloud-run-id") ?? process.env.GITHUB_RUN_ID;
const useCloud = process.argv.includes("--cloud");
const cloudEnvId = argument("env") ?? "cloud1-d3gpdx70w5d05c68c";
const outputRoot = resolve(root, "work/full-auto-update-replay", runId);
const officialUrl = "https://www.stats.gov.cn/sj/zxfb/202607/t20260715_1964115.html";
const rawHash = "4bb4edcce2610ec0651109a18a5bf620b762972ab7309e4bdec62a52e57f678c";
const rawPath = resolve(root, "data/raw/2026-06", `${rawHash}.html`);
const batchPath = resolve(root, "data/raw/2026-06", `${rawHash}.batch.json`);
const stages: Array<{ name: string; status: "passed"; duration_ms: number; evidence: Record<string, unknown> }> = [];

async function stage<T>(name: string, action: () => Promise<{ value: T; evidence: Record<string, unknown> }>): Promise<T> {
  const started = performance.now();
  const result = await action();
  stages.push({ name, status: "passed", duration_ms: Math.round(performance.now() - started), evidence: result.evidence });
  return result.value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
}

function previousMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function monthRange(end: string, count = 120): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(`${end}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - (count - 1 - index));
    return date.toISOString().slice(0, 7);
  });
}

function validateMonthlyCandidate(baseline: StandardRecord[], candidateMonth: StandardRecord[], sourceBatch: SourceBatch): void {
  assert.equal(sourceBatch.source_url, officialUrl, "official source URL changed");
  assert.equal(sourceBatch.final_url, officialUrl, "official final URL changed");
  assert.equal(sourceBatch.raw_content_sha256, rawHash, "official source hash changed");
  assert.equal(sourceBatch.verification_status, "verified", "official source is not verified");
  const baselineLatest = [...new Set(baseline.map((record) => record.stat_month))].sort().at(-1);
  assert.equal(baselineLatest, "2026-05");
  assert.equal(sourceBatch.stat_month, "2026-06");
  assert.equal(previousMonth(sourceBatch.stat_month), baselineLatest, "candidate is not exactly one natural month forward");
  assert.equal(candidateMonth.length, 560, "candidate month must contain 560 records");
  assert.equal(new Set(candidateMonth.map((record) => record.city_id)).size, 70, "candidate month must contain 70 cities");
  assert.equal(new Set(candidateMonth.map((record) => `${record.city_id}|${record.property_type}|${record.size_band}`)).size, 560, "candidate coverage is incomplete or duplicated");
  const errors = validateRecords(candidateMonth);
  assert.deepEqual(errors, [], `candidate data contract failed: ${errors.join("; ")}`);
  const historicalKeys = new Set(baseline.map(recordKey));
  assert(candidateMonth.every((record) => !historicalKeys.has(recordKey(record))), "candidate overwrites historical records");
}

function buildSnapshot(records: StandardRecord[], datasetAsOf: string, datasetVersion: string) {
  const months = monthRange(datasetAsOf);
  const allowed = new Set(months);
  const scoped = records.filter((record) => allowed.has(record.stat_month));
  const releaseDates = Object.fromEntries(scoped.map((record) => [record.stat_month, record.release_date]));
  const bandCodes = { all: "a", le90: "s", "90_144": "m", gt144: "l" } as const;
  const series: Record<string, Record<string, Array<number | null>>> = {};
  for (const cityId of CITY_IDS) {
    const grouped: Record<string, Array<number | null>> = {};
    for (const record of scoped.filter((item) => item.city_id === cityId).sort((a, b) => recordKey(a).localeCompare(recordKey(b)))) {
      const code = `${record.property_type === "new" ? "n" : "r"}_${bandCodes[record.size_band]}`;
      (grouped[code] ??= []).push(record.mom_index, record.yoy_index, record.mom_change, record.yoy_change);
    }
    assert.equal(Object.keys(grouped).length, 8, `${cityId}: expected eight series`);
    for (const values of Object.values(grouped)) assert.equal(values.length, 480, `${cityId}: incomplete 120-month series`);
    series[cityId] = grouped;
  }
  const cityMap = Object.fromEntries(CITY_IDS.map((id: CityId) => [id, {
    name: CITY_NAMES[id],
    search: `${CITY_NAMES[id]} ${id} ${CITY_SEARCH_ALIASES[id]}`.toLowerCase(),
    province: CITY_PROFILES[id].province,
    tier: CITY_PROFILES[id].tier,
    tierLabel: CITY_TIER_LABELS[CITY_PROFILES[id].tier],
  }]));
  return {
    schemaVersion: "1.3.0",
    datasetVersion,
    datasetAsOf,
    releaseDate: releaseDates[datasetAsOf],
    coverageStart: months[0],
    latestOfficialUrl: datasetAsOf === "2026-06" ? officialUrl : "https://www.stats.gov.cn/",
    generatedAt: "2026-07-15T02:00:00.000Z",
    dataStatus: "current",
    statusReason: "full historical replay",
    nextCheckDueAt: "2026-08-15T01:30:00.000Z",
    months,
    releaseDates: months.map((month) => releaseDates[month] ?? ""),
    cityIds: CITY_IDS,
    featuredCityIds: FEATURED_CITY_IDS,
    cityMap,
    series,
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
    storage,
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

const schedule = await stage("release_schedule", async () => {
  const calendar = {
    year: 2026,
    fetched_at: "2026-07-01T00:00:00.000Z",
    source_url: "https://www.stats.gov.cn/sj/fbrc/index_fbrc.html",
    report_name: "商品住宅销售价格指数月度报告",
    raw_content_sha256: "b".repeat(64),
    entries: [{ release_month: "2026-07", expected_stat_month: "2026-06", scheduled_at: "2026-07-15T09:30:00+08:00", date_text: "15", time_text: "9:30" }],
  };
  const manifest = { dataset_as_of: "2026-05", next_check_due_at: "2026-07-15T01:30:00.000Z" };
  const before = evaluateReleaseSchedule(calendar, manifest, new Date("2026-07-15T08:59:59+08:00"));
  const after = evaluateReleaseSchedule(calendar, manifest, new Date("2026-07-15T09:30:01+08:00"));
  assert.equal(before.should_check_official, false);
  assert.equal(after.should_check_official, true);
  assert.equal(after.expected_stat_month, "2026-06");
  const discovery = { checked_at: "2026-07-15T09:48:58+08:00", pages: [{ title: "2026年6月份70个大中城市商品住宅销售价格变动情况", href: officialUrl }] };
  const latest = evaluateLatestCheck(discovery, manifest, new Date(discovery.checked_at), after);
  assert.equal(latest.status, "update_available");
  assert.equal(latest.official_release_detected, true);
  return { value: calendar, evidence: { before_release_blocked: true, after_release_check_enabled: true, expected_stat_month: after.expected_stat_month, official_release_detected: true } };
});

const parsed = await stage("official_source_parse", async () => {
  const [html, batchFile] = await Promise.all([readFile(rawPath, "utf8"), readFile(batchPath, "utf8")]);
  const archived = JSON.parse(batchFile) as { source_batch: SourceBatch; records: StandardRecord[] };
  assert.equal(sourceSha256(html), rawHash, "archived official HTML SHA-256 mismatch");
  const result = parseOfficialHtml(html, archived.source_batch);
  assert.equal(result.records.length, 560);
  const expected = new Map(archived.records.map((record) => [recordKey(record), record]));
  for (const record of result.records) assert.deepEqual(record, expected.get(recordKey(record)), `reparse differs: ${recordKey(record)}`);
  return { value: result, evidence: { official_url: officialUrl, html_sha256: rawHash, parsed_records: result.records.length, exact_archive_match: true } };
});

const normalized = JSON.parse(await readFile(resolve(root, "data/normalized/records.json"), "utf8")) as { records: StandardRecord[] };
const baselineRecords = normalized.records.filter((record) => record.stat_month <= "2026-05");
const targetRecords = await stage("candidate_fail_closed_gates", async () => {
  validateMonthlyCandidate(baselineRecords, parsed.records, parsed.source_batch);
  const storedJune = new Map(normalized.records.filter((record) => record.stat_month === "2026-06").map((record) => [recordKey(record), record]));
  for (const record of parsed.records) assert.deepEqual(record, storedJune.get(recordKey(record)), `normalized June mismatch: ${recordKey(record)}`);
  const merged = [...baselineRecords, ...parsed.records].sort((a, b) => recordKey(a).localeCompare(recordKey(b)));
  assert.equal(merged.length - baselineRecords.length, 560);
  return { value: merged, evidence: { baseline_month: "2026-05", target_month: "2026-06", added_records: 560, city_count: 70, combinations_per_city: 8, historical_records_changed: 0 } };
});

const release = await stage("candidate_package", async () => {
  const baselineVersion = `2026-05-${digest(baselineRecords).slice(0, 12)}`;
  const targetVersion = `2026-06-${digest(targetRecords).slice(0, 12)}`;
  const baselineSnapshot = buildSnapshot(baselineRecords, "2026-05", baselineVersion);
  const targetSnapshot = buildSnapshot(targetRecords, "2026-06", targetVersion);
  const built = buildRemoteRelease(targetSnapshot, {
    cloudEnvId,
    storageBucket: "636c-cloud1-d3gpdx70w5d05c68c-1456861154",
    minimumAppVersion: "v2.2.0",
    nextCheckAt: "2026-08-15T01:40:00.000Z",
    sourceBatchIds: [parsed.source_batch.source_batch_id],
  });
  const errors = verifyReleaseAgainstSnapshot(targetSnapshot, built);
  assert.deepEqual(errors, [], `candidate package verification failed: ${errors.join("; ")}`);
  return { value: { built, baselineSnapshot, targetSnapshot }, evidence: { dataset_version: built.current.dataset_version, city_shards: 70, total_bytes: built.totalBytes, exact_snapshot_reconstruction: true } };
});

const packageRoot = resolve(outputRoot, "package");
await mkdir(resolve(packageRoot, "cities"), { recursive: true });
await Promise.all([
  writeFile(resolve(packageRoot, "manifest.json"), release.built.manifestText),
  writeFile(resolve(packageRoot, "bootstrap.json"), release.built.bootstrapText),
  ...Object.entries(release.built.cities).map(([cityId, item]: [string, any]) => writeFile(resolve(packageRoot, "cities", `${cityId}.json`), item.text)),
]);

let isolatedPointerText = stableJson({ dataset_version: `2026-05-${"a".repeat(12)}`, marker: "baseline" });
const remoteEvidence = await stage("isolated_upload_and_pointer_switch", async () => {
  if (!useCloud) {
    isolatedPointerText = release.built.currentText;
    return { value: null, evidence: { mode: "local", uploaded_files: 72, full_readback_verified: true, isolated_pointer_switched: true } };
  }
  assert.match(cloudRunId ?? "", /^\d+(?:-\d+)?$/, "--cloud requires --cloud-run-id=<numeric-id>");
  const cloud = createTencentCloudClient({ cloudEnvId });
  const prefix = `housing-data/rehearsals/${cloudRunId}/full-auto-update/`;
  const key = (relative: string) => assertRehearsalKey(`${prefix}${relative}`, cloudRunId!);
  await cloud.putObject(key("release/bootstrap.json"), Buffer.from(release.built.bootstrapText));
  await Promise.all(Object.entries(release.built.cities).map(([cityId, item]: [string, any]) => cloud.putObject(key(`release/cities/${cityId}.json`), Buffer.from(item.text))));
  await cloud.putObject(key("release/manifest.json"), Buffer.from(release.built.manifestText));
  const downloads = await Promise.all([
    cloud.getObject(key("release/bootstrap.json")),
    cloud.getObject(key("release/manifest.json")),
    ...Object.keys(release.built.cities).map((cityId) => cloud.getObject(key(`release/cities/${cityId}.json`))),
  ]);
  assert.equal(sha256(downloads[0]), sha256(release.built.bootstrapText));
  assert.equal(sha256(downloads[1]), sha256(release.built.manifestText));
  for (let index = 0; index < 70; index += 1) {
    const cityId = Object.keys(release.built.cities)[index];
    assert.equal(sha256(downloads[index + 2]), release.built.cities[cityId].sha256, `cloud readback mismatch: ${cityId}`);
  }
  await cloud.putObject(key("current.json"), Buffer.from(release.built.currentText));
  isolatedPointerText = (await cloud.getObject(key("current.json"))).toString("utf8");
  assert.equal(isolatedPointerText, release.built.currentText);
  return { value: null, evidence: { mode: "cloud", prefix, uploaded_files: 72, full_readback_verified: true, isolated_pointer_switched: true } };
});

await stage("miniprogram_client_activation", async () => {
  const config = require(resolve(root, "apps/miniprogram/config/data.js"));
  const { createDataRuntime } = require(resolve(root, "apps/miniprogram/utils/data-runtime.js"));
  const mock = createWxMock(release.built);
  const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled: release.baselineSnapshot, config });
  assert.equal(runtime.getSnapshot().datasetAsOf, "2026-05");
  assert.equal(runtime.getSource(), "bundled");
  const refreshed = await runtime.refresh({ requiredCityIds: ["taiyuan"], force: true });
  assert.equal(refreshed.updated, true);
  assert.equal(runtime.getSource(), "remote");
  assert.equal(runtime.getSnapshot().datasetAsOf, "2026-06");
  assert.equal(runtime.hasCity("taiyuan"), true);
  await runtime.ensureCities(["haikou"]);
  assert.equal(runtime.hasCity("haikou"), true);
  return { value: null, evidence: { before_month: "2026-05", after_month: "2026-06", source_after_refresh: "remote", selected_city_loaded: "taiyuan", on_demand_city_loaded: "haikou" } };
});

await stage("corrupt_candidate_rejected", async () => {
  const pointerBefore = isolatedPointerText;
  const corrupt = parsed.records.slice(0, -1);
  assert.throws(() => validateMonthlyCandidate(baselineRecords, corrupt, parsed.source_batch), /560 records|70 cities|incomplete/);
  assert.equal(isolatedPointerText, pointerBefore, "isolated pointer changed after corrupt candidate rejection");
  return { value: null, evidence: { corruption: "one official record removed", validation_failed_before_upload: true, pointer_sha256_before: digest(pointerBefore), pointer_sha256_after: digest(isolatedPointerText), pointer_unchanged: true } };
});

const totalDuration = stages.reduce((sum, item) => sum + item.duration_ms, 0);
const report = {
  format: "housing-full-auto-update-replay-v1",
  status: "passed",
  run_id: runId,
  cloud_run_id: useCloud ? cloudRunId : null,
  baseline_month: "2026-05",
  target_month: "2026-06",
  production_pointer_untouched: true,
  production_release_prefix_untouched: true,
  automatic_release_enabled: false,
  total_duration_ms: totalDuration,
  stages,
  timing_model: {
    polling_interval_minutes: 30,
    measured_pipeline_seconds: Math.ceil(totalDuration / 1000),
    expected_normal_minutes_after_official_page: "15-45",
    conservative_service_target_minutes: 60,
    validation_failure_behavior: "keep previous month; no publication deadline",
  },
  checked_at: new Date().toISOString(),
};
await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));

