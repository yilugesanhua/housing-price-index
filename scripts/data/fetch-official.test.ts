import { describe, expect, it } from "vitest";
import { fetchOfficialBytes } from "./fetch-official";

describe("official page fetching", () => {
  it("retries when a successful response fails while its body is read", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: true, status: 200, url: "https://www.stats.gov.cn/a.html", arrayBuffer: async () => { throw new Error("body timeout"); } } as unknown as Response;
      }
      return { ok: true, status: 200, url: "https://www.stats.gov.cn/a.html", arrayBuffer: async () => Buffer.from("official html") } as unknown as Response;
    };
    const result = await fetchOfficialBytes("https://www.stats.gov.cn/a.html", { fetchImpl: fetchImpl as typeof fetch, retryDelayMs: () => 0 });
    expect(calls).toBe(2);
    expect(result.html.toString("utf8")).toBe("official html");
  });
});
