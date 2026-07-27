import { createHash } from "node:crypto";
import { glob, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { ParsedBatch } from "./types";

describe("tracked raw audit archives", () => {
  it("has one compressed HTML archive matching every source batch hash", async () => {
    const batchPaths: string[] = [];
    for await (const path of await glob("data/raw/**/*.batch.json")) batchPaths.push(path);
    expect(batchPaths.length).toBeGreaterThan(100);
    for (const batchPath of batchPaths) {
      const batch = JSON.parse(await readFile(batchPath, "utf8")) as ParsedBatch;
      const htmlPath = batchPath.replace(/\.batch\.json$/, ".html.gz");
      const compressed = await readFile(htmlPath);
      const html = gunzipSync(compressed);
      expect(createHash("sha256").update(html).digest("hex"), batchPath).toBe(batch.source_batch.raw_content_sha256);
    }
  });
});
