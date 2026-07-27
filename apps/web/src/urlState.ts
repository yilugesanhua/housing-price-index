import type { CityId, HousingViewState, SizeBand } from "@housing/core";
import { CITY_IDS, DEFAULT_HOUSING_VIEW_STATE } from "@housing/core";

export type ViewState = HousingViewState;

export const DEFAULT_VIEW: ViewState = DEFAULT_HOUSING_VIEW_STATE;

export const VIEW_STORAGE_KEY = "housing-price-index:view:v1";

export interface ViewStateResult {
  state: ViewState;
  notice: string | null;
}

function parseCityList(value: string | null): { cities: CityId[]; invalid: boolean; capped: boolean } {
  if (value === null) return { cities: [...DEFAULT_VIEW.cities], invalid: false, capped: false };
  if (value === "") return { cities: [], invalid: false, capped: false };
  const values = value.split(",").filter(Boolean);
  const valid = [...new Set(values.filter((item): item is CityId => CITY_IDS.includes(item as CityId)))];
  return {
    cities: valid.length > 0 ? valid.slice(0, 3) : DEFAULT_VIEW.cities,
    invalid: values.length === 0 || valid.length !== values.length,
    capped: valid.length > 3,
  };
}

export function parseViewState(search: string): ViewStateResult {
  const params = new URLSearchParams(search);
  const hasState = ["v", "metric", "type", "range", "cities", "focus", "size"].some((key) => params.has(key));
  if (hasState && params.get("v") !== "1") {
    return { state: DEFAULT_VIEW, notice: "分享链接版本过旧，已恢复默认筛选。" };
  }
  const metric = params.get("metric") === "yoy" ? "yoy" : DEFAULT_VIEW.metric;
  const propertyType = params.get("type") === "resale" ? "resale" : DEFAULT_VIEW.propertyType;
  const rangeValue = Number(params.get("range"));
  const range = rangeValue === 36 || rangeValue === 60 || rangeValue === 120 ? rangeValue : DEFAULT_VIEW.range;
  const cityResult = parseCityList(params.get("cities"));
  const focusParam = params.get("focus");
  const validFocus = Boolean(focusParam && CITY_IDS.includes(focusParam as CityId));
  const focusCity = validFocus
    ? focusParam as CityId
    : cityResult.cities.length === 0 ? DEFAULT_VIEW.focusCity : cityResult.cities[0];
  const sizeBand = ["all", "le90", "90_144", "gt144"].includes(params.get("size") ?? "") ? params.get("size") as SizeBand : DEFAULT_VIEW.sizeBand;
  const invalid = (params.has("metric") && !["mom", "yoy"].includes(params.get("metric") ?? ""))
    || (params.has("type") && !["new", "resale"].includes(params.get("type") ?? ""))
    || (params.has("range") && ![36, 60, 120].includes(rangeValue))
    || cityResult.invalid
    || (params.has("size") && !["all", "le90", "90_144", "gt144"].includes(params.get("size") ?? ""))
    || (params.has("focus") && !validFocus);
    
  const notice = cityResult.capped
    ? "主图最多比较3座城市，已保留链接中的前3座。"
    : invalid ? "链接包含无效筛选，已恢复对应默认值。" : null;
  return { state: { metric, propertyType, range, cities: cityResult.cities, focusCity, sizeBand }, notice };
}

function readStoredViewState(): ViewState | null {
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: number; state?: Partial<ViewState> };
    if (parsed.version !== 1 || !parsed.state) return null;
    const query = new URLSearchParams({
      v: "1",
      metric: String(parsed.state.metric ?? ""),
      type: String(parsed.state.propertyType ?? ""),
      range: String(parsed.state.range ?? ""),
      cities: Array.isArray(parsed.state.cities) ? parsed.state.cities.join(",") : "",
      focus: String(parsed.state.focusCity ?? ""),
      size: String(parsed.state.sizeBand ?? ""),
    });
    return parseViewState(`?${query.toString()}`).state;
  } catch {
    return null;
  }
}

export function readInitialViewState(search = window.location.search): ViewStateResult {
  const parsed = parseViewState(search);
  const hasUrlState = ["v", "metric", "type", "range", "cities", "focus", "size"].some((key) => new URLSearchParams(search).has(key));
  if (hasUrlState) return parsed;
  return { state: readStoredViewState() ?? parsed.state, notice: null };
}

export function readViewState(search = window.location.search): ViewState {
  return parseViewState(search).state;
}

export function writeViewState(state: ViewState): void {
  const params = new URLSearchParams();
  params.set("v", "1");
  params.set("metric", state.metric);
  params.set("type", state.propertyType);
  params.set("range", String(state.range));
  params.set("cities", state.cities.join(","));
  params.set("focus", state.focusCity);
  params.set("size", state.sizeBand ?? DEFAULT_VIEW.sizeBand);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ version: 1, state }));
  } catch {
    // URL state remains the durable fallback when storage is unavailable.
  }
}

export function clearStoredViewState(): void {
  try {
    window.localStorage.removeItem(VIEW_STORAGE_KEY);
  } catch {
    // Browsing remains available when storage is blocked.
  }
}
