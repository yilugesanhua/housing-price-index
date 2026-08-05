import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { recordKey } from "./official-parser";
import type { ParsedBatch, StandardRecord } from "./types";

export const TARGET_CITY_COUNT = 70;
const MAX_INDEX_VALUE = 1000;
const INDEX_FIELDS = ["mom_index", "yoy_index", "ytd_avg_index"] as const;

function hasAtMostOneDecimal(value: number): boolean {
  return Math.abs(value * 10 - Math.round(value * 10)) < Number.EPSILON * 100;
}

function isStatMonth(value: string): boolean {
  return /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
}

function isIsoDate(value: string): boolean {
  if (!/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validateRecords(records: StandardRecord[]): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const record of records) {
    const key = recordKey(record);
    if (keys.has(key)) errors.push(`duplicate unique key: ${key}`);
    keys.add(key);
    if (!isStatMonth(record.stat_month)) errors.push(`${key}: stat_month is invalid`);
    if (!isIsoDate(record.release_date)) errors.push(`${key}: release_date is invalid`);
    for (const field of INDEX_FIELDS) {
      const value = record[field];
      const reasonField = field === "ytd_avg_index" ? "ytd_missing_reason" : `${field.replace("_index", "")}_missing_reason`;
      const reason = record[reasonField as "mom_missing_reason" | "yoy_missing_reason" | "ytd_missing_reason"];
      if (value === null && !reason) errors.push(`${key}: ${field} missing reason is required`);
      if (value !== null && (!Number.isFinite(value) || value <= 0 || value > MAX_INDEX_VALUE || !hasAtMostOneDecimal(value) || reason !== null)) errors.push(`${key}: ${field} invariant failed`);
    }
    for (const [indexField, changeField] of [["mom_index", "mom_change"], ["yoy_index", "yoy_change"]] as const) {
      const index = record[indexField];
      const change = record[changeField];
      if (index === null && change !== null) errors.push(`${key}: ${changeField} must be null when ${indexField} is null`);
      if (index !== null && change !== Math.round((index - 100) * 10) / 10) errors.push(`${key}: ${changeField} mismatch`);
      if (change !== null && (!Number.isFinite(change) || !hasAtMostOneDecimal(change))) errors.push(`${key}: ${changeField} precision invariant failed`);
    }
    if (record.mom_index === null && record.mom_missing_reason !== "official-empty-or-dash") errors.push(`${key}: unsupported mom missing reason`);
    if (record.yoy_index === null && record.yoy_missing_reason !== "official-empty-or-dash") errors.push(`${key}: unsupported yoy missing reason`);
    if (record.ytd_avg_index === null) {
      if (record.ytd_missing_reason !== "not-published-for-this-table") errors.push(`${key}: unsupported ytd missing reason`);
      if (record.ytd_period_start !== null || record.ytd_period_end !== null || record.ytd_comparison_base !== null) errors.push(`${key}: ytd companion fields must be null when ytd_avg_index is null`);
    } else {
      if (record.ytd_period_start !== `${record.stat_month.slice(0, 4)}-01` || record.ytd_period_end !== record.stat_month || record.ytd_comparison_base !== "上年同期=100") errors.push(`${key}: ytd companion fields are invalid`);
    }
  }
  const scopes = new Set(records.map((record) => `${record.stat_month}|${record.property_type}`));
  for (const scope of scopes) {
    const [month, propertyType] = scope.split("|");
    const cityCount = new Set(records.filter((record) => record.stat_month === month && record.property_type === propertyType).map((record) => record.city_id)).size;
    if (cityCount !== TARGET_CITY_COUNT) errors.push(`${scope}: expected ${TARGET_CITY_COUNT} target cities, got ${cityCount}`);
  }
  return errors;
}

export async function readBatches(): Promise<ParsedBatch[]> {
  const paths = await glob("data/raw/**/*.batch.json");
  const batches: ParsedBatch[] = [];
  for await (const path of paths) batches.push(JSON.parse(await readFile(path, "utf8")) as ParsedBatch);
  return batches;
}
