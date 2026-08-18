import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Page, ScreenshotOptions } from "@playwright/test";

export async function saveScreenshot(page: Page, path: string, options: ScreenshotOptions = {}) {
  const image = await page.screenshot(options);
  const outputPath = resolve(process.cwd(), path);
  await mkdir(dirname(outputPath), { recursive: true });

  try {
    if (image.equals(await readFile(outputPath))) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await writeFile(outputPath, image);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["UNKNOWN", "EPERM", "EACCES"].includes(code ?? "") || attempt === 19) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
}
