import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { readRawArchiveSync } from "./raw-archive";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("raw archive persistence", () => {
  it("reads a tracked compressed archive when the local HTML cache is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "housing-raw-"));
    roots.push(root);
    const path = join(root, "source.html");
    await writeFile(`${path}.gz`, gzipSync(Buffer.from("official html", "utf8")));
    expect(readRawArchiveSync(path).toString("utf8")).toBe("official html");
  });

  it("fails closed when neither archive form exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "housing-raw-"));
    roots.push(root);
    expect(() => readRawArchiveSync(join(root, "missing.html"))).toThrow(/compressed fallback/);
  });
});
