import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export function readRawArchiveSync(htmlPath: string): Buffer {
  try {
    return readFileSync(htmlPath);
  } catch (error) {
    try {
      return gunzipSync(readFileSync(`${htmlPath}.gz`));
    } catch (compressedError) {
      throw new Error(`raw archive unavailable: ${String(error)}; compressed fallback: ${String(compressedError)}`);
    }
  }
}
