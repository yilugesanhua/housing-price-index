import { describe, expect, it } from "vitest";
import {
  auditReportSha256,
  currentAuditCodeSha256,
  currentRepositoryCommitSha,
  FULL_RECORD_AUDIT_METHOD,
  FULL_RECORD_AUDIT_VERSION,
  recordsSha256,
  sourceIndexSha256,
  validateAuditReport,
  type AuditReport,
} from "./audit-report";
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
      audited_records_sha256: "",
      http_status: 200,
      final_url: "https://www.stats.gov.cn/sj/zxfb/example.html",
      redirect_chain: [],
      stat_month: "2026-06",
      release_date: "2026-07-15",
    },
    records: [{} as ParsedBatch["records"][number]],
  } satisfies ParsedBatch;
  batch.source_batch.audited_records_sha256 = recordsSha256(batch.records);
  const reportContent: Omit<AuditReport, "report_sha256"> = {
    schema_version: 2,
    audit_version: FULL_RECORD_AUDIT_VERSION,
    verified_at: "2026-07-15T01:00:00.000Z",
    verification_method: verificationMethod,
    repository_commit_sha: currentRepositoryCommitSha(),
    audit_code_sha256: currentAuditCodeSha256(),
    parser_versions: [batch.source_batch.parser_version],
    batch_count: 1,
    record_count: 1,
    records_sha256: recordsSha256(batch.records),
    source_index_sha256: sourceIndexSha256([batch]),
    coverage_start: "2026-06",
    coverage_end: "2026-06",
    checks: [],
    result: "passed",
    batches: [
      {
        source_batch_id: batch.source_batch.source_batch_id,
        stat_month: "2026-06",
        raw_content_sha256: "a".repeat(64),
        records_sha256: recordsSha256(batch.records),
        records_checked: 1,
        result: "passed",
      },
    ],
  };
  const report: AuditReport = {
    ...reportContent,
    report_sha256: auditReportSha256(reportContent),
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
    expect(validateAuditReport(null, [batch])).toContain(
      "production publish requires data/audit-report.json",
    );
    report.batches[0].raw_content_sha256 = "b".repeat(64);
    expect(validateAuditReport(report, [batch])).toContain(
      `full-record audit evidence differs for batch ${batch.source_batch.source_batch_id}`,
    );
    expect(validateAuditReport(report, [batch])).toContain(
      "full-record audit report hash is invalid",
    );
  });

  it("rejects records changed after the full audit", () => {
    const { batch, report } = fixture();
    batch.records[0] = { ...batch.records[0], city_name: "被修改" };
    expect(validateAuditReport(report, [batch])).toContain(
      `source batch ${batch.source_batch.source_batch_id} is not bound to its audited records`,
    );
    expect(validateAuditReport(report, [batch])).toContain(
      "full-record audit records hash does not match source records",
    );
  });

  it("rejects parser, code, commit, and report identity changes", () => {
    const { batch, report } = fixture();
    report.parser_versions = ["other-parser"];
    report.audit_code_sha256 = "b".repeat(64);
    report.repository_commit_sha = "c".repeat(40);
    expect(validateAuditReport(report, [batch])).toEqual(
      expect.arrayContaining([
        "full-record audit parser versions do not match source batches",
        "full-record audit code hash does not match the current verifier",
        "full-record audit repository commit is not an ancestor of the current checkout",
        "full-record audit report hash is invalid",
      ]),
    );
  });
});
