import { expect, test } from "@playwright/test";

test("shows the published six-city overview and current data state", async ({ page }, testInfo) => {
  const dataRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/data/")) dataRequests.push(request.url()); });
  await page.goto("/");
  await expect(page).toHaveTitle("70城住宅指数");
  await expect(page.getByRole("heading", { level: 1, name: "读懂你的城市住宅价格变化" })).toBeVisible();
  await expect(page.locator(".intro-copy")).toHaveText("这里展示国家统计局住宅价格指数，不推算成交单价。环比看当月变化，同比看与上年同月的变化。");
  await expect(page.locator(".preview-chip")).toHaveCount(1);
  await expect(page.locator(".site-footer").getByText("内部预览", { exact: true })).toHaveCount(1);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "/share-card.png");
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
  const shareImage = await page.request.get("/share-card.png");
  expect(shareImage.ok()).toBe(true);
  expect(shareImage.headers()["content-type"]).toContain("image/png");
  await expect(page.getByRole("heading", { name: "常用六城概览" })).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await expect(page.getByLabel("数据截止 2026-06")).toBeVisible();
    await expect(page.getByLabel("数据截止信息")).toBeHidden();
    await expect(page.locator(".mobile-release-date")).toContainText("发布于 2026年7月15日");
  } else {
    await expect(page.getByLabel("数据截止信息").getByText("2026-06")).toBeVisible();
  }
  await expect(page.locator(".trend-chart[role='img']")).toBeVisible();
  await expect(page.getByRole("heading", { name: "累计变化" })).toBeVisible();
  await expect(page.getByText("这是比较基准，不是实际元/㎡房价。", { exact: false })).toBeVisible();
  await expect(page.locator(".method-section").getByText("数据状态：数据已更新")).toBeVisible();
  await expect(page.locator(".site-footer")).not.toContainText("数据引自国家统计局网站");
  await expect(page.locator(".method-section").getByText("数据引自国家统计局网站（www.stats.gov.cn）", { exact: false })).toBeVisible();
  await expect(page.locator(".city-card")).toHaveCount(6);
  if (testInfo.project.name === "mobile") await expect(page.getByRole("region", { name: "数据筛选" })).toBeHidden();
  else await expect(page.getByRole("region", { name: "数据筛选" })).toBeVisible();
  await expect(page.locator(".filter-toggle")).toHaveCount(0);
  const cardTexts = await page.locator(".city-card").allTextContents();
  expect(cardTexts[0]).toContain("上海");
  expect(cardTexts[0]).toContain("+0.3%");
  const directionColors = await page.evaluate(() => ({
    up: getComputedStyle(document.querySelector(".direction-up") as HTMLElement).color,
    down: getComputedStyle(document.querySelector(".direction-down") as HTMLElement).color,
    breadthUp: getComputedStyle(document.querySelector(".breadth-up") as HTMLElement).backgroundColor,
    breadthDown: getComputedStyle(document.querySelector(".breadth-down") as HTMLElement).backgroundColor,
  }));
  expect(directionColors).toEqual({
    up: "rgb(178, 58, 50)",
    down: "rgb(15, 111, 93)",
    breadthUp: "rgb(201, 79, 69)",
    breadthDown: "rgb(22, 125, 103)",
  });
  expect(dataRequests.some((url) => /\/data\/data-/.test(url))).toBe(false);
  expect(dataRequests.some((url) => /\/data\/overview-/.test(url))).toBe(true);
  expect(dataRequests.some((url) => /\/data\/market-/.test(url))).toBe(true);
  expect(dataRequests.filter((url) => /\/data\/cities\//.test(url))).toHaveLength(3);
});

test("shows 70-city breadth, tier peers and province peers for new and resale homes", async ({ page }, testInfo) => {
  await page.goto("/?v=1&metric=mom&type=new&range=120&cities=xiamen,fuzhou");
  const market = page.getByRole("region", { name: "市场位置" });
  await expect(market).toBeVisible();
  await expect(market.getByRole("img", { name: "20城上涨，1城持平，49城下跌" })).toBeVisible();
  await expect(market.getByText("重点城市的全国、同级和省内位置 · 最新月份")).toBeVisible();
  const marketScope = page.getByLabel("当前查看口径");
  if (testInfo.project.name === "mobile") {
    await expect(marketScope.getByLabel("快速筛选住宅类型")).toHaveValue("new");
    await expect(marketScope.getByLabel("快速筛选指标")).toHaveValue("mom");
  } else {
    await expect(marketScope).toContainText("新房");
    await expect(marketScope).toContainText("环比");
  }
  await expect(market.getByText("厦门位于70城第", { exact: false })).toBeVisible();
  const tier = market.getByRole("group", { name: "同级城市对比" });
  await expect(tier.getByText("二线城市 · 31城")).toBeVisible();
  await expect(tier.getByText("同级平均", { exact: false })).toBeVisible();
  const province = market.getByRole("group", { name: "省内城市对比" });
  await expect(province.getByText("70城样本 · 福建")).toBeVisible();
  await expect(province.getByText("福州", { exact: true })).toBeVisible();
  await expect(province.locator(".market-rank-city").filter({ hasText: "厦门" })).toBeVisible();
  await expect(province.getByText("泉州", { exact: true })).toBeVisible();
  await expect(province.getByText("仅比较国家统计局70城名单中的同省城市")).toBeVisible();

  await expect(market.getByLabel("当前重点城市 厦门")).toBeVisible();
  await page.getByRole("combobox", { name: "重点城市" }).selectOption("fuzhou");
  await expect(page).toHaveURL(/focus=fuzhou/);
  await expect(market.getByLabel("当前重点城市 福州")).toBeVisible();
  await expect(market.getByText("福州位于70城第", { exact: false })).toBeVisible();
  await expect(province.locator("li[aria-current='true']").locator(".market-rank-city").filter({ hasText: "福州" })).toBeVisible();

  if (testInfo.project.name === "mobile") await page.getByLabel("快速筛选住宅类型").selectOption("resale");
  else await page.getByRole("group", { name: "住宅类型" }).getByRole("button", { name: "二手房" }).click();
  await expect(market.getByRole("img", { name: "9城上涨，1城持平，60城下跌" })).toBeVisible();
  await expect(marketScope).toContainText("二手房");
  await expect(marketScope).toContainText("环比");
});

test("lets users choose a focus city first and keeps navigation concise", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?v=1&metric=yoy&type=resale&range=60&cities=xiamen,fuzhou&focus=xiamen&size=all");
  const focusSelect = page.getByRole("combobox", { name: "重点城市" });
  await expect(focusSelect).toHaveValue("xiamen");
  await focusSelect.selectOption("quanzhou");
  await expect(page).toHaveURL(/focus=quanzhou/);
  await expect(page.getByRole("region", { name: "泉州最新住宅价格变化摘要" })).toContainText("泉州同比");
  await expect(page.getByRole("region", { name: "泉州最新住宅价格变化摘要" })).not.toContainText("下降+");
  await expect(page.getByRole("group", { name: "选择趋势城市" }).getByRole("button", { name: "泉州", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "页面数据导航" });
  await expect(nav.getByRole("link", { name: "城市概览" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "市场位置" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "长期趋势" })).toBeVisible();
  await expect(page.locator(".scope-badges")).toHaveCount(1);
  for (const item of [{ id: "overview", label: "城市概览" }, { id: "market", label: "市场位置" }, { id: "trend", label: "长期趋势" }]) {
    await nav.getByRole("link", { name: item.label }).click();
    const offset = await page.locator(`#${item.id}`).evaluate((section) => {
      const nav = document.querySelector<HTMLElement>(".analysis-nav");
      return nav ? section.getBoundingClientRect().top - nav.getBoundingClientRect().bottom : -1;
    });
    expect(offset, `${item.label} anchor offset`).toBeGreaterThanOrEqual(7.5);
  }
  await page.setViewportSize({ width: 320, height: 720 });
  await nav.getByRole("link", { name: "市场位置" }).click();
  const narrowOffset = await page.locator("#market").evaluate((section) => {
    const nav = document.querySelector<HTMLElement>(".analysis-nav");
    return nav ? section.getBoundingClientRect().top - nav.getBoundingClientRect().bottom : -1;
  });
  expect(narrowOffset, "320px market anchor offset").toBeGreaterThanOrEqual(7.5);
});

test("shares through the system share sheet and falls back to copying the URL", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as Window & { sharedData?: ShareData }).sharedData = data;
      },
    });
  });
  await page.goto("/?v=1&metric=yoy&type=resale&range=60&cities=xiamen&focus=xiamen&size=all");
  await page.getByRole("button", { name: "分享当前页面" }).click();
  const sharedData = await page.evaluate(() => (window as Window & { sharedData?: ShareData }).sharedData);
  expect(sharedData?.title).toBe("70城住宅价格指数");
  expect(sharedData?.url).toContain("metric=yoy");

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { copiedUrl?: string }).copiedUrl = value; } },
    });
  });
  await page.getByRole("button", { name: "分享当前页面" }).click();
  await expect(page.getByText("分享链接已复制")).toBeVisible();
  const copiedUrl = await page.evaluate(() => (window as Window & { copiedUrl?: string }).copiedUrl);
  expect(copiedUrl).toContain("cities=xiamen");
});

test("uses a WeChat-appropriate share fallback", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 MicroMessenger/8.0.50" });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { copiedUrl?: string }).copiedUrl = value; } },
    });
  });
  await page.goto("/?v=1&metric=yoy&type=resale&range=60&cities=xiamen&focus=xiamen&size=all");
  await page.getByRole("button", { name: "分享当前页面" }).click();
  await expect(page.getByText("链接已复制，也可用微信右上角菜单分享")).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { copiedUrl?: string }).copiedUrl)).toContain("metric=yoy");
});

test("keeps summaries usable when one trend shard fails", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route(/\/data\/cities\/beijing-[^/]+\.json/, (route) => route.abort("failed"));
  await page.goto("/?v=1&metric=mom&type=new&range=120&cities=beijing,shanghai&focus=beijing&size=all");
  await expect(page.locator(".city-card")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "市场位置" })).toBeVisible();
  await expect(page.getByText("1座城市的趋势分片暂时无法读取，首屏摘要不受影响。")).toBeVisible();
  await expect(page.locator(".trend-chart[role='img']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("group", { name: "显示或隐藏趋势线" }).getByRole("button", { name: "上海", exact: true })).toBeVisible();
});

test("shows an offline state and refreshes when the connection returns", async ({ page }) => {
  await page.goto("/?v=1&metric=mom&type=new&range=36&cities=xiamen&focus=xiamen&size=all");
  await expect(page.locator(".city-card")).toHaveCount(6);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("当前处于离线状态", { exact: false })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("当前处于离线状态", { exact: false })).toBeHidden();
  await expect(page.locator(".city-card")).toHaveCount(6);
});

test("restores a valid URL view state and caps city selection", async ({ page }, testInfo) => {
  await page.goto("/?v=1&metric=yoy&type=resale&range=36&cities=beijing,shanghai,guangzhou,shenzhen");
  const mobileFilterButton = page.getByRole("button", { name: "打开筛选" });
  if (await mobileFilterButton.isVisible()) await mobileFilterButton.click();
  const scope = page.getByLabel("当前查看口径");
  if (testInfo.project.name === "mobile") {
    await expect(page.getByLabel("快速筛选指标")).toHaveValue("yoy");
    await expect(page.getByLabel("快速筛选住宅类型")).toHaveValue("resale");
  } else {
    await expect(scope).toContainText("同比");
    await expect(scope).toContainText("二手房");
  }
  await expect(page.getByRole("group", { name: "选择趋势城市" }).getByRole("button", { name: "北京", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".city-chip-selected")).toHaveCount(3);
  await expect(page.getByText("主图最多比较3座城市，已保留链接中的前3座。")).toBeVisible();
  await page.getByText("查看精确数据").click();
  await expect(page.locator("#accessible-month option")).toHaveCount(36);
});

test("supports accessible legend, zoom controls and the full 120-month window", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/?v=1&metric=mom&type=new&range=120&cities=beijing,shanghai,guangzhou");
  await expect(page.locator(".trend-chart[role='img']")).toBeVisible({ timeout: 10000 });
  const legend = page.getByRole("group", { name: "显示或隐藏趋势线" });
  const beijingLegend = legend.getByRole("button", { name: "北京", exact: true });
  await expect(beijingLegend).toHaveAttribute("aria-pressed", "true");
  await beijingLegend.click();
  await expect(beijingLegend).toHaveAttribute("aria-pressed", "false");
  const shanghaiLegend = legend.getByRole("button", { name: "上海", exact: true });
  const guangzhouLegend = legend.getByRole("button", { name: "广州", exact: true });
  await shanghaiLegend.click();
  await guangzhouLegend.click();
  await expect(guangzhouLegend).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("至少保留一条趋势线")).toBeVisible();
  const zoomOut = page.getByRole("button", { name: "缩小趋势图" });
  await expect(zoomOut).toBeDisabled();
  const chartCanvas = page.locator(".trend-chart canvas");
  const box = await chartCanvas.boundingBox();
  expect(box).not.toBeNull();
  if (box && testInfo.project.name === "desktop") {
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
    await page.mouse.wheel(0, -500);
    await expect(zoomOut).toBeEnabled();
  }
  await page.getByRole("button", { name: "放大趋势图" }).click();
  await expect(zoomOut).toBeEnabled();
  await expect(page.locator(".chart-toolbar").getByText("当前：", { exact: false })).toBeVisible();
  if (box) {
    const x = box.x + box.width * 0.72;
    const y = box.y + box.height * 0.5;
    if (testInfo.project.name === "mobile") await page.touchscreen.tap(x, y);
    else await page.mouse.move(x, y);
  }
  await expect(page.locator(".trend-chart").getByText("原始指数", { exact: false })).toBeVisible();
  await expect(page.locator(".trend-chart").getByText("发布于", { exact: false })).toBeVisible();
  await page.locator(".cumulative-chart").scrollIntoViewIfNeeded();
  await expect(page.locator(".cumulative-chart[role='img']")).toBeVisible();
  const cumulativeCanvas = page.locator(".cumulative-chart canvas");
  await expect(cumulativeCanvas).toBeVisible({ timeout: 10000 });
  const cumulativeBox = await cumulativeCanvas.boundingBox();
  expect(cumulativeBox).not.toBeNull();
  const cumulativePainted = await cumulativeCanvas.evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext("2d");
    const pixels = context?.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data;
    return pixels ? Array.from(pixels).filter((value, index) => index % 4 === 3 && value > 0).length : 0;
  });
  expect(cumulativePainted).toBeGreaterThan(100);
  if (cumulativeBox) {
    const x = cumulativeBox.x + cumulativeBox.width * 0.72;
    const y = cumulativeBox.y + cumulativeBox.height * 0.5;
    if (testInfo.project.name === "mobile") await page.touchscreen.tap(x, y);
    else await page.mouse.move(x, y);
  }
  await expect(page.locator(".cumulative-chart").getByText("较高点", { exact: false })).toBeVisible();
  await page.getByText("查看精确数据").click();
  await expect(page.locator("#accessible-month option")).toHaveCount(120);
  if (testInfo.project.name === "mobile") {
    await expect(page.locator(".mobile-data-list")).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();
  } else {
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /累计值/ })).toBeVisible();
  }
});

test("keeps filter reset, city reset and local storage clearing in separate scopes", async ({ page }, testInfo) => {
  await page.goto("/?v=1&metric=yoy&type=resale&range=60&cities=fuzhou");
  const mobileFilterButton = page.getByRole("button", { name: "打开筛选" });
  if (await mobileFilterButton.isVisible()) await mobileFilterButton.click();
  await page.getByRole("button", { name: "恢复默认筛选" }).click();
  await expect(page.getByText("筛选已恢复默认")).toBeVisible();
  await page.getByRole("button", { name: "撤销" }).click();
  const scope = page.getByLabel("当前查看口径");
  await expect(scope).toContainText("同比");
  await expect(scope).toContainText("二手房");
  if (testInfo.project.name === "mobile") await expect(page.getByLabel("快速筛选时间范围")).toHaveValue("60");
  await page.getByRole("button", { name: "恢复默认城市" }).click();
  await expect(page.getByText("趋势城市已恢复默认")).toBeVisible();
  await expect(page.getByRole("group", { name: "选择趋势城市" }).getByRole("button", { name: "北京", exact: true })).toBeVisible();
  await page.locator(".method-section").getByRole("button", { name: "清除本地保存" }).click();
  await expect(page.getByText("本地保存已清除，当前筛选保持不变")).toBeVisible();
});

test("supports keyboard filtering with a visible focus indicator", async ({ page }, testInfo) => {
  await page.goto("/");
  const filterToggle = page.locator(".filter-toggle");
  if (await filterToggle.isVisible()) {
    await filterToggle.focus();
    await page.keyboard.press("Enter");
    await expect(filterToggle).toHaveAttribute("aria-expanded", "true");
  }

  const metricControl = testInfo.project.name === "mobile"
    ? page.getByLabel("快速筛选指标")
    : page.getByRole("group", { name: "指标" }).getByRole("button", { name: "同比" });
  await metricControl.focus();
  if (testInfo.project.name === "mobile") {
    await metricControl.press("End");
    await metricControl.press("Enter");
    await expect(metricControl).toHaveValue("yoy");
  } else {
    await metricControl.press("Enter");
    await expect(metricControl).toHaveAttribute("aria-pressed", "true");
  }
  const focusStyle = await metricControl.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(3);

  const legend = page.getByRole("group", { name: "显示或隐藏趋势线" }).getByRole("button", { name: "北京", exact: true });
  await legend.focus();
  await page.keyboard.press("Enter");
  await expect(legend).toHaveAttribute("aria-pressed", "false");
});

test("searches all 70 cities, adds one to the trend and keeps selected options disabled", async ({ page }, testInfo) => {
  await page.goto("/?v=1&metric=yoy&type=new&range=120&cities=fuzhou");
  const picker = page.getByRole("group", { name: "选择趋势城市" });
  const trigger = picker.getByRole("button", { name: "添加城市" });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "添加趋势城市" });
  await expect(menu).toBeVisible();
  if (testInfo.project.name === "mobile") await expect(menu).toBeFocused();
  else await expect(menu.getByRole("textbox", { name: "搜索城市" })).toBeFocused();
  await expect(menu).toHaveAttribute("aria-modal", testInfo.project.name === "mobile" ? "true" : "false");
  if (testInfo.project.name === "mobile") await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  const cityOrdering = await menu.locator(".city-option-group").evaluateAll((groups) => groups.map((group) => ({
    label: group.getAttribute("aria-label"),
    cities: [...group.querySelectorAll<HTMLElement>("[data-city-id]")].map((option) => option.dataset.cityId ?? ""),
  })));
  const alphabeticGroups = cityOrdering.slice(1).map((group) => group.label);
  expect(alphabeticGroups).toEqual([...alphabeticGroups].sort());
  for (const group of cityOrdering) expect(group.cities).toEqual([...group.cities].sort());
  await expect(menu.locator(".city-add-option small")).toHaveCount(0);
  await expect(menu.getByRole("button", { name: /福州/ })).toBeDisabled();
  await menu.getByRole("textbox", { name: "搜索城市" }).fill("wlmq");
  await menu.getByRole("button", { name: /乌鲁木齐/ }).click();
  await expect(picker.getByRole("button", { name: "乌鲁木齐", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(menu.getByRole("button", { name: /乌鲁木齐/ })).toBeDisabled();
  await expect(page).toHaveURL(/cities=fuzhou%2Cwulumuqi/);
  await menu.getByRole("button", { name: "完成" }).click();
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  if (testInfo.project.name === "mobile") await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
  await expect(page.getByRole("group", { name: "显示或隐藏趋势线" }).getByRole("button", { name: "乌鲁木齐", exact: true })).toBeVisible();
});

test("allows an empty trend chart, restores it from the empty state and keeps scope labels current", async ({ page }, testInfo) => {
  await page.goto("/?v=1&metric=mom&type=new&range=120&cities=xiamen&focus=xiamen");
  const scope = page.getByLabel("当前查看口径");
  await expect(page.locator(".scope-badges")).toHaveCount(1);
  await expect(scope).toContainText("新房");
  await expect(scope).toContainText("环比");

  await page.getByRole("group", { name: "选择趋势城市" }).getByRole("button", { name: "厦门", exact: true }).click();
  await expect(page.locator(".city-chip-selected")).toHaveCount(0);
  await expect(page.locator(".selection-count")).toHaveText("已选 0/3 城市");
  await expect(page.getByText("尚未选择趋势城市")).toBeVisible();
  await expect(page.getByLabel("当前重点城市 厦门")).toBeVisible();
  await expect(page).toHaveURL(/cities=&focus=xiamen/);

  await page.locator(".chart-empty").getByRole("button", { name: "添加城市" }).click();
  const menu = page.getByRole("dialog", { name: "添加趋势城市" });
  await menu.getByRole("textbox", { name: "搜索城市" }).fill("福州");
  await menu.getByRole("button", { name: /福州/ }).click();
  await expect(page.getByRole("group", { name: "显示或隐藏趋势线" }).getByRole("button", { name: "福州", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/cities=fuzhou&focus=fuzhou/);
  await menu.getByRole("button", { name: "完成" }).click();

  if (testInfo.project.name === "mobile") {
    await page.getByLabel("快速筛选指标").selectOption("yoy");
    await page.getByLabel("快速筛选住宅类型").selectOption("resale");
  } else {
    await page.getByRole("group", { name: "指标" }).getByRole("button", { name: "同比" }).click();
    await page.getByRole("group", { name: "住宅类型" }).getByRole("button", { name: "二手房" }).click();
  }
  await expect(scope).toContainText("二手房");
  await expect(scope).toContainText("同比");
});
