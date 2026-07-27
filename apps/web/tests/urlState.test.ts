import { beforeEach, describe, expect, it } from "vitest";
import { clearStoredViewState, DEFAULT_VIEW, parseViewState, readInitialViewState, readViewState, VIEW_STORAGE_KEY, writeViewState } from "../src/urlState";

describe("view URL state", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
  });

  it("falls back for invalid values and caps cities", () => {
    const state = readViewState("?v=1&metric=bad&type=bad&range=2&cities=beijing,shanghai,guangzhou,shenzhen");
    expect(state.metric).toBe(DEFAULT_VIEW.metric);
    expect(state.propertyType).toBe(DEFAULT_VIEW.propertyType);
    expect(state.range).toBe(120);
    expect(state.cities).toEqual(["beijing", "shanghai", "guangzhou"]);
    expect(state.focusCity).toBe("beijing");
  });

  it("reports an invalid area band and restores all areas", () => {
    expect(parseViewState("?v=1&size=unknown")).toMatchObject({
      state: { sizeBand: "all" },
      notice: "链接包含无效筛选，已恢复对应默认值。",
    });
  });

  it("serializes a stable shareable state", () => {
    writeViewState({ metric: "yoy", propertyType: "resale", range: 36, cities: ["xiamen", "fuzhou"], focusCity: "fuzhou", sizeBand: "90_144" });
    expect(window.location.search).toBe("?v=1&metric=yoy&type=resale&range=36&cities=xiamen%2Cfuzhou&focus=fuzhou&size=90_144");
    expect(JSON.parse(window.localStorage.getItem(VIEW_STORAGE_KEY) ?? "{}")).toMatchObject({ version: 1 });
  });

  it("preserves an explicitly empty trend selection and its observation city", () => {
    expect(readViewState("?v=1&metric=yoy&type=resale&range=120&cities=&focus=xiamen")).toMatchObject({
      cities: [],
      focusCity: "xiamen",
    });
    writeViewState({ metric: "yoy", propertyType: "resale", range: 120, cities: [], focusCity: "xiamen", sizeBand: "all" });
    expect(window.location.search).toBe("?v=1&metric=yoy&type=resale&range=120&cities=&focus=xiamen&size=all");
  });

  it("reports capped city lists and unsupported link versions", () => {
    expect(parseViewState("?v=1&cities=beijing,shanghai,guangzhou,shenzhen")).toMatchObject({
      state: { cities: ["beijing", "shanghai", "guangzhou"] },
      notice: "主图最多比较3座城市，已保留链接中的前3座。",
    });
    expect(parseViewState("?v=0&metric=yoy")).toEqual({ state: DEFAULT_VIEW, notice: "分享链接版本过旧，已恢复默认筛选。" });
  });

  it("restores and clears versioned local state without blocking defaults", () => {
    writeViewState({ metric: "yoy", propertyType: "resale", range: 60, cities: ["fuzhou"], focusCity: "fuzhou", sizeBand: "gt144" });
    window.history.replaceState(null, "", "/");
    expect(readInitialViewState().state).toMatchObject({ metric: "yoy", cities: ["fuzhou"], sizeBand: "gt144" });
    clearStoredViewState();
    expect(readInitialViewState().state).toEqual(DEFAULT_VIEW);
  });

  it("restores an independently selected focus city", () => {
    expect(readViewState("?v=1&cities=xiamen,fuzhou&focus=fuzhou").focusCity).toBe("fuzhou");
    expect(parseViewState("?v=1&cities=xiamen,fuzhou&focus=beijing")).toMatchObject({
      state: { focusCity: "beijing", cities: ["xiamen", "fuzhou"] },
      notice: null,
    });
  });
});
