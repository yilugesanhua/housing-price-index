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
import { auditParsedBatch } from "../data/audit-batches";
import { auditReportSha256, FULL_RECORD_AUDIT_METHOD, FULL_RECORD_AUDIT_VERSION, recordsSha256, sourceIndexSha256, validateAuditReport, type AuditReport } from "../data/audit-report";
import { PARSER_VERSION, parseOfficialHtml, recordKey, sha256 as sourceSha256 } from "../data/official-parser";
import { sourceDatasetVersion } from "../data/source-identity";
import { validateRecords } from "../data/validate";
import type { ParsedBatch, SourceBatch, StandardRecord } from "../data/types";
import { validateCandidateData } from "./candidate-data-gate.mjs";
import {
  buildControlValidUntil,
  buildRevocationRegistryArtifact,
  classifyControlPointer,
  createRevocationRegistry,
  validateControlPointer,
} from "./control-plane.mjs";
import { activatePointerWithRollback } from "./guarded-activation.mjs";
import { buildPublicationIdentity } from "./publication-identity.mjs";
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
type SourceArchive = { path: string; source_batch: SourceBatch; records: StandardRecord[]; html: string };

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const gunzipAsync = promisify(gunzip);
const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const requestedMonths = Number(argument("months") ?? "6");
assert(Number.isInteger(requestedMonths) && requestedMonths >= 1 && requestedMonths <= 36, "--months must be an integer from 1 to 36");
const injectedFailureMonth = argument("inject-failure-month");
if (injectedFailureMonth) assert.match(injectedFailureMonth, /^20\d{2}-(0[1-9]|1[0-2])$/, "invalid injected failure month");
const runId = argument("run-id") ?? `local-${Date.now()}`;
const cloudRunId = argument("cloud-run-id") ?? process.env.GITHUB_RUN_ID;
const useCloud = process.argv.includes("--cloud");
const cloudEnvId = argument("env") ?? "cloud1-d3gpdx70w5d05c68c";
const storageBucket = "636c-cloud1-d3gpdx70w5d05c68c-1456861154";
const outputRoot = resolve(root, "work/full-auto-update-replay", runId);
const replayFormat = "housing-full-auto-update-historical-replay-v3";
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
    verification: "The replay must restart at month 1 and pass every requested sequential window.",
  },
  {
    id: "REPLAY-003",
    detected_in: "cloud-year-run-30287408324",
    severity: "fixed",
    problem: "The first cloud annual replay passed 10 months, then an unbounded COS request stalled until the 20-minute job limit canceled the process.",
    resolution: "Limit object operations to batches of 10, use SDK-enforced request cancellation with three idempotent attempts, and raise the annual rehearsal job limit to 45 minutes.",
    verification: "Restart the cloud annual replay from month 1; all 12 months and the following production read-only monitor must pass.",
  },
  {
    id: "REPLAY-004",
    detected_in: "cloud-year-run-30326077602",
    severity: "fixed",
    problem: "The complete 70-city bootstrap exceeded the former 60-second wrapper timeout; the wrapper stopped waiting without canceling the COS request, so retries could overlap.",
    resolution: "Let the COS SDK enforce and cancel request timeouts, use 180 seconds for complete bootstrap transfers, retain 60 seconds for ordinary objects, and retry only after the prior request has ended.",
    verification: "Restart the cloud annual replay from month 1; all 12 months and the following production read-only monitor must pass.",
  },
  {
    id: "REPLAY-005",
    detected_in: "cloud-year-run-30367683647",
    severity: "fixed",
    problem: "The V7/V4 annual replay passed 10 rounds but the 45-minute job limit canceled round 11 before the final-only report was written.",
    resolution: "Persist a report checkpoint after every completed round and allow 75 minutes for 12 conservative full-cloud readbacks without weakening validation or increasing object concurrency.",
    verification: "Restart the cloud annual replay from month 1; all 12 months, the uploaded report artifact, and the following production read-only monitor must pass.",
  },
  {
    id: "REPLAY-006",
    detected_in: "local-v2.4.1-preflight",
    severity: "fixed",
    problem: "The local replay labeled 72 release objects as fully read back without traversing every simulated object, and corruption injection covered a missing record but not a shape-valid wrong value.",
    resolution: "Hash-read every manifest, bootstrap, and city object in the isolated in-memory store, and inject both a missing record and a structurally valid altered index that must fail the audited official-record comparison.",
    verification: "Restart all sequential local rounds; every round must verify 72 data objects plus the control registry, reject both corruptions before pointer activation, and retain the prior pointer bytes.",
  },
  {
    id: "REPLAY-007",
    detected_in: "local-v241-20260802-preflight-1",
    severity: "fixed",
    problem: "The replay snapshot reused the complete official source coverage start as the 120-month client-window coverageStart after those fields became separate protocol identities.",
    resolution: "Set coverageStart to the first month in the 120-month client window and record the first available official month separately as sourceCoverageStart.",
    verification: "Rerun the isolated preflight and annual replay through the current remote-package and miniprogram integrity validators.",
  },
  {
    id: "REPLAY-008",
    detected_in: "local-v241-20260802-preflight-2",
    severity: "fixed",
    problem: "The replay passed the legacy data-package current pointer directly to the client after the production control protocol became mandatory.",
    resolution: "Build and validate a controlled publish pointer, immutable revocation registry, and validator receipt for each isolated activation; use the guarded activation helper for the local pointer switch.",
    verification: "The isolated client refresh must accept the controlled pointer, verify its receipt and registry, activate the complete package, and keep city-switch downloads at zero.",
  },
  {
    id: "REPLAY-009",
    detected_in: "local-v241-20260802-preflight-3",
    severity: "fixed",
    problem: "The replay generated a control pointer slightly in the future, so the current-time validation receipt was correctly rejected as predating the pointer.",
    resolution: "Generate isolated control timestamps one second before the local clock and let the client-side receipt use the current clock, preserving the required receipt ordering.",
    verification: "The client refresh accepts the pointer and receipt, then completes the full package activation without weakening timestamp validation.",
  },
  {
    id: "REPLAY-010",
    detected_in: "local-v2411-20260803-attempt-1",
    severity: "fixed",
    problem: "The replay expected the former audit batch shape and rejected the new records_sha256 evidence field before month 1 could enter candidate validation.",
    resolution: "Require the replayed month's audited record SHA-256 to equal a fresh digest of all 560 archived records while retaining the exact audit batch comparison.",
    verification: "Restart the sequential replay from month 1 and pass all 12 months through the current audit schema and fail-closed data gates.",
  },
  {
    id: "REPLAY-011",
    detected_in: "local-v2411-20260803-attempt-2",
    severity: "fixed",
    problem: "The replay snapshot did not provide the stable source dataset identity required by the current control protocol, so month 1 was rejected before isolated activation.",
    resolution: "Generate each baseline and target source identity with the production source identity algorithm over all applicable official batches and revision-ledger entries.",
    verification: "Restart the sequential replay from month 1; every controlled pointer, remote manifest, bootstrap, and client snapshot must carry the same valid source identity.",
  },
  {
    id: "REPLAY-012",
    detected_in: "local-v2411-36x3-run1-attempt-1",
    severity: "fixed",
    problem: "The outer command runner stopped waiting after five seconds and later terminated the detached replay after two completed months, leaving only a running checkpoint and no final report.",
    resolution: "Launch long replays as independently tracked background processes with redirected logs, then monitor the durable per-month checkpoint until the process exits.",
    verification: "Restart group 1 from month 1 and require all 36 consecutive months plus a final passed report.",
  },
  {
    id: "REPLAY-013",
    detected_in: "local-v2411-36x3-miniprogram-suite-1",
    severity: "fixed",
    problem: "The workflow security regression test still required the former 75-minute cloud timeout after the 36-month workflow raised its limit to 300 minutes.",
    resolution: "Require the 300-minute timeout, the closed 12-or-36 month workflow choice, and the exact dispatch input while retaining the default-branch and isolated-prefix checks.",
    verification: "Rerun the complete mini program test suite and require every workflow security test to pass.",
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

async function writeReplayCheckpoint(replayItems: Array<Record<string, unknown>>, targetMonth: string | null): Promise<void> {
  const checkpoint = {
    format: replayFormat,
    status: "running",
    run_id: runId,
    cloud_run_id: useCloud ? cloudRunId : null,
    active_target_month: targetMonth,
    completed_replay_count: replayItems.length,
    production_pointer_untouched: true,
    production_release_prefix_untouched: true,
    automatic_release_enabled: false,
    replays: replayItems,
    issues,
    checked_at: new Date().toISOString(),
  };
  await Promise.all([
    writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputRoot, "issues.json"), `${JSON.stringify(issues, null, 2)}\n`, "utf8"),
  ]);
}

async function retryCloud<T>(label: string, action: () => Promise<T>): Promise<T> {
  let latestError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      latestError = error;
      if (attempt < 3) console.warn(`[replay:cloud] ${label} failed; retrying (${attempt}/3): ${error instanceof Error ? error.message : String(error)}`);
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
  return { ...archived, path: matches[0], html };
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

function assertExactRecordSet(actual: StandardRecord[], expected: StandardRecord[], label: string): void {
  assert.equal(actual.length, expected.length, `${label}: record count differs`);
  const expectedByKey = new Map(expected.map((record) => [recordKey(record), record]));
  assert.equal(expectedByKey.size, expected.length, `${label}: expected records contain duplicate keys`);
  const actualKeys = new Set<string>();
  for (const record of actual) {
    const key = recordKey(record);
    assert(!actualKeys.has(key), `${label}: duplicate record ${key}`);
    actualKeys.add(key);
    const expectedRecord = expectedByKey.get(key);
    assert(expectedRecord, `${label}: unexpected record ${key}`);
    assert.deepEqual(record, expectedRecord, `${label}: record differs ${key}`);
  }
  assert.equal(actualKeys.size, expectedByKey.size, `${label}: expected records are missing`);
}

function scopedAuditReportForReplay(fullReport: AuditReport, allBatches: ParsedBatch[], targetMonth: string): AuditReport {
  const batches = allBatches
    .filter((batch) => batch.source_batch.stat_month <= targetMonth)
    .sort((left, right) => left.source_batch.source_batch_id.localeCompare(right.source_batch.source_batch_id));
  assert(batches.length > 0, `${targetMonth}: replay audit has no source batches`);

  const expectedBatchIds = batches.map((batch) => batch.source_batch.source_batch_id);
  const evidence = fullReport.batches
    .filter((batch) => batch.stat_month <= targetMonth)
    .sort((left, right) => left.source_batch_id.localeCompare(right.source_batch_id));
  assert.deepEqual(evidence.map((batch) => batch.source_batch_id), expectedBatchIds, `${targetMonth}: replay audit evidence does not exactly match scoped source batches`);

  const records = batches.flatMap((batch) => batch.records);
  const months = batches.map((batch) => batch.source_batch.stat_month).sort();
  const { report_sha256: _ignored, ...reportContent } = fullReport;
  const scopedContent: Omit<AuditReport, "report_sha256"> = {
    ...reportContent,
    parser_versions: [...new Set(batches.map((batch) => batch.source_batch.parser_version))].sort(),
    batch_count: batches.length,
    record_count: records.length,
    records_sha256: recordsSha256(records),
    source_index_sha256: sourceIndexSha256(batches),
    coverage_start: months.at(0) ?? null,
    coverage_end: months.at(-1) ?? null,
    batches: evidence,
  };
  const scopedReport: AuditReport = {
    ...scopedContent,
    report_sha256: auditReportSha256(scopedContent),
  };
  assert.deepEqual(validateAuditReport(scopedReport, batches), [], `${targetMonth}: scoped full-record audit is invalid`);
  return scopedReport;
}

function rejected(label: string, action: () => void): { kind: string; rejected: true; error: string } {
  try {
    action();
  } catch (error) {
    return { kind: label, rejected: true, error: error instanceof Error ? error.message : String(error) };
  }
  throw new Error(`${label}: corrupted input was accepted`);
}

function buildSnapshot(records: StandardRecord[], datasetAsOf: string, datasetVersion: string, sourceVersion: string) {
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
      sourceDatasetVersion: sourceVersion,
      datasetAsOf,
      releaseDate: latestRecord.release_date,
      coverageStart: months[0],
      sourceCoverageStart: firstAvailableMonth,
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
  const files = new Map([
    [release.current.manifest_file_id, release.manifestText],
    [release.manifest.bootstrap_file_id, release.bootstrapText],
    ...Object.values(release.cities).map((item: any) => [release.manifest.city_file_id_template.replace("{city_id}", item.data.cityId), item.text] as [string, string]),
  ]);
  if (release.registryArtifact) files.set(release.registryArtifact.cloudFileId, release.registryArtifact.text);
  return files;
}

function buildControlledRelease(release: any, {
  baselineVersion,
  replayNumber,
  previousPointer,
  registryArtifact,
}: {
  baselineVersion: string;
  replayNumber: number;
  previousPointer?: any;
  registryArtifact: any;
}) {
  const publishedAt = new Date(Date.now() - 1000).toISOString();
  const current = {
    ...release.current,
    published_at: publishedAt,
    previous_dataset_version: baselineVersion,
    control_schema_version: "1.0.0",
    control_generation: Number(previousPointer?.control_generation || 0) + 1,
    ...registryArtifact.currentFields,
    transition_type: "publish",
    data_status: "current",
    status_reason: "monthly_publish",
    control_generated_at: publishedAt,
    control_valid_until: buildControlValidUntil(publishedAt),
  };
  validateControlPointer(current, {
    allowLegacy: false,
    requireContext: true,
    manifest: release.manifest,
    registry: registryArtifact.registry,
    previousPointer,
    previousRegistry: previousPointer ? registryArtifact.registry : undefined,
    cloudEnvId,
    storageBucket,
  });
  return {
    ...release,
    current,
    currentText: stableJson(current),
    registryArtifact,
  };
}

function createWxMock(release: any, options: {
  remote?: Map<string, string>;
  current?: any;
  failDownloadAt?: number;
  failWrite?: (filePath: string) => boolean;
} = {}) {
  const files = new Map<string, Buffer>();
  const storage = new Map<string, any>();
  const remote = options.remote ?? cloudFiles(release);
  const { buildValidationReceipt } = require(resolve(root, "apps/miniprogram/cloudfunctions/getHousingDataManifest/validation-receipt.js"));
  let tempIndex = 0;
  const stats = { downloads: 0 };
  const fs = {
    readFileSync(filePath: string, encoding?: string) {
      const value = files.get(filePath);
      if (!value) throw new Error(`ENOENT: ${filePath}`);
      return encoding ? value.toString(encoding) : value;
    },
    readFile({ filePath, encoding, success, fail }: any) { try { success({ data: fs.readFileSync(filePath, encoding) }); } catch (error) { fail(error); } },
    writeFile({ filePath, data, success, fail }: any) {
      if (options.failWrite?.(filePath)) return fail(new Error(`simulated cache write failure: ${filePath}`));
      files.set(filePath, Buffer.from(data, "utf8")); success({});
    },
    mkdir({ success }: any) { success({}); },
    rename({ oldPath, newPath, success, fail }: any) {
      const entries = [...files.entries()].filter(([filePath]) => filePath === oldPath || filePath.startsWith(`${oldPath}/`));
      if (entries.length === 0) return fail(new Error(`ENOENT: ${oldPath}`));
      for (const [filePath, value] of entries) {
        files.set(`${newPath}${filePath.slice(oldPath.length)}`, value);
        files.delete(filePath);
      }
      success({});
    },
    rmdirSync(path: string) {
      for (const filePath of [...files.keys()]) {
        if (filePath === path || filePath.startsWith(`${path}/`)) files.delete(filePath);
      }
    },
  };
  return {
    wxApi: {
      env: { USER_DATA_PATH: "/user" },
      getFileSystemManager: () => fs,
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: any) => storage.set(key, structuredClone(value)),
      removeStorageSync: (key: string) => storage.delete(key),
      cloud: {
        callFunction({ success }: any) {
          const current = options.current ?? release.current;
          success({ result: { current: structuredClone(current), validation_receipt: buildValidationReceipt(current) } });
        },
        downloadFile({ fileID, success, fail }: any) {
          stats.downloads += 1;
          if (options.failDownloadAt === stats.downloads) return fail(new Error(`simulated download interruption: ${fileID}`));
          const value = remote.get(fileID);
          if (value === undefined) return fail(new Error(`remote file missing: ${fileID}`));
          const tempFilePath = `/temp/${tempIndex += 1}`;
          files.set(tempFilePath, Buffer.from(value, "utf8"));
          success({ tempFilePath });
        },
      },
    },
    stats,
  };
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await writeReplayCheckpoint([], null);
const auditReportPath = resolve(process.env.AUTO_RELEASE_AUDIT_REPORT_PATH ?? resolve(root, "data/audit-report.json"));
const auditReport = JSON.parse(await readFile(auditReportPath, "utf8")) as AuditReport;
const auditedBatches: ParsedBatch[] = [];
for await (const path of glob(resolve(root, "data/raw/**/*.batch.json").replaceAll("\\", "/"))) {
  auditedBatches.push(JSON.parse(await readFile(path, "utf8")) as ParsedBatch);
}
assert.deepEqual(validateAuditReport(auditReport, auditedBatches), [], "current full-record audit report is invalid");
assert(auditedBatches.every((batch) => batch.source_batch.parser_version === PARSER_VERSION), "source batches were not all produced by the current parser");
const auditByBatchId = new Map(auditReport.batches.map((batch) => [batch.source_batch_id, batch]));
const normalized = JSON.parse(await readFile(resolve(root, "data/normalized/records.json"), "utf8")) as { records: StandardRecord[] };
const normalizedRevisions = JSON.parse(await readFile(resolve(root, "data/normalized/revisions.json"), "utf8")) as Parameters<typeof sourceDatasetVersion>[2];
const latestMonth = [...new Set(normalized.records.map((record) => record.stat_month))].sort().at(-1)!;
const targetMonths = Array.from({ length: requestedMonths }, (_, index) => shiftMonth(latestMonth, index - requestedMonths + 1));
assert.equal(targetMonths.at(-1), latestMonth);
const sourceVersionCache = new Map<string, string>();
function replaySourceVersion(month: string): string {
  const cached = sourceVersionCache.get(month);
  if (cached) return cached;
  const version = sourceDatasetVersion(
    month,
    auditedBatches.filter((batch) => batch.source_batch.stat_month <= month),
    normalizedRevisions.filter((revision) => revision.revised_value.stat_month <= month),
  );
  sourceVersionCache.set(month, version);
  return version;
}
const cloud = useCloud ? createTencentCloudClient({ cloudEnvId }) : null;
if (useCloud) assert.match(cloudRunId ?? "", /^\d+(?:-\d+)?$/, "--cloud requires --cloud-run-id=<numeric-id>");
const prefix = useCloud ? `housing-data/rehearsals/${cloudRunId}/full-auto-update-year/` : null;
const key = (relative: string) => assertRehearsalKey(`${prefix}${relative}`, cloudRunId!);
let isolatedPointerText = stableJson({ dataset_version: `${shiftMonth(targetMonths[0], -1)}-${"a".repeat(12)}`, marker: `${requestedMonths}-month-baseline` });
if (cloud) await retryCloud("initialize isolated pointer", () => cloud.putObject(key("current.json"), Buffer.from(isolatedPointerText)));
const replayRegistry = createRevocationRegistry({ generatedAt: new Date().toISOString() });
const replayRegistryArtifact = buildRevocationRegistryArtifact(replayRegistry, { cloudEnvId, storageBucket });
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
    assertExactRecordSet(parsed.records, source.records, `${targetMonth}: official reparse`);
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
    assert.equal(archive.source_batch.parser_version, PARSER_VERSION, `${targetMonth}: source batch parser is stale`);
    assert.equal(archive.source_batch.verification_method, FULL_RECORD_AUDIT_METHOD, `${targetMonth}: source batch audit method is stale`);
    const auditedBatch = auditByBatchId.get(archive.source_batch.source_batch_id);
    assert(auditedBatch, `${targetMonth}: current audit report is missing the source batch`);
    assert.deepEqual(auditedBatch, {
      source_batch_id: archive.source_batch.source_batch_id,
      stat_month: targetMonth,
      raw_content_sha256: archive.source_batch.raw_content_sha256,
      records_sha256: recordsSha256(archive.records),
      records_checked: 560,
      result: "passed",
    }, `${targetMonth}: source batch differs from the current audit report`);
    validateMonthlyCandidate(baselineRecords, archive.records, archive.source_batch);
    const normalizedTarget = normalized.records.filter((record) => record.stat_month === targetMonth);
    assertExactRecordSet(archive.records, normalizedTarget, `${targetMonth}: normalized target`);
    const merged = [...baselineRecords, ...archive.records].sort((a, b) => recordKey(a).localeCompare(recordKey(b)));
    const gate = validateCandidateData({
      previousPayload: { records: baselineRecords },
      candidatePayload: { records: merged },
      expectedMonth: targetMonth,
      sourceBatch: archive.source_batch,
    });
    return {
      value: merged,
      evidence: {
        parser_version: PARSER_VERSION,
        audit_version: FULL_RECORD_AUDIT_VERSION,
        audited_batch_matched: true,
        full_audit_batch_count: auditReport.batch_count,
        full_audit_record_count: auditReport.record_count,
        added_records: 560,
        city_count: 70,
        combinations_per_city: 8,
        historical_records_changed: 0,
        production_candidate_gate: gate.status,
      },
    };
  });

  const scopedAuditReport = scopedAuditReportForReplay(auditReport, auditedBatches, targetMonth);
  assert.equal(scopedAuditReport.record_count, targetRecords.length, `${targetMonth}: scoped audit record count does not match candidate`);
  assert.equal(scopedAuditReport.records_sha256, recordsSha256(targetRecords), `${targetMonth}: scoped audit record hash does not match candidate`);

  const packaged = await timed(stages, "candidate_package", async () => {
    const baselineVersion = `${baselineMonth}-${digest(baselineRecords).slice(0, 12)}`;
    const targetVersion = `${targetMonth}-${digest(targetRecords).slice(0, 12)}`;
    const baselineBuilt = buildSnapshot(baselineRecords, baselineMonth, baselineVersion, replaySourceVersion(baselineMonth));
    const targetBuilt = buildSnapshot(targetRecords, targetMonth, targetVersion, replaySourceVersion(targetMonth));
    assert.deepEqual(baselineBuilt.paddingMonths.slice(1), targetBuilt.paddingMonths);
    const nextCheckAt = new Date(Date.parse(`${archive.source_batch.release_date}T01:30:00.000Z`) + 31 * 24 * 60 * 60 * 1000).toISOString();
    const publicationIdentity = buildPublicationIdentity({ records: targetRecords, auditReport: scopedAuditReport });
    const release = buildRemoteRelease(targetBuilt.snapshot, {
      cloudEnvId,
      storageBucket,
      minimumAppVersion: "v2.3.0",
      nextCheckAt,
      sourceBatchIds: [archive.source_batch.source_batch_id],
      publicationIdentity,
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
        publication_identity_verified: true,
        publication_audit_batch_count: scopedAuditReport.batch_count,
        publication_audit_record_count: scopedAuditReport.record_count,
        publication_audit_report_sha256: publicationIdentity.audit_report_sha256,
        test_only_pre_coverage_null_padding_months: targetBuilt.paddingMonths,
      },
    };
  });

  await timed(stages, "corrupt_candidate_rejected", async () => {
    const pointerBefore = cloud ? (await retryCloud("read pointer before corrupt candidate", () => cloud.getObject(key("current.json")))).toString("utf8") : isolatedPointerText;
    const missingCity = archive.records.filter((record) => record.city_id !== archive.records[0].city_id);
    const missingMonth: StandardRecord[] = [];
    const duplicateRecord = [...archive.records, structuredClone(archive.records[0])];
    const wrongValue = structuredClone(archive.records);
    const altered = wrongValue[0];
    altered.mom_index = Number((altered.mom_index + 0.1).toFixed(1));
    altered.mom_change = Number((altered.mom_change + 0.1).toFixed(1));
    const alteredAudit = auditParsedBatch(archive.path, { source_batch: archive.source_batch, records: wrongValue }, Buffer.from(archive.html));
    assert(alteredAudit.errors.some((error) => /mom_index|mom_change/.test(error)), `${targetMonth}: altered official value was not rejected by raw-cell audit`);
    const shiftedArea = structuredClone(archive.records);
    const conflictingAreaRecord = shiftedArea.find((record) => record.city_id === shiftedArea[0].city_id
      && record.property_type === shiftedArea[0].property_type
      && record.size_band !== shiftedArea[0].size_band);
    assert(conflictingAreaRecord, `${targetMonth}: missing a second official area band for exception injection`);
    shiftedArea[0].size_band = conflictingAreaRecord.size_band;
    const truncatedHtml = archive.html.slice(0, Math.floor(archive.html.length / 2));
    const complete = structuredClone(packaged.release);
    const controlled = buildControlledRelease(complete, {
      baselineVersion: packaged.baselineSnapshot.datasetVersion,
      replayNumber,
      registryArtifact: replayRegistryArtifact,
    });
    const hashMismatch = structuredClone(packaged.release);
    hashMismatch.bootstrapText = `${hashMismatch.bootstrapText} `;
    const manifestMismatch = structuredClone(packaged.release);
    manifestMismatch.manifest.dataset_as_of = baselineMonth;
    const sourceVersionMismatch = structuredClone(packaged.release);
    sourceVersionMismatch.manifest.source_dataset_version = `${targetMonth}-${"0".repeat(12)}`;
    const revokedAt = new Date(Date.now() - 2_000).toISOString();
    const revokedRegistry = createRevocationRegistry({
      generatedAt: revokedAt,
      revokedDatasetVersions: [{
        dataset_version: controlled.current.dataset_version,
        revoked_at: revokedAt,
        reason: "isolated replay verifies that a revoked candidate cannot activate",
      }],
    });
    const revokedDataset = rejected("revoked_dataset_version", () => buildControlledRelease(structuredClone(packaged.release), {
      baselineVersion: packaged.baselineSnapshot.datasetVersion,
      replayNumber,
      registryArtifact: buildRevocationRegistryArtifact(revokedRegistry, { cloudEnvId, storageBucket }),
    }));
    const olderCurrent = {
      ...controlled.current,
      dataset_version: `${baselineMonth}-${"0".repeat(12)}`,
      dataset_as_of: baselineMonth,
      manifest_file_id: controlled.current.manifest_file_id.replace(controlled.current.dataset_version, `${baselineMonth}-${"0".repeat(12)}`),
    };
    const clientRejects = async (label: string, mock: ReturnType<typeof createWxMock>) => {
      const config = require(resolve(root, "apps/miniprogram/config/data.js"));
      const { createDataRuntime } = require(resolve(root, "apps/miniprogram/utils/data-runtime.js"));
      const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled: packaged.baselineSnapshot, config });
      const result = await runtime.refresh({ force: true });
      assert.equal(result.updated, false, `${targetMonth}: ${label} unexpectedly updated the client`);
      assert.equal(runtime.getSnapshot().datasetAsOf, baselineMonth, `${targetMonth}: ${label} replaced the last safe snapshot`);
      return { kind: label, rejected: true as const, retained_safe_snapshot: true };
    };
    const corruptions = [
      rejected("missing_city", () => validateMonthlyCandidate(baselineRecords, missingCity, archive.source_batch)),
      rejected("missing_month", () => validateMonthlyCandidate(baselineRecords, missingMonth, archive.source_batch)),
      rejected("duplicate_record", () => validateMonthlyCandidate(baselineRecords, duplicateRecord, archive.source_batch)),
      { kind: "mom_yoy_misaligned", rejected: true as const, audit_error_count: alteredAudit.errors.length, record_key: recordKey(altered) },
      rejected("area_band_misaligned", () => assertExactRecordSet(shiftedArea, archive.records, `${targetMonth}: shifted area band`)),
      rejected("sha256_mismatch", () => assert.deepEqual(verifyReleaseAgainstSnapshot(packaged.targetSnapshot, hashMismatch), [], `${targetMonth}: package SHA-256 mismatch`)),
      rejected("truncated_official_html", () => assertExactRecordSet(parseOfficialHtml(truncatedHtml, archive.source_batch).records, archive.records, `${targetMonth}: truncated official HTML`)),
      rejected("manifest_snapshot_mismatch", () => assert.deepEqual(verifyReleaseAgainstSnapshot(packaged.targetSnapshot, manifestMismatch), [], `${targetMonth}: manifest mismatch`)),
      rejected("source_version_mismatch", () => assert.deepEqual(verifyReleaseAgainstSnapshot(packaged.targetSnapshot, sourceVersionMismatch), [], `${targetMonth}: source version mismatch`)),
      { ...revokedDataset, retained_safe_snapshot: true },
      await clientRejects("version_regression", createWxMock(controlled, { current: olderCurrent })),
      await clientRejects("download_interrupted", createWxMock(controlled, { failDownloadAt: 1 })),
      await clientRejects("cache_write_failed", createWxMock(controlled, { failWrite: (path) => path.endsWith("/bootstrap.json") })),
    ];
    assert.equal(corruptions.length, 13, `${targetMonth}: all required exception cases must run`);
    assert(corruptions.every((item) => item.rejected), `${targetMonth}: an exception case was not rejected`);
    const pointerAfter = cloud ? (await retryCloud("read pointer after corrupt candidate", () => cloud.getObject(key("current.json")))).toString("utf8") : isolatedPointerText;
    assert.equal(pointerAfter, pointerBefore, `${targetMonth}: pointer changed after corrupt candidate rejection`);
    return {
      value: null,
      evidence: {
        corruptions,
        exception_case_count: corruptions.length,
        validation_failed_before_upload: true,
        pointer_sha256_before: digest(pointerBefore),
        pointer_sha256_after: digest(pointerAfter),
        pointer_unchanged: true,
      },
    };
  });

  await timed(stages, "isolated_upload_readback_and_pointer_switch", async () => {
    const previous = JSON.parse(isolatedPointerText);
    let previousPointer: any = undefined;
    try {
      if (classifyControlPointer(previous) === "controlled") previousPointer = previous;
    } catch (_) {}
    const release = buildControlledRelease(packaged.release, {
      baselineVersion: packaged.baselineSnapshot.datasetVersion,
      replayNumber,
      previousPointer,
      registryArtifact: replayRegistryArtifact,
    });
    packaged.release = release;
    let objectTransport = "isolated_cos";
    let objectsVerified = 0;
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
      objectsVerified = downloads.length;
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
        guardRollback: async (expected: any) => {
          const actual = JSON.parse((await retryCloud(`${targetMonth} guard isolated rollback pointer`, () => cloud.getObject(key("current.json")))).toString("utf8"));
          assert.equal(actual.dataset_version, expected.dataset_version);
          assert.equal(actual.manifest_sha256, expected.manifest_sha256);
        },
        prepareRollback: async () => ({ ...previous, previous_dataset_version: null }),
        verifyRollbackTarget: async (expected: any) => {
          const actual = JSON.parse((await retryCloud(`${targetMonth} verify isolated rollback target`, () => cloud.getObject(key("current.json")))).toString("utf8"));
          assert.equal(actual.dataset_version, expected.dataset_version);
          assert.equal(actual.manifest_sha256, expected.manifest_sha256);
        },
      });
      isolatedPointerText = (await retryCloud(`${targetMonth} final isolated pointer readback`, () => cloud.getObject(key("current.json")))).toString("utf8");
    } else {
      objectTransport = "isolated_in_memory_store";
      const objects = cloudFiles(release);
      assert.equal(objects.size, 73, `${targetMonth}: isolated release must contain exactly 72 data objects plus one control registry`);
      assert.equal(sha256(objects.get(release.current.manifest_file_id) ?? ""), release.current.manifest_sha256, `${targetMonth}: isolated manifest readback mismatch`);
      assert.equal(sha256(objects.get(release.manifest.bootstrap_file_id) ?? ""), release.manifest.bootstrap_sha256, `${targetMonth}: isolated bootstrap readback mismatch`);
      for (const [cityId, item] of Object.entries(release.cities) as Array<[string, any]>) {
        const fileId = release.manifest.city_file_id_template.replace("{city_id}", cityId);
        assert.equal(sha256(objects.get(fileId) ?? ""), item.sha256, `${targetMonth}: isolated city readback mismatch ${cityId}`);
      }
      objectsVerified = objects.size;
      await activatePointerWithRollback({
        candidate: release.current,
        candidateText: release.currentText,
        previous,
        rollbackEligible: true,
        writePointer: async (text: string) => { isolatedPointerText = text; },
        readPointerText: async () => isolatedPointerText,
        guardCandidate: async (expected: any) => assert.equal(isolatedPointerText, stableJson(expected)),
        guardRollback: async (expected: any) => assert.equal(isolatedPointerText, stableJson(expected)),
        prepareRollback: async () => ({ ...previous, previous_dataset_version: null }),
        verifyRollbackTarget: async (expected: any) => assert.equal(isolatedPointerText, stableJson(expected)),
      });
    }
    assert.equal(isolatedPointerText, release.currentText);
    return { value: null, evidence: { mode: cloud ? "cloud" : "local", object_transport: objectTransport, data_objects_verified: 72, control_objects_verified: 1, objects_verified: objectsVerified, full_readback_verified: true, guarded_isolated_pointer_switched: true } };
  });

  await timed(stages, "miniprogram_client_activation", async () => {
    const config = require(resolve(root, "apps/miniprogram/config/data.js"));
    const { createDataRuntime } = require(resolve(root, "apps/miniprogram/utils/data-runtime.js"));
    const mock = createWxMock(packaged.release);
    const runtime = createDataRuntime({ wxApi: mock.wxApi, bundled: packaged.baselineSnapshot, config });
    assert.equal(runtime.getSnapshot().datasetAsOf, baselineMonth);
    assert.equal(runtime.getSource(), "bundled");
    const refreshed = await runtime.refresh({ force: true });
    assert.equal(refreshed.updated, true);
    assert.equal(runtime.getSource(), "remote");
    assert.equal(runtime.getSnapshot().datasetAsOf, targetMonth);
    assert.equal(runtime.hasCity("taiyuan"), true);
    assert.equal(Object.keys(runtime.getSnapshot().series).length, 70);
    assert.equal(mock.stats.downloads, 3);
    const downloadsAfterRefresh = mock.stats.downloads;
    await runtime.ensureCities(["taiyuan", "haikou", "xining"]);
    assert.equal(runtime.hasCity("haikou"), true);
    assert.equal(runtime.hasCity("xining"), true);
    assert.equal(mock.stats.downloads, downloadsAfterRefresh);
    return { value: null, evidence: { before_month: baselineMonth, after_month: targetMonth, source_after_refresh: "remote", local_city_history_count: 70, update_download_count: downloadsAfterRefresh, city_switch_download_count: 0 } };
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
  await writeReplayCheckpoint(replays, targetMonth);
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
    format: replayFormat,
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
  format: replayFormat,
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
