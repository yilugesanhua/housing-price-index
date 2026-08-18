import { describe, expect, it, vi } from "vitest";
import { discoverOfficialPages } from "./discover";

const listHtml = `
  <html><body>
    <script>createPageHTML(1, 1, "index", "html")</script>
    <a href="202608/t20260817_1965050.html" title="2026年7月份70个大中城市住宅销售价格变动情况">2026年7月份70个大中城市住宅销售价格变动情况</a>
  </body></html>`;

function timeoutError(): Error {
  const cause = Object.assign(new Error("connect timed out"), { code: "ETIMEDOUT" });
  return new TypeError("fetch failed", { cause });
}

describe("official list discovery", () => {
  it("retries transient network failures and only accepts a fresh successful response", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(new Response(listHtml)) as unknown as typeof fetch;

    const result = await discoverOfficialPages(1, { fetchImpl, retryDelayMs: 0 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.pages).toEqual([
      {
        title: "2026年7月份70个大中城市住宅销售价格变动情况",
        href: "https://www.stats.gov.cn/sj/zxfb/202608/t20260817_1965050.html",
      },
    ]);
  });

  it("retries temporary HTTP responses", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(listHtml)) as unknown as typeof fetch;

    await expect(discoverOfficialPages(1, { fetchImpl, retryDelayMs: 0 })).resolves.toMatchObject({ pages_checked: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed after three transient connection failures", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(timeoutError()) as unknown as typeof fetch;

    await expect(discoverOfficialPages(1, { fetchImpl, retryDelayMs: 0 })).rejects.toThrow("fetch failed");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-temporary official response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 })) as unknown as typeof fetch;

    await expect(discoverOfficialPages(1, { fetchImpl, retryDelayMs: 0 })).rejects.toThrow("HTTP 404");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
