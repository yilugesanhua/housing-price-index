import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const contract = require("../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/discovery-contract.js") as {
  discoverOfficialPages: (requestedLimit: number, options: OfficialDiscoveryOptions) => Promise<OfficialPageDiscovery>;
};

export type OfficialPageDiscovery = {
  checked_at: string;
  list_url: string;
  pages_checked: number;
  pages: Array<{ title: string; href: string }>;
  responses?: Array<{
    requested_url: string;
    final_url: string;
    status: number;
    content_length: number;
    content_sha256: string;
    attempt: number;
  }>;
};

export type OfficialDiscoveryOptions = {
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  timeoutMs?: number;
};

// The shared CommonJS contract is also deployed to CloudBase. Keeping this
// wrapper typed lets GitHub use the exact same URL, retry, and title rules.
export async function discoverOfficialPages(requestedLimit = 0, options: OfficialDiscoveryOptions = {}): Promise<OfficialPageDiscovery> {
  return contract.discoverOfficialPages(requestedLimit, options);
}

async function main() {
  const requestedOutput = process.argv.find((arg) => arg.startsWith("--output="))?.split("=").slice(1).join("=");
  const output = resolve(requestedOutput || resolve("data", "discovered-official-pages.json"));
  const result = await discoverOfficialPages(0);
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Discovered ${result.pages.length} official release pages -> ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
