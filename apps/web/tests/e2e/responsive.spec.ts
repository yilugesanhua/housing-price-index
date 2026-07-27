import { expect, test } from "@playwright/test";

const viewports = [
  { name: "phone-320", width: 320, height: 720 },
  { name: "phone-375", width: 375, height: 812 },
  { name: "phone-384", width: 384, height: 824 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop-1366", width: 1366, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-landscape", width: 844, height: 390 },
] as const;

test("keeps the page and chart stable across required viewports", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?v=1&metric=mom&type=new&range=120&cities=beijing,shanghai,guangzhou");
    await expect(page.locator(".trend-chart[role='img']")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".city-card")).toHaveCount(6);
    const state = await page.evaluate(() => {
      const chart = document.querySelector<HTMLCanvasElement>(".trend-chart canvas");
      const introColumn = document.querySelector<HTMLElement>(".intro-row > div");
      const introCopy = document.querySelector<HTMLElement>(".intro-copy");
      let paintedSamples = 0;
      if (chart) {
        const context = chart.getContext("2d");
        const pixels = context?.getImageData(0, 0, chart.width, chart.height).data;
        if (pixels) for (let index = 3; index < pixels.length; index += 256) if (pixels[index] > 0) paintedSamples += 1;
      }
      return {
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        analysisNavOverflow: document.querySelector<HTMLElement>(".analysis-nav")
          ? document.querySelector<HTMLElement>(".analysis-nav")!.scrollWidth - document.querySelector<HTMLElement>(".analysis-nav")!.clientWidth
          : 0,
        filterPanelDisplay: getComputedStyle(document.querySelector<HTMLElement>("#filter-panel")!).display,
        mobileScopeDisplay: document.querySelector<HTMLElement>(".mobile-scope-badges")
          ? getComputedStyle(document.querySelector<HTMLElement>(".mobile-scope-badges")!).display
          : "none",
        mobileScopeColumns: document.querySelector<HTMLElement>(".mobile-scope-badges")
          ? getComputedStyle(document.querySelector<HTMLElement>(".mobile-scope-badges")!).gridTemplateColumns.split(" ").length
          : 0,
        mobileScopeFontSize: document.querySelector<HTMLElement>(".mobile-scope-badges select")
          ? Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".mobile-scope-badges select")!).fontSize)
          : 0,
        chartWidth: chart?.width ?? 0,
        chartHeight: chart?.height ?? 0,
        paintedSamples,
        introCopyWidthGap: window.innerWidth <= 767 && introColumn && introCopy
          ? introColumn.getBoundingClientRect().width - introCopy.getBoundingClientRect().width
          : null,
        topbarPosition: getComputedStyle(document.querySelector<HTMLElement>(".topbar")!).position,
        analysisNavLinksDisplay: getComputedStyle(document.querySelector<HTMLElement>(".analysis-nav-links")!).display,
      };
    });
    expect(state.horizontalOverflow, `${viewport.name} page overflow`).toBeLessThanOrEqual(0);
    expect(state.analysisNavOverflow, `${viewport.name} analysis nav overflow`).toBeLessThanOrEqual(0);
    if (viewport.width <= 767 || (viewport.width <= 900 && viewport.height <= 600)) {
      expect(state.filterPanelDisplay, `${viewport.name} compact filter panel`).toBe("none");
      expect(state.mobileScopeDisplay, `${viewport.name} mobile quick filters`).toBe("grid");
      expect(state.mobileScopeFontSize, `${viewport.name} quick filter font size`).toBeGreaterThanOrEqual(16);
    }
    if (viewport.width <= 340) expect(state.mobileScopeColumns, `${viewport.name} quick filter columns`).toBe(2);
    expect(state.chartWidth, `${viewport.name} chart width`).toBeGreaterThan(200);
    expect(state.chartHeight, `${viewport.name} chart height`).toBeGreaterThan(250);
    expect(state.paintedSamples, `${viewport.name} chart pixels`).toBeGreaterThan(10);
    if (viewport.width <= 767) {
      expect(state.introCopyWidthGap, `${viewport.name} intro copy width`).not.toBeNull();
      expect(state.introCopyWidthGap ?? 1, `${viewport.name} intro copy width`).toBeLessThanOrEqual(1);
    }
    if (viewport.name === "phone-landscape") {
      expect(state.topbarPosition, "landscape topbar does not consume sticky height").toBe("relative");
      expect(state.analysisNavLinksDisplay, "landscape prioritizes filters over section shortcuts").toBe("none");
    }
    if (testInfo.project.name === "desktop" && viewport.name === "phone-390") await page.screenshot({ path: "../../docs/screenshots/mobile-390x844.png", fullPage: true });
    if (testInfo.project.name === "desktop" && viewport.name === "desktop-1440") await page.screenshot({ path: "../../docs/screenshots/desktop-1440x900.png", fullPage: true });
  }
});

test("keeps key mobile touch targets at least 44px with adequate spacing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?v=1&metric=yoy&type=resale&range=60&cities=beijing,shanghai,guangzhou");
  await expect(page.getByRole("region", { name: "数据筛选" })).toBeHidden();
  await expect(page.locator(".filter-toggle")).toHaveCount(0);
  await page.getByRole("button", { name: "恢复默认筛选" }).click();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();

  const mobileLayout = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null;
    const fontSize = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : null;
    };
    const quickFilters = Array.from(document.querySelectorAll<HTMLElement>(".scope-badges-interactive .scope-filter"));
    const heading = rect(".overview-section .section-heading h2");
    const meta = rect(".overview-section .section-meta");
    return {
      latestDisplay: getComputedStyle(document.querySelector<HTMLElement>(".latest-readout")!).display,
      quickFilterCount: quickFilters.length,
      quickFilterWidthDelta: quickFilters.length ? Math.max(...quickFilters.map((element) => element.getBoundingClientRect().width)) - Math.min(...quickFilters.map((element) => element.getBoundingClientRect().width)) : null,
      metaBelowHeading: Boolean(heading && meta && meta.top >= heading.bottom),
      metaTextAlign: getComputedStyle(document.querySelector<HTMLElement>(".overview-section .section-meta")!).textAlign,
      directionFontSize: fontSize(".direction"),
      cardMetaFontSize: fontSize(".city-card-bottom"),
    };
  });
  expect(mobileLayout.latestDisplay).toBe("none");
  expect(mobileLayout.quickFilterCount).toBe(4);
  expect(mobileLayout.quickFilterWidthDelta).not.toBeNull();
  expect(mobileLayout.quickFilterWidthDelta ?? 1).toBeLessThanOrEqual(1);
  expect(mobileLayout.metaBelowHeading).toBe(true);
  expect(mobileLayout.metaTextAlign).toBe("left");
  if (mobileLayout.directionFontSize !== null) expect(mobileLayout.directionFontSize).toBeGreaterThanOrEqual(12);
  if (mobileLayout.cardMetaFontSize !== null) expect(mobileLayout.cardMetaFontSize).toBeGreaterThanOrEqual(12);

  const targets = await page.locator("button, select, summary, a.brand, .method-section a, .site-footer a").evaluateAll((elements) => elements.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];
    return [{ label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName, width: rect.width, height: rect.height }];
  }));
  expect(targets.length).toBeGreaterThan(10);
  for (const target of targets) {
    expect(target.width, `${target.label} touch width`).toBeGreaterThanOrEqual(43.5);
    expect(target.height, `${target.label} touch height`).toBeGreaterThanOrEqual(43.5);
  }

  const [zoomIn, zoomOut] = await Promise.all([
    page.getByRole("button", { name: "放大趋势图" }).boundingBox(),
    page.getByRole("button", { name: "缩小趋势图" }).boundingBox(),
  ]);
  expect(zoomIn).not.toBeNull();
  expect(zoomOut).not.toBeNull();
  if (zoomIn && zoomOut) expect(zoomOut.x - (zoomIn.x + zoomIn.width), "zoom control spacing").toBeGreaterThanOrEqual(7.5);

  const legendButtons = page.getByRole("group", { name: "显示或隐藏趋势线" }).getByRole("button");
  const [firstLegend, secondLegend] = await Promise.all([legendButtons.nth(0).boundingBox(), legendButtons.nth(1).boundingBox()]);
  expect(firstLegend).not.toBeNull();
  expect(secondLegend).not.toBeNull();
  if (firstLegend && secondLegend) expect(secondLegend.x - (firstLegend.x + firstLegend.width), "legend spacing").toBeGreaterThanOrEqual(7.5);
});
