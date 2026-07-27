import { readFile, writeFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import type { ParsedBatch } from "./types";
import { validateRecords } from "./validate";

const batchId = process.argv[2];
const method = process.argv.slice(3).join(" ").trim();
if (!batchId || !method) throw new Error("用法: npm run data:verify -- <source_batch_id> <核验方法说明>");
let foundPath: string | undefined;
for await (const path of await glob("data/raw/**/*.batch.json")) {
  const parsed = JSON.parse(await readFile(path, "utf8")) as ParsedBatch;
  if (parsed.source_batch.source_batch_id === batchId) {
    foundPath = path;
    parsed.source_batch.verification_status = "verified";
    parsed.source_batch.verification_method = method;
    await writeFile(path, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    const errors = validateRecords(parsed.records);
    if (errors.length > 0) throw new Error(`批次结构校验失败: ${errors.join("; ")}`);
    console.log(`Verified ${batchId} using: ${method}`);
    break;
  }
}
if (!foundPath) throw new Error(`找不到 source_batch_id: ${batchId}`);

