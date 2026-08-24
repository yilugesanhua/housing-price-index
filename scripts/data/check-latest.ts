import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverOfficialPages } from "./discover";
import type { ReleaseCalendar } from "./fetch-release-calendar";

type DiscoveredPage = { title: string; href: string };
type Discovery = { checked_at?: string; list_url?: string; pages?: DiscoveredPage[] };
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
  idempotency_key: string;
  release_identity_version: "month-and-official-url-v1";
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isOfficialReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.stats.gov.cn" && url.pathname.endsWith(".html") && ["/sj/zxfb/", "/xxgk/sjfb/zxfb2020/"].some((prefix) => url.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

export function buildDiscoveryHandoff(result: LatestCheckResult, calendar: ReleaseCalendar, reportText: string, env: NodeJS.ProcessEnv = process.env): DiscoveryHandoff {
  if (result.status !== "update_available" || !result.official_release_detected) throw new Error("只有已进入发布窗口并发现正式页面时才能生成自动发布交接");
  if (!result.dataset_as_of || !result.expected_stat_month || !result.latest_official_url || !result.scheduled_release_at) throw new Error("自动发布交接缺少必要字段");
  if (result.latest_official_month !== result.expected_stat_month) throw new Error("正式页面月份与日程预期月份不一致");
  if (!isOfficialReleaseUrl(result.latest_official_url)) throw new Error("自动发布交接的正式页面URL不在国家统计局白名单");
  const calendarText = JSON.stringify({ year: calendar.year, source_urls: calendar.source_urls ?? [calendar.source_url], raw_content_sha256: calendar.raw_content_sha256, entries: calendar.entries });
  const repositoryCommit = /^[a-f0-9]{40}$/.test(env.GITHUB_SHA || "") ? env.GITHUB_SHA! : null;
  const discoveryRunId = /^\d+$/.test(env.GITHUB_RUN_ID || "") ? env.GITHUB_RUN_ID! : null;
  const idempotencyKey = digest(`${result.expected_stat_month}\n${result.latest_official_url}`);
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
    calendar_sha256: digest(calendarText),
    report_sha256: digest(reportText),
    repository_commit_sha: repositoryCommit,
    discovery_run_id: discoveryRunId,
    idempotency_key: idempotencyKey,
    release_identity_version: "month-and-official-url-v1",
  };
}

export function publishedManifest(pointer: PublishedPointer | null | undefined, fallback: Manifest = {}): Manifest {
  if (pointer && typeof pointer.dataset_as_of === "string") {
    return { dataset_as_of: pointer.dataset_as_of, next_check_due_at: pointer.next_check_at ?? fallback.next_check_due_at };
  }
  return fallback;
}

export function extractStatMonth(title: string): string | null {
  const match = title.match(/(20\d{2})年(\d{1,2})月份/);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${String(month).padStart(2, "0")}` : null;
}

export function evaluateReleaseSchedule(calendar: ReleaseCalendar, manifest: Manifest, now = new Date()): ReleaseDecision {
  const datasetAsOf = typeof manifest.dataset_as_of === "string" ? manifest.dataset_as_of : null;
  const nextEntry = calendar.entries.find((entry) => !datasetAsOf || entry.expected_stat_month > datasetAsOf) ?? null;
  if (!nextEntry) {
    return { should_check_official: false, release_window: "calendar_exhausted", scheduled_release_at: null, expected_stat_month: null, days_until_release: null };
  }
  const scheduledTime = Date.parse(nextEntry.scheduled_at);
  if (!Number.isFinite(scheduledTime)) throw new Error(`发布预告包含无效时间：${nextEntry.scheduled_at}`);
  const millisecondsUntilRelease = scheduledTime - now.getTime();
  const daysUntilRelease = Math.ceil(millisecondsUntilRelease / 86_400_000);
  const earlyPollingMs = 30 * 60 * 1000;
  const overdueMs = 60 * 60 * 1000;
  if (millisecondsUntilRelease > earlyPollingMs) {
    return { should_check_official: false, release_window: "waiting", scheduled_release_at: nextEntry.scheduled_at, expected_stat_month: nextEntry.expected_stat_month, days_until_release: daysUntilRelease };
  }
  return {
    should_check_official: true,
    release_window: now.getTime() - scheduledTime >= overdueMs ? "overdue" : "active",
    scheduled_release_at: nextEntry.scheduled_at,
    expected_stat_month: nextEntry.expected_stat_month,
    days_until_release: daysUntilRelease,
  };
}

function waitingResult(decision: ReleaseDecision, manifest: Manifest, checkedAt: string): LatestCheckResult {
  const calendarExhausted = decision.release_window === "calendar_exhausted";
  return {
    status: "waiting",
    checked_at: checkedAt,
    dataset_as_of: typeof manifest.dataset_as_of === "string" ? manifest.dataset_as_of : null,
    latest_official_month: null,
    latest_official_url: null,
    next_check_due_at: typeof manifest.next_check_due_at === "string" ? manifest.next_check_due_at : null,
    scheduled_release_at: decision.scheduled_release_at,
    expected_stat_month: decision.expected_stat_month,
    days_until_release: decision.days_until_release,
    release_window: decision.release_window,
    official_list_checked: false,
    official_release_detected: false,
    reasons: [calendarExhausted ? "本年度日程中没有晚于当前数据集的发布安排，等待国家统计局更新年度预告" : `下一期 ${decision.expected_stat_month} 数据预告于 ${decision.scheduled_release_at} 发布，尚未进入检查窗口`],
  };
}

export function evaluateLatestCheck(discovery: Discovery, manifest: Manifest, now = new Date(), decision: ReleaseDecision | null = null): LatestCheckResult {
  const reasons: string[] = [];
  const pages = Array.isArray(discovery.pages) ? discovery.pages : [];
  const datedPages = pages.map((page) => ({ ...page, stat_month: extractStatMonth(page.title) })).filter((page): page is DiscoveredPage & { stat_month: string } => Boolean(page.stat_month));
  const latestPage = datedPages.sort((a, b) => b.stat_month.localeCompare(a.stat_month))[0] ?? null;
  const datasetAsOf = typeof manifest.dataset_as_of === "string" ? manifest.dataset_as_of : null;
  const nextCheckDueAt = typeof manifest.next_check_due_at === "string" ? manifest.next_check_due_at : null;

  if (pages.length === 0) reasons.push("官方发布列表未发现任何70城住宅价格页面");
  else if (datedPages.length === 0) reasons.push("发现的官方页面标题无法解析统计月份，页面结构可能已变化");
  if (!datasetAsOf || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(datasetAsOf)) reasons.push("发布清单缺少有效的 dataset_as_of");
  if (!nextCheckDueAt || !Number.isFinite(Date.parse(nextCheckDueAt))) reasons.push("发布清单缺少有效的 next_check_due_at");
  if (latestPage && datasetAsOf && latestPage.stat_month < datasetAsOf) reasons.push(`官方发现结果最新为 ${latestPage.stat_month}，早于已发布的 ${datasetAsOf}`);

  let status: LatestCheckStatus = reasons.length > 0 ? "anomaly" : "current";
  if (status === "current" && latestPage && datasetAsOf && latestPage.stat_month > datasetAsOf) {
    status = "update_available";
    reasons.push(`国家统计局已发布 ${latestPage.stat_month}，当前网站仍为 ${datasetAsOf}`);
  } else if (status === "current" && !decision && nextCheckDueAt && now.getTime() > Date.parse(nextCheckDueAt)) {
    status = "anomaly";
    reasons.push(`已超过下次检查期限 ${nextCheckDueAt}`);
  }

  const officialReleaseDetected = Boolean(decision?.expected_stat_month && latestPage && latestPage.stat_month >= decision.expected_stat_month);
  if (status === "current" && decision?.release_window === "overdue" && !officialReleaseDetected) {
    status = "anomaly";
    reasons.push(`已超过预告发布时间1小时，仍未发现 ${decision.expected_stat_month} 正式发布页；可能延期或官方页面结构已变化`);
  } else if (status === "current" && decision?.release_window === "active" && !officialReleaseDetected) {
    reasons.push(`已进入 ${decision.expected_stat_month} 发布窗口，尚未发现正式发布页，将按计划继续检查`);
  }

  if (status === "current" && !decision) reasons.push("官方最新月份与当前发布月份一致，且未超过检查期限");
  return {
    status,
    checked_at: typeof discovery.checked_at === "string" ? discovery.checked_at : now.toISOString(),
    dataset_as_of: datasetAsOf,
    latest_official_month: latestPage?.stat_month ?? null,
    latest_official_url: latestPage?.href ?? null,
    next_check_due_at: nextCheckDueAt,
    scheduled_release_at: decision?.scheduled_release_at ?? null,
    expected_stat_month: decision?.expected_stat_month ?? null,
    days_until_release: decision?.days_until_release ?? null,
    release_window: decision?.release_window ?? null,
    official_list_checked: true,
    official_release_detected: officialReleaseDetected,
    reasons,
  };
}

function toMarkdown(result: LatestCheckResult): string {
  const label = result.status === "waiting" ? "等待发布窗口" : result.status === "current" ? "正常" : result.status === "update_available" ? "发现新月份" : "异常";
  return [
    "# 70城住宅价格数据月度检查",
    "",
    `- 状态：${label}`,
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
    "发现新月份后必须按现有抓取、核验、发布门禁人工确认，不得由本任务自动上线。",
    "",
  ].join("\n");
}

async function main() {
  const discoveryArgument = process.argv.find((arg) => arg.startsWith("--discovery="))?.split("=").slice(1).join("=");
  const calendarArgument = process.argv.find((arg) => arg.startsWith("--calendar="))?.split("=").slice(1).join("=");
  const repositoryManifest = JSON.parse(await readFile(resolve("apps", "web", "public", "data", "manifest.json"), "utf8")) as Manifest;
  const currentArgument = process.argv.find((arg) => arg.startsWith("--current="))?.split("=").slice(1).join("=");
  const current = currentArgument ? JSON.parse(await readFile(resolve(currentArgument), "utf8")) as PublishedPointer : null;
  if (currentArgument && (!current || typeof current.dataset_as_of !== "string")) throw new Error("生产 current.json 缺少有效 dataset_as_of");
  const manifest = publishedManifest(current, repositoryManifest);
  const now = new Date();
  let result: LatestCheckResult;
  if (calendarArgument) {
    const calendar = JSON.parse(await readFile(resolve(calendarArgument), "utf8")) as ReleaseCalendar;
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
  const reportDir = resolve("work", "monthly-data-check");
  await mkdir(reportDir, { recursive: true });
  const reportText = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(resolve(reportDir, "report.json"), reportText, "utf8");
  await writeFile(resolve(reportDir, "report.md"), toMarkdown(result), "utf8");
  if (result.status === "update_available" && calendarArgument) {
    const calendar = JSON.parse(await readFile(resolve(calendarArgument), "utf8")) as ReleaseCalendar;
    const handoff = buildDiscoveryHandoff(result, calendar, reportText);
    await writeFile(resolve(reportDir, "handoff.json"), `${JSON.stringify(handoff, null, 2)}\n`, "utf8");
  }
  console.log(toMarkdown(result));
  if (result.status === "update_available") process.exitCode = 2;
  else if (result.status === "anomaly") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
