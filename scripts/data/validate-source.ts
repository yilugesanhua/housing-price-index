import { readBatches, validateRecords } from "./validate";

function monthRange(start: string, end: string): string[] {
  const result: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endValue = Number(end.replace("-", ""));
  while (year * 100 + month <= endValue) {
    result.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return result;
}

const batches = await readBatches();
const records = batches.flatMap((batch) => batch.records);
const errors = validateRecords(records);
const months = [...new Set(records.map((record) => record.stat_month))].sort();
if (months.length > 0) {
  const missing = monthRange(months[0], months.at(-1)!).filter((month) => !months.includes(month));
  if (missing.length > 0) errors.push(`coverage gaps: ${missing.join(", ")}`);
}
if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const sampled = batches.filter((batch) => batch.source_batch.verification_status !== "verified").length;
  console.log(`Validated ${records.length} records across ${batches.length} batches (${months[0]} to ${months.at(-1)}); ${sampled} batches still require verification`);
}

