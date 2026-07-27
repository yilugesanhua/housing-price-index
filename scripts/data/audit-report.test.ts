import { describe, expect, it } from "vitest";
import { FULL_RECORD_AUDIT_METHOD, FULL_RECORD_AUDIT_VERSION, validateAuditReport, type AuditReport } from "./audit-report";
import type { ParsedBatch } from "./types";

function fixture() {
  const verificationMethod = FULL_RECORD_AUDIT_METHOD;
  const batch = {
    source_batch: {
      source_batch_id: "official-html-2026-06-fixture",
      source_type: "official-html",
      source_url: "https://www.stats.gov.cn/sj/zxfb/example.html",
      fetched_at: "2026-07-15T00:00:00.000Z",
      raw_content_sha256: "a".repeat(64),
      raw_archive_uri: `data/raw/2026-06/${"a".repeat(64)}.html`,
      parser_version: "fixture",
      schema_version: "1.0.0",
      verification_status: "verified",
      verification_method: verificationMethod,
      http_status: 200,
      final_url: "https://www.stats.gov.cn/sj/zxfb/example.html",
      redirect_chain: [],
      stat_month: "2026-06",
      release_date: "2026-07-15",
    },
    records: [{} as ParsedBatch["records"][number]],
  } satisfies ParsedBatch;
  const report: AuditReport = {
    audit_version: FULL_RECORD_AUDIT_VERSION,
    verified_at: "2026-07-15T01:00:00.000Z",
    verification_method: verificationMethod,
    batch_count: 1,
    record_count: 1,
    coverage_start: "2026-06",
    coverage_end: "2026-06",
    result: "passed",
    batches: [{ source_batch_id: batch.source_batch.source_batch_id, stat_month: "2026-06", raw_content_sha256: "a".repeat(64), records_checked: 1, result: "passed" }],
  };
  return { batch, report };
}

describe("production audit report gate", () => {
  it("accepts matching full-record audit evidence", () => {
    const { batch, report } = fixture();
    expect(validateAuditReport(report, [batch])).toEqual([]);
  });

  it("rejects missing or mismatched audit evidence", () => {
    const { batch, report } = fixture();
    expect(validateAuditReport(null, [batch])).toContain("production publish requires data/audit-report.json");
    report.batches[0].raw_content_sha256 = "b".repeat(64);
    expect(validateAuditReport(report, [batch])).toContain(`full-record audit evidence differs for batch ${batch.source_batch.source_batch_id}`);
  });
});
