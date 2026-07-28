import type { ParsedBatch } from "./types";

export const FULL_RECORD_AUDIT_METHOD = "automated-full-record-audit-v4: sha256+official-url+metadata+four-table-whitelist+size-band+locator+raw-cell+schema";
export const FULL_RECORD_AUDIT_VERSION = "full-record-audit-v4";

export interface AuditReport {
  audit_version: string;
  verified_at: string;
  verification_method: string;
  batch_count: number;
  record_count: number;
  coverage_start: string | null;
  coverage_end: string | null;
  result: string;
  batches: Array<{
    source_batch_id: string;
    stat_month: string;
    raw_content_sha256: string;
    records_checked: number;
    result: string;
  }>;
}

export function validateAuditReport(report: AuditReport | null, batches: ParsedBatch[]): string[] {
  if (!report) return ["production publish requires data/audit-report.json"];
  const errors: string[] = [];
  const recordCount = batches.reduce((sum, batch) => sum + batch.records.length, 0);
  const months = batches.map((batch) => batch.source_batch.stat_month).sort();
  if (report.audit_version !== FULL_RECORD_AUDIT_VERSION || report.result !== "passed") errors.push("full-record audit report has not passed");
  if (report.verification_method !== FULL_RECORD_AUDIT_METHOD) errors.push("full-record audit method is unsupported");
  if (!Number.isFinite(Date.parse(report.verified_at))) errors.push("full-record audit verified_at is invalid");
  if (report.batch_count !== batches.length || report.batches.length !== batches.length) errors.push("full-record audit batch count does not match source batches");
  if (report.record_count !== recordCount) errors.push("full-record audit record count does not match source records");
  if (report.coverage_start !== (months[0] ?? null) || report.coverage_end !== (months.at(-1) ?? null)) errors.push("full-record audit coverage does not match source batches");

  const audited = new Map<string, AuditReport["batches"][number]>();
  for (const item of report.batches) {
    if (audited.has(item.source_batch_id)) errors.push(`full-record audit contains duplicate batch ${item.source_batch_id}`);
    audited.set(item.source_batch_id, item);
  }
  for (const batch of batches) {
    const source = batch.source_batch;
    const item = audited.get(source.source_batch_id);
    if (!item) {
      errors.push(`full-record audit is missing batch ${source.source_batch_id}`);
      continue;
    }
    if (item.result !== "passed" || item.stat_month !== source.stat_month || item.raw_content_sha256 !== source.raw_content_sha256 || item.records_checked !== batch.records.length) {
      errors.push(`full-record audit evidence differs for batch ${source.source_batch_id}`);
    }
    if (source.verification_status !== "verified" || source.verification_method !== report.verification_method) errors.push(`batch ${source.source_batch_id} is not verified by the current full-record audit method`);
  }
  return errors;
}
