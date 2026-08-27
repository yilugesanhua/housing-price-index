import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { discoverOfficialPages } from "./discover";
import type { ReleaseCalendar } from "./fetch-release-calendar";

const require = createRequire(import.meta.url);
const contract = require("../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/discovery-contract.js") as {
  sha256: (value: string) => string;
  isOfficialReleaseUrl: (value: string) => boolean;
  isStatMonth: (value: string) => boolean;
  nextStatMonth: (value: string) => string;
  extractStatMonth: (title: string) => string | null;
  parseSlotId: (value: string) => { slot_id: string } | null;
  latestScheduledSlot: (now: number) => { slot_id: string } | null;
  canonicalCalendarText: (calendar: ReleaseCalendar) => string;
  buildReleaseIdempotencyKey: (month: string, url: string) => string;
  evaluateReleaseSchedule: (calendar: ReleaseCalendar, manifest: Manifest, now: Date) => ReleaseDecision;
  waitingResult: (decision: ReleaseDecision, manifest: Manifest, checkedAt: string) => LatestCheckResult;
  evaluateLatestCheck: (discovery: Discovery, manifest: Manifest, now: Date, decision?: ReleaseDecision | null) => LatestCheckResult;
};

type DiscoveredPage = { title: string; href: string };
type Discovery = { checked_at?: string; list_url?: string; pages?: DiscoveredPage[]; responses?: unknown[] };
type Manifest = { dataset_as_of?: string; next_check_due_at?: string };
export type PublishedPointer = { dataset_as_of?: string; dataset_version?: string; manifest_sha256?: string; next_check_at?: string };

export type LatestCheckStatus = "waiting" | "current" | "update_available" | "anomaly";
export type ReleaseWindow = "waiting" | "active" | "overdue" | "calendar_exhausted";

export type ReleaseDecision = {
  should_check_official: boolean;
  release_window: ReleaseWindow;
  scheduled_release_at: string | null;
  expected_stat_month: string | null;
  days_until_release: number | null;
};

export type LatestCheckResult = {
  status: LatestCheckStatus;
  checked_at: string;
  dataset_as_of: string | null;
  latest_official_month: string | null;
  latest_official_url: string | null;
  next_check_due_at: string | null;
  scheduled_release_at: string | null;
  expected_stat_month: string | null;
  days_until_release: number | null;
  release_window: ReleaseWindow | null;
  official_list_checked: boolean;
  official_release_detected: boolean;
  reasons: string[];
};

export type DiscoveryHandoff = {
  format: "housing-data-discovery-handoff-v1";
  status: "update_available";
  dataset_as_of: string;
  expected_stat_month: string;
  official_url: string;
  scheduled_release_at: string;
  discovered_at: string;
  calendar_source_urls: string[];
  calendar_raw_content_sha256: string;
  calendar_sha256: string;
  report_sha256: string;
  repository_commit_sha: string | null;
  discovery_run_id: string | null;
  slot_id: string | null;
  idempotency_key: string;
  handoff_identity: string;
  release_identity_version: "month-and-official-url-v1";
};

export function publishedManifest(pointer: PublishedPointer | null | undefined, fallback: Manifest = {}): Manifest {
  if (pointer && typeof pointer.dataset_as_of === "string") {
    return { dataset_as_of: pointer.dataset_as_of, next_check_due_at: pointer.next_check_at ?? fallback.next_check_due_at };
  }
  return fallback;
}

// These typed wrappers deliberately call the CloudBase-deployable contract.
// They are the GitHub side of the single discovery rule set.
export function extractStatMonth(title: string): string | null {
  return contract.extractStatMonth(title);
}

export function evaluateReleaseSchedule(calendar: ReleaseCalendar, manifest: Manifest, now = new Date()): ReleaseDecision {
  return contract.evaluateReleaseSchedule(calendar, manifest, now);
}

export function evaluateLatestCheck(discovery: Discovery, manifest: Manifest, now = new Date(), decision: ReleaseDecision | null = null): LatestCheckResult {
  return contract.evaluateLatestCheck(discovery, manifest, now, decision);
}

function waitingResult(decision: ReleaseDecision, manifest: Manifest, checkedAt: string): LatestCheckResult {
  return contract.waitingResult(decision, manifest, checkedAt);
}

function resolveSlotId(input: string | undefined, now: Date): string | null {
  if (input) {
    const parsed = contract.parseSlotId(input);
    if (!parsed) throw new Error("发现时段身份无效");
    return parsed.slot_id;
  }
  return contract.latestScheduledSlot(now.getTime())?.slot_id ?? null;
}

export function buildDiscoveryHandoff(
  result: LatestCheckResult,
  calendar: ReleaseCalendar,
  reportText: string,
  env: NodeJS.ProcessEnv = process.env,
  slotId: string | null = null,
): DiscoveryHandoff {
  if (result.status !== "update_available" || !result.official_release_detected) throw new Error("只有已进入发布窗口并发现正式页面时才能生成自动发布交接");
  if (!result.dataset_as_of || !result.expected_stat_month || !result.latest_official_url || !result.scheduled_release_at) throw new Error("自动发布交接缺少必要字段");
  if (result.latest_official_month !== result.expected_stat_month || result.expected_stat_month !== contract.nextStatMonth(result.dataset_as_of)) throw new Error("正式页面月份与当前数据的严格下一月不一致");
  if (!contract.isOfficialReleaseUrl(result.latest_official_url)) throw new Error("自动发布交接的正式页面URL不在国家统计局白名单");
  if (slotId !== null && !contract.parseSlotId(slotId)) throw new Error("自动发布交接时段身份无效");
  const calendarText = contract.canonicalCalendarText(calendar);
  const repositoryCommit = /^[a-f0-9]{40}$/.test(env.GITHUB_SHA || "") ? env.GITHUB_SHA! : null;
  const discoveryRunId = /^\d+$/.test(env.GITHUB_RUN_ID || "") ? env.GITHUB_RUN_ID! : null;
  const idempotencyKey = contract.buildReleaseIdempotencyKey(result.expected_stat_month, result.latest_official_url);
  return {
    format: "housing-data-discovery-handoff-v1",
    status: "update_available",
    dataset_as_of: result.dataset_as_of,
    expected_stat_month: result.expected_stat_month,
    official_url: result.latest_official_url,
    scheduled_release_at: result.scheduled_release_at,
    discovered_at: result.checked_at,
    calendar_source_urls: calendar.source_urls ?? [calendar.source_url],
    calendar_raw_content_sha256: calendar.raw_content_sha256,
    calendar_sha256: contract.sha256(calendarText),
    report_sha256: contract.sha256(reportText),
    repository_commit_sha: repositoryCommit,
    discovery_run_id: discoveryRunId,
    slot_id: slotId,
    idempotency_key: idempotencyKey,
    handoff_identity: `housing-data-discovery-v1:${idempotencyKey}`,
    release_identity_version: "month-and-official-url-v1",
  };
}

function toMarkdown(result: LatestCheckResult & { slot_id?: string | null }): string {
  const label = result.status === "waiting" ? "等待发布窗口" : result.status === "current" ? "正常" : result.status === "update_available" ? "发现新月份" : "异常";
  return [
    "# 70城住宅价格数据月度检查",
    "",
    `- 状态：${label}`,
    `- 时段身份：${result.slot_id ?? "非定时运行"}`,
    `- 检查时间：${result.checked_at}`,
    `- 当前发布月份：${result.dataset_as_of ?? "无法读取"}`,
    `- 官方最新月份：${result.latest_official_month ?? "无法识别"}`,
    `- 官方页面：${result.latest_official_url ?? "无法识别"}`,
    `- 预告发布时间：${result.scheduled_release_at ?? "等待下一年度日程"}`,
    `- 预期统计月份：${result.expected_stat_month ?? "无法确定"}`,
    `- 距预告发布：${result.days_until_release === null ? "无法计算" : `${result.days_until_release}天`}`,
    `- 发布窗口：${result.release_window ?? "未使用预告"}`,
    `- 已检查正式发布列表：${result.official_list_checked ? "是" : "否"}`,
    `- 已发现正式发布：${result.official_release_detected ? "是" : "否"}`,
    `- 下次检查期限：${result.next_check_due_at ?? "无法读取"}`,
    "",
    "## 结果",
    "",
    ...result.reasons.map((reason) => `- ${reason}`),
    "",
    "发现新月份后仍须经过独立数据门禁和受保护发布流程；本检查不会写入正式数据。",
    "",
  ].join("\n");
}

async function main() {
  const discoveryArgument = process.argv.find((arg) => arg.startsWith("--discovery="))?.split("=").slice(1).join("=");
  const calendarArgument = process.argv.find((arg) => arg.startsWith("--calendar="))?.split("=").slice(1).join("=");
  const currentArgument = process.argv.find((arg) => arg.startsWith("--current="))?.split("=").slice(1).join("=");
  const slotArgument = process.argv.find((arg) => arg.startsWith("--slot="))?.split("=").slice(1).join("=");
  const repositoryManifest = JSON.parse(await readFile(resolve("apps", "web", "public", "data", "manifest.json"), "utf8")) as Manifest;
  const current = currentArgument ? JSON.parse(await readFile(resolve(currentArgument), "utf8")) as PublishedPointer : null;
  if (currentArgument && (!current || !contract.isStatMonth(current.dataset_as_of || ""))) throw new Error("生产 current.json 缺少有效 dataset_as_of");
  const manifest = publishedManifest(current, repositoryManifest);
  const now = new Date();
  const slotId = resolveSlotId(slotArgument || process.env.DISCOVERY_SLOT_ID, now);
  let result: LatestCheckResult;
  let calendar: ReleaseCalendar | null = null;
  if (calendarArgument) {
    calendar = JSON.parse(await readFile(resolve(calendarArgument), "utf8")) as ReleaseCalendar;
    const decision = evaluateReleaseSchedule(calendar, manifest, now);
    if (!decision.should_check_official) {
      result = waitingResult(decision, manifest, now.toISOString());
    } else {
      const discovery = await discoverOfficialPages(3);
      await writeFile(resolve("work", "monthly-data-check", "discovered.json"), `${JSON.stringify(discovery, null, 2)}\n`, "utf8");
      result = evaluateLatestCheck(discovery, manifest, now, decision);
    }
  } else {
    const discoveryPath = resolve(discoveryArgument || resolve("data", "discovered-official-pages.json"));
    const discovery = JSON.parse(await readFile(discoveryPath, "utf8")) as Discovery;
    result = evaluateLatestCheck(discovery, manifest, now);
  }
  const report = { ...result, slot_id: slotId };
  const reportDir = resolve("work", "monthly-data-check");
  await mkdir(reportDir, { recursive: true });
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(resolve(reportDir, "report.json"), reportText, "utf8");
  await writeFile(resolve(reportDir, "report.md"), toMarkdown(report), "utf8");
  if (result.status === "update_available" && calendar) {
    const handoff = buildDiscoveryHandoff(result, calendar, reportText, process.env, slotId);
    await writeFile(resolve(reportDir, "handoff.json"), `${JSON.stringify(handoff, null, 2)}\n`, "utf8");
  }
  console.log(toMarkdown(report));
  if (result.status === "update_available") process.exitCode = 2;
  else if (result.status === "anomaly") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
