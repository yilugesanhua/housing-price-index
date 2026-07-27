import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { recordKey } from "./official-parser";
import type { ParsedBatch, StandardRecord } from "./types";

export const TARGET_CITY_COUNT = 70;

export function validateRecords(records: StandardRecord[]): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const record of records) {
    const key = recordKey(record);
    if (keys.has(key)) errors.push(`duplicate unique key: ${key}`);
    keys.add(key);
    for (const field of ["mom_index", "yoy_index", "ytd_avg_index"] as const) {
      const value = record[field];
      const reasonField = field === "ytd_avg_index" ? "ytd_missing_reason" : `${field.replace("_index", "")}_missing_reason`;
      const reason = record[reasonField as "mom_missing_reason" | "yoy_missing_reason" | "ytd_missing_reason"];
      if (value === null && !reason) errors.push(`${key}: ${field} missing reason is required`);
      if (value !== null && (!Number.isFinite(value) || reason !== null)) errors.push(`${key}: ${field} invariant failed`);
    }
    if (record.mom_index !== null && record.mom_change !== Math.round((record.mom_index - 100) * 10) / 10) errors.push(`${key}: mom_change mismatch`);
    if (record.yoy_index !== null && record.yoy_change !== Math.round((record.yoy_index - 100) * 10) / 10) errors.push(`${key}: yoy_change mismatch`);
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
