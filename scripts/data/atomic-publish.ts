import { rename, rm } from "node:fs/promises";

interface AtomicReplaceOptions {
  outputDir: string;
  stagedDir: string;
  backupDir: string;
  validate: () => Promise<void>;
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function atomicReplaceDirectory({ outputDir, stagedDir, backupDir, validate }: AtomicReplaceOptions): Promise<void> {
  await rm(backupDir, { recursive: true, force: true });
  let hasBackup = false;
  try {
    try {
      await rename(outputDir, backupDir);
      hasBackup = true;
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }
    await rename(stagedDir, outputDir);
    await validate();
    if (hasBackup) await rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    await rm(outputDir, { recursive: true, force: true });
    if (hasBackup) await rename(backupDir, outputDir);
    throw error;
  }
}
