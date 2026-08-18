import { expect, test } from "@playwright/test";

test("shows a stable skeleton while data loading is delayed", async ({ page }) => {
  await page.route("**/data/manifest.json", async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({ response });
  });
  await page.goto("/");
  await expect(page.getByLabel("六城最新数据加载中")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByLabel("市场位置数据加载中")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByLabel("趋势数据加载中")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("heading", { name: "常用六城概览" })).toBeVisible();
  await expect(page.locator(".trend-chart[role='img']")).toBeVisible({ timeout: 10000 });
});

test("recovers after a manifest request failure", async ({ page }) => {
  let attempts = 0;
  await page.route("**/data/manifest.json", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.abort("failed");
    else await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("请检查网络后重试");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("数据状态：数据已更新")).toBeVisible();
  await expect(page.locator(".trend-chart[role='img']")).toBeVisible();
});

test("shows an actionable empty state for a valid zero-record dataset", async ({ page }) => {
  const manifest = {
    dataset_as_of: "2026-06",
    schema_version: "1.3.0",
    dataset_version: "2026-06-000000000000",
    data_url: "/data/data-2026-06-000000000000.json",
    release_date: "2026-07-15",
    generated_at: "2026-07-15T00:00:00.000Z",
    record_count: 0,
    overview_data_url: "/data/overview-2026-06-000000000000.json",
    overview_record_count: 0,
    market_data_url: "/data/market-2026-06-000000000000.json",
    market_record_count: 0,
    breadth_data_url: "/data/breadth-2026-06-000000000000.json",
    breadth_record_count: 0,
    city_data_url_template: "/data/cities/{city_id}-2026-06-000000000000.json",
    city_record_counts: Object.fromEntries(["beijing", "tianjin", "shijiazhuang", "taiyuan", "huhehaote", "shenyang", "dalian", "changchun", "haerbin", "shanghai", "nanjing", "hangzhou", "ningbo", "hefei", "fuzhou", "xiamen", "nanchang", "jinan", "qingdao", "zhengzhou", "wuhan", "changsha", "guangzhou", "shenzhen", "nanning", "haikou", "chongqing", "chengdu", "guiyang", "kunming", "xian", "lanzhou", "xining", "yinchuan", "wulumuqi", "tangshan", "qinhuangdao", "baotou", "dandong", "jinzhou", "jilin", "mudanjiang", "wuxi", "xuzhou", "yangzhou", "wenzhou", "jinhua", "bengbu", "anqing", "quanzhou", "jiujiang", "ganzhou", "yantai", "jining", "luoyang", "pingdingshan", "yichang", "xiangyang", "yueyang", "changde", "shaoguan", "zhanjiang", "huizhou", "guilin", "beihai", "sanya", "luzhou", "nanchong", "zunyi", "dali"].map((city) => [city, 0])),
    coverage_start: "2016-01",
    coverage_end: "2026-06",
    validation_status: "passed",
    data_status: "current",
    status_reason: "fixture",
    latest_official_month: "2026-06",
    latest_official_url: "https://www.stats.gov.cn/sj/zxfb/index.html",
    last_checked_at: "2026-07-15T00:00:00.000Z",
    next_check_due_at: "2026-08-15T00:00:00.000Z",
    coverage_gaps: [],
  };
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: manifest }));
  await page.route("**/data/overview-2026-06-000000000000.json**", (route) => route.fulfill({ json: { dataset_version: "2026-06-000000000000", records: [] } }));
  await page.route("**/data/market-2026-06-000000000000.json**", (route) => route.fulfill({ json: { dataset_version: "2026-06-000000000000", records: [] } }));
  await page.route("**/data/breadth-2026-06-000000000000.json**", (route) => route.fulfill({ json: { dataset_version: "2026-06-000000000000", records: [] } }));
  await page.route("**/data/cities/*-2026-06-000000000000.json**", (route) => route.fulfill({ json: { dataset_version: "2026-06-000000000000", records: [] } }));
  await page.goto("/");
  await expect(page.getByText("当前筛选没有可用记录")).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复默认视图" })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看官方来源" })).toBeVisible();
});

test("switches area bands and updates the official scope labels", async ({ page }, testInfo) => {
  await page.goto("/?v=1&metric=mom&type=new&range=120&cities=beijing,shanghai,guangzhou&size=all");
  const areaSelect = testInfo.project.name === "mobile"
    ? page.getByLabel("快速筛选面积段")
    : page.getByRole("combobox", { name: "面积段", exact: true });
  await expect(areaSelect).toHaveValue("all");
  await areaSelect.selectOption("le90");
  await expect(page).toHaveURL(/size=le90/);
  await expect(areaSelect).toHaveValue("le90");
  await expect(page.locator(".city-card").filter({ hasText: "北京" })).toContainText(/[+-]\d+\.\d%/);
});

test("renders a painted 70-city temperature history for the active scope", async ({ page }) => {
  await page.goto("/?v=1&metric=yoy&type=resale&range=60&cities=xiamen&size=90_144");
  const history = page.locator(".breadth-history");
  await expect(history).toBeVisible({ timeout: 15_000 });
  await expect(history.getByText("按月统计上涨、持平和下跌城市数量")).toBeVisible();
  await expect(history.getByRole("slider", { name: "选择温度月份" })).toBeVisible();
  await expect(history.getByText("有效城市数 / 70")).toBeVisible();
  await expect(history.getByText("缺失 0城", { exact: true })).toHaveCount(0);
  await expect(history.locator(".breadth-history-detail strong").first()).toHaveText(/^20\d{2}-(0[1-9]|1[0-2])$/);
  await expect.poll(() => history.locator("canvas").count()).toBeGreaterThan(0);
  const painted = await history.locator("canvas").evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext("2d");
    const data = context?.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data;
    return data ? Array.from(data).filter((value, index) => index % 4 === 3 && value > 0).length : 0;
  });
  expect(painted).toBeGreaterThan(100);
  await expect(history).toContainText(/20\d{2}-(0[1-9]|1[0-2])：有效数据中上涨.*城/);
});
