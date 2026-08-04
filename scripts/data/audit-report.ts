import { createHash } from "node:crypto";
import type { ParsedBatch } from "./types";

export const FULL_RECORD_AUDIT_METHOD = "automated-full-record-audit-v6: sha256+official-url+metadata+four-table-whitelist+property-type+size-band+locator+raw-cell+schema+record-hash-binding";
export const FULL_RECORD_AUDIT_VERSION = "full-record-audit-v6";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function recordKey(record: ParsedBatch["records"][number]): string {
  return `${record.stat_month}|${record.city_id}|${record.property_type}|${record.size_band}`;
}

export function recordsSha256(records: ParsedBatch["records"]): string {
  return digest([...records].sort((left, right) => recordKey(left).localeCompare(recordKey(right))));
}

export function sourceIndexSha256(batches: ParsedBatch[]): string {
  return digest(batches.map(({ source_batch: source }) => ({
    source_batch_id: source.source_batch_id,
    source_url: source.source_url,
    final_url: source.final_url,
    stat_month: source.stat_month,
    release_date: source.release_date,
    raw_content_sha256: source.raw_content_sha256,
    parser_version: source.parser_version,
    schema_version: source.schema_version,
  })).sort((left, right) => left.source_batch_id.localeCompare(right.source_batch_id)));
}

export interface AuditReport {
  schema_version: 2;
  audit_version: string;
  verified_at: string;
  verification_method: string;
  batch_count: number;
  record_count: number;
  records_sha256: string;
  source_index_sha256: string;
  coverage_start: string | null;
  coverage_end: string | null;
  checks: string[];
  result: string;
  batches: Array<{
    source_batch_id: string;
    stat_month: string;
    raw_content_sha256: string;
    records_sha256: string;
    records_checked: number;
    result: string;
  }>;
}

export function validateAuditReport(report: AuditReport | null, batches: ParsedBatch[]): string[] {
  if (!report) return ["production publish requires data/audit-report.json"];
  const errors: string[] = [];
  const recordCount = batches.reduce((sum, batch) => sum + batch.records.length, 0);
  const allRecords = batches.flatMap((batch) => batch.records);
  const months = batches.map((batch) => batch.source_batch.stat_month).sort();
  if (report.schema_version !== 2 || report.audit_version !== FULL_RECORD_AUDIT_VERSION || report.result !== "passed") errors.push("full-record audit report has not passed");
  if (report.verification_method !== FULL_RECORD_AUDIT_METHOD) errors.push("full-record audit method is unsupported");
  if (!Number.isFinite(Date.parse(report.verified_at))) errors.push("full-record audit verified_at is invalid");
  if (report.batch_count !== batches.length || report.batches.length !== batches.length) errors.push("full-record audit batch count does not match source batches");
  if (report.record_count !== recordCount) errors.push("full-record audit record count does not match source records");
  if (report.records_sha256 !== recordsSha256(allRecords)) errors.push("full-record audit records hash does not match source records");
  if (report.source_index_sha256 !== sourceIndexSha256(batches)) errors.push("full-record audit source index hash does not match source batches");
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
    const batchRecordsHash = recordsSha256(batch.records);
    if (!source.audited_records_sha256 || source.audited_records_sha256 !== batchRecordsHash) errors.push(`source batch ${source.source_batch_id} is not bound to its audited records`);
    if (item.result !== "passed" || item.stat_month !== source.stat_month || item.raw_content_sha256 !== source.raw_content_sha256 || item.records_sha256 !== batchRecordsHash || item.records_checked !== batch.records.length) {
      errors.push(`full-record audit evidence differs for batch ${source.source_batch_id}`);
    }
    if (source.verification_status !== "verified" || source.verification_method !== report.verification_method) errors.push(`batch ${source.source_batch_id} is not verified by the current full-record audit method`);
  }
  return errors;
}
