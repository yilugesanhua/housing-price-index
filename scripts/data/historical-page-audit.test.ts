import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recheckHistoricalPages, selectProductionHistoricalBaselines, type HistoricalPageBaseline } from "./historical-page-audit";

const checkedAt = "2026-08-30T02:00:00.000Z";
const bytes = Buffer.from("official page bytes", "utf8");
const baseline: HistoricalPageBaseline = {
  source_batch_id: "official-html-2026-06-aaaaaaaaaaaa",
  stat_month: "2026-06",
  source_url: "https://www.stats.gov.cn/sj/zxfb/example.html",
  final_url: "https://www.stats.gov.cn/sj/zxfb/example.html",
  release_date: "2026-07-15",
  raw_content_sha256: createHash("sha256").update(bytes).digest("hex"),
};

describe("quarterly historical page audit", () => {
  it("selects exactly the archived batches used by normalized production records", () => {
    const result = selectProductionHistoricalBaselines(
      [{ source_batch_id: baseline.source_batch_id }],
      [{ source_batch: baseline }, {
        source_batch: { ...baseline, source_batch_id: "official-html-2026-05-bbbbbbbbbbbb", stat_month: "2026-05" },
      }],
    );
    expect(result).toEqual([baseline]);
    expect(() => selectProductionHistoricalBaselines([{ source_batch_id: "official-html-2026-05-bbbbbbbbbbbb" }], [{ source_batch: baseline }]))
      .toThrow(/no recoverable batch archive/);
  });

  it("keeps an unchanged official page as a passing read-only result", async () => {
    const report = await recheckHistoricalPages({
      baselines: [baseline],
      checkedAt,
      fetchPage: async () => ({ bytes, final_url: baseline.source_url, http_status: 200, content_type: "text/html" }),
    });
    expect(report.status).toBe("passed");
    expect(report.production_untouched).toBe(true);
    expect(report.unchanged_count).toBe(1);
    expect(report.isolated_revision_tasks).toEqual([]);
  });

  it("creates an isolated review task when the raw page hash changes", async () => {
    const report = await recheckHistoricalPages({
      baselines: [baseline],
      checkedAt,
      fetchPage: async () => ({ bytes: Buffer.from("corrected official page", "utf8"), final_url: baseline.source_url, http_status: 200, content_type: "text/html" }),
    });
    expect(report.status).toBe("attention_required");
    expect(report.changed_count).toBe(1);
    expect(report.production_untouched).toBe(true);
    expect(report.isolated_revision_tasks).toMatchObject([{
      source_batch_id: baseline.source_batch_id,
      previous_final_url: baseline.final_url,
      previous_raw_content_sha256: baseline.raw_content_sha256,
      status: "pending_human_review",
      change_reasons: ["content_hash"],
      next_step: "review_official_page_then_prepare_historical_correction",
    }]);
  });

  it("isolates a redirect change even when the official page bytes are unchanged", async () => {
    const redirectedUrl = "https://www.stats.gov.cn/xxgk/sjfb/zxfb2020/redirected.html";
    const report = await recheckHistoricalPages({
      baselines: [baseline],
      checkedAt,
      fetchPage: async () => ({ bytes, final_url: redirectedUrl, http_status: 200, content_type: "text/html" }),
    });
    expect(report.status).toBe("attention_required");
    expect(report.changed_count).toBe(1);
    expect(report.isolated_revision_tasks).toMatchObject([{
      previous_final_url: baseline.final_url,
      observed_final_url: redirectedUrl,
      previous_raw_content_sha256: baseline.raw_content_sha256,
      observed_raw_content_sha256: baseline.raw_content_sha256,
      change_reasons: ["redirect"],
    }]);
  });

  it("fails closed for a request error or a redirect outside the official allowlist", async () => {
    const failedRequest = await recheckHistoricalPages({
      baselines: [baseline],
      checkedAt,
      fetchPage: async () => { throw new Error("ETIMEDOUT"); },
    });
    expect(failedRequest.status).toBe("failed");
    expect(failedRequest.failed_count).toBe(1);

    const unsafeRedirect = await recheckHistoricalPages({
      baselines: [baseline],
      checkedAt,
      fetchPage: async () => ({ bytes, final_url: "https://example.com/page.html", http_status: 200, content_type: "text/html" }),
    });
    expect(unsafeRedirect.status).toBe("failed");
    expect(unsafeRedirect.failed_count).toBe(1);

    const nonHtmlResponse = await recheckHistoricalPages({
      baselines: [baseline],
      checkedAt,
      fetchPage: async () => ({ bytes, final_url: baseline.source_url, http_status: 200, content_type: "application/json" }),
    });
    expect(nonHtmlResponse.status).toBe("failed");
    expect(nonHtmlResponse.failed_count).toBe(1);
  });
});
