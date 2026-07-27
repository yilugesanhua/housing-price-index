import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicReplaceDirectory } from "./atomic-publish";

const roots: string[] = [];

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "housing-publish-"));
  roots.push(root);
  return { root, output: join(root, "data"), staged: join(root, "staged"), backup: join(root, "backup") };
}

async function seed(path: string, value: string) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "version.txt"), value, "utf8");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("atomic publish directory replacement", () => {
  it("switches a verified staged directory and removes the backup", async () => {
    const paths = await workspace();
    await seed(paths.output, "old");
    await seed(paths.staged, "new");
    await atomicReplaceDirectory({ ...paths, stagedDir: paths.staged, outputDir: paths.output, backupDir: paths.backup, validate: async () => undefined });
    await expect(readFile(join(paths.output, "version.txt"), "utf8")).resolves.toBe("new");
    await expect(readFile(join(paths.backup, "version.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("supports the first publish when no prior output exists", async () => {
    const paths = await workspace();
    await seed(paths.staged, "first");
    await atomicReplaceDirectory({ ...paths, stagedDir: paths.staged, outputDir: paths.output, backupDir: paths.backup, validate: async () => undefined });
    await expect(readFile(join(paths.output, "version.txt"), "utf8")).resolves.toBe("first");
  });

  it("restores the prior output when post-publish validation fails", async () => {
    const paths = await workspace();
    await seed(paths.output, "known-good");
    await seed(paths.staged, "invalid");
    await expect(atomicReplaceDirectory({ ...paths, stagedDir: paths.staged, outputDir: paths.output, backupDir: paths.backup, validate: async () => { throw new Error("invalid publish"); } })).rejects.toThrow("invalid publish");
    await expect(readFile(join(paths.output, "version.txt"), "utf8")).resolves.toBe("known-good");
  });
});
