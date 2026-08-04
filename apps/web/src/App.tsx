import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertCircle, ArrowDownRight, ArrowUpRight, BarChart3, Check, ChevronDown, CircleHelp, ExternalLink, Info, Layers3, MapPin, Plus, RefreshCw, RotateCcw, Search, Share2, Trash2, X } from "lucide-react";
import { CITY_IDS, CITY_NAMES, CITY_SEARCH_ALIASES, FEATURED_CITY_IDS, formatChange, formatChangeMagnitude, formatIndex, formatReleaseDate, getChange, getMarketPosition, getWindowRecords, type CityId, type DataManifest, type MarketBreadthPoint, type MarketPosition, type Metric, type PriceRecord, type PropertyType, type RankedMarketCity, type SizeBand } from "@housing/core";
import { cityDataUrl, validateManifest, validateMarketBreadthData, validatePublishedData } from "./dataValidation";
import { clearStoredViewState, DEFAULT_VIEW, readInitialViewState, writeViewState, type ViewState } from "./urlState";
import { ChartErrorBoundary } from "./ChartErrorBoundary";

const TrendChart = lazy(() => import("./TrendChart").then((module) => ({ default: module.TrendChart })));
const BreadthHistoryChart = lazy(() => import("./BreadthHistoryChart").then((module) => ({ default: module.BreadthHistoryChart })));

type DataState = { manifest: DataManifest; overviewRecords: PriceRecord[]; marketRecords: PriceRecord[]; breadthRecords: MarketBreadthPoint[]; cityRecords: Partial<Record<CityId, PriceRecord[]>> };
type ToastState = { message: string; actionLabel?: string; onAction?: () => void };

const cityOptions = CITY_IDS.map((id) => ({ id, name: CITY_NAMES[id] }));
const featuredCityOptions = FEATURED_CITY_IDS.map((id) => ({ id, name: CITY_NAMES[id] }));
const contactUrl = import.meta.env.VITE_CONTACT_URL?.trim() || null;
const isInternalPreview = import.meta.env.VITE_APP_ENV !== "public";

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function fetchCityRecords(manifest: DataManifest, city: CityId, signal?: AbortSignal): Promise<PriceRecord[]> {
  try {
    const payload = await fetchJson<unknown>(`${cityDataUrl(manifest, city)}?v=${encodeURIComponent(manifest.dataset_version)}`, { cache: "default", signal });
    return validatePublishedData(payload, manifest, { expectedRecordCount: manifest.city_record_counts[city], allowedCities: [city] });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError" && signal?.aborted) throw error;
    const detail = error instanceof Error && error.name === "AbortError" ? "请求超时" : "暂时无法读取";
    throw new Error(`${CITY_NAMES[city]}趋势数据${detail}`);
  }
}

function App() {
  const [initialView] = useState(readInitialViewState);
  const [data, setData] = useState<DataState | null>(null);
  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trendLoadError, setTrendLoadError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [view, setView] = useState<ViewState>(initialView.state);
  const viewRef = useRef(view);
  const [linkNotice, setLinkNotice] = useState<string | null>(initialView.notice);
  const [showCityMenu, setShowCityMenu] = useState(false);
  const [isMobileCitySheet, setIsMobileCitySheet] = useState(() => window.matchMedia("(max-width: 767px), (max-width: 900px) and (max-height: 600px)").matches);
  const [cityQuery, setCityQuery] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [activeSection, setActiveSection] = useState("overview");
  const toastTimeoutRef = useRef<number | null>(null);
  const lastLoadedAtRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);
  const cityMenuRef = useRef<HTMLDivElement>(null);
  const cityDialogRef = useRef<HTMLDivElement>(null);
  const cityTriggerRef = useRef<HTMLButtonElement>(null);
  const citySearchRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setLoadError(null);
    setTrendLoadError(null);
    try {
      const manifest = validateManifest(await fetchJson<unknown>("/data/manifest.json", { cache: "no-store", signal: controller.signal }));
      const [overviewPayload, marketPayload, breadthPayload] = await Promise.all([
        fetchJson<unknown>(`${manifest.overview_data_url}?v=${encodeURIComponent(manifest.dataset_version)}`, { cache: "default", signal: controller.signal }),
        fetchJson<unknown>(`${manifest.market_data_url}?v=${encodeURIComponent(manifest.dataset_version)}`, { cache: "default", signal: controller.signal }),
        manifest.schema_version === "1.3.0" ? fetchJson<unknown>(`${manifest.breadth_data_url}?v=${encodeURIComponent(manifest.dataset_version)}`, { cache: "default", signal: controller.signal }) : Promise.resolve(null),
      ]);
      const overviewRecords = validatePublishedData(overviewPayload, manifest, { expectedRecordCount: manifest.overview_record_count, allowedCities: FEATURED_CITY_IDS });
      const marketRecords = validatePublishedData(marketPayload, manifest, { expectedRecordCount: manifest.market_record_count });
      const breadthRecords = breadthPayload ? validateMarketBreadthData(breadthPayload, manifest) : [];
      if (generation !== loadGenerationRef.current) return;
      lastLoadedAtRef.current = Date.now();
      // 先展示首屏摘要；城市趋势分片在下一阶段加载，避免单个分片阻塞整个页面。
      setData({ manifest, overviewRecords, marketRecords, breadthRecords, cityRecords: {} });
      setLoading(false);
      const cities = viewRef.current.cities;
      if (cities.length === 0) return;
      setTrendLoading(true);
      const cityResults = await Promise.allSettled(cities.map(async (city) => [city, await fetchCityRecords(manifest, city, controller.signal)] as const));
      if (generation !== loadGenerationRef.current) return;
      const cityEntries = cityResults.filter((result): result is PromiseFulfilledResult<readonly [CityId, PriceRecord[]]> => result.status === "fulfilled");
      const failedCount = cityResults.length - cityEntries.length;
      setData((current) => current?.manifest.dataset_version === manifest.dataset_version ? { ...current, cityRecords: { ...current.cityRecords, ...Object.fromEntries(cityEntries.map((result) => result.value)) } } : current);
      if (failedCount > 0) setTrendLoadError(failedCount === cities.length ? "趋势分片暂时无法读取" : `${failedCount}座城市的趋势分片暂时无法读取`);
    } catch (error) {
      if (generation !== loadGenerationRef.current || controller.signal.aborted) return;
      setLoadError(error instanceof Error && error.name === "AbortError" ? "网络请求超时" : error instanceof Error ? error.message : "数据加载失败");
      setLoading(false);
    } finally {
      if (generation === loadGenerationRef.current) {
        setTrendLoading(false);
        if (loadControllerRef.current === controller) loadControllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => () => {
    loadControllerRef.current?.abort();
    if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
  }, []);

  useEffect(() => {
    const handleOnline = () => { setIsOffline(false); void loadData(); };
    const handleOffline = () => setIsOffline(true);
    const handlePageShow = (event: PageTransitionEvent) => { if (event.persisted) void loadData(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoadedAtRef.current > 5 * 60_000) void loadData();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadData]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px), (max-width: 900px) and (max-height: 600px)");
    const update = () => setIsMobileCitySheet(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateViewportHeight = () => document.documentElement.style.setProperty("--visual-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
    updateViewportHeight();
    viewport?.addEventListener("resize", updateViewportHeight);
    window.addEventListener("orientationchange", updateViewportHeight);
    return () => {
      viewport?.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener("orientationchange", updateViewportHeight);
      document.documentElement.style.removeProperty("--visual-viewport-height");
    };
  }, []);

  const closeCityMenu = useCallback(() => {
    setShowCityMenu(false);
    window.requestAnimationFrame(() => cityTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!showCityMenu) {
      setCityQuery("");
      return;
    }
    window.requestAnimationFrame(() => {
      if (isMobileCitySheet) cityDialogRef.current?.focus();
      else citySearchRef.current?.focus();
    });
    const previousBodyOverflow = document.body.style.overflow;
    if (isMobileCitySheet) document.body.style.overflow = "hidden";
    const handlePointerDown = (event: PointerEvent) => {
      if (!isMobileCitySheet && cityMenuRef.current && !cityMenuRef.current.contains(event.target as Node)) closeCityMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCityMenu();
        return;
      }
      if (event.key !== "Tab" || !isMobileCitySheet || !cityDialogRef.current) return;
      const focusable = [...cityDialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeCityMenu, isMobileCitySheet, showCityMenu]);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const sections = ["overview", "market", "trend"].map((id) => document.getElementById(id)).filter((item): item is HTMLElement => Boolean(item));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target.id) setActiveSection(visible.target.id);
    }, { rootMargin: "-132px 0px -58%", threshold: [0.05, 0.25, 0.5] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [data]);

  const dismissToast = () => {
    if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = null;
    setToast(null);
  };

  const scheduleToast = (nextToast: ToastState, duration: number) => {
    if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
    setToast(nextToast);
    toastTimeoutRef.current = window.setTimeout(() => {
      toastTimeoutRef.current = null;
      setToast(null);
    }, duration);
  };

  const showToast = (message: string) => {
    scheduleToast({ message }, 2400);
  };

  const updateView = (next: ViewState) => {
    viewRef.current = next;
    setView(next);
    writeViewState(next);
  };

  const ensureCityRecords = async (cities: CityId[]) => {
    if (!data) return;
    const datasetVersion = data.manifest.dataset_version;
    const missing = cities.filter((city) => !data.cityRecords[city]);
    if (missing.length === 0) return;
    setTrendLoading(true);
    setTrendLoadError(null);
    try {
      const results = await Promise.allSettled(missing.map(async (city) => [city, await fetchCityRecords(data.manifest, city)] as const));
      const entries = results.filter((result): result is PromiseFulfilledResult<readonly [CityId, PriceRecord[]]> => result.status === "fulfilled").map((result) => result.value);
      if (entries.length > 0) setData((current) => current?.manifest.dataset_version === datasetVersion ? { ...current, cityRecords: { ...current.cityRecords, ...Object.fromEntries(entries) } } : current);
      const failedCount = results.length - entries.length;
      if (failedCount > 0) {
        const message = failedCount === missing.length ? "趋势分片暂时无法读取" : `${failedCount}座城市的趋势分片暂时无法读取`;
        setTrendLoadError(message);
        throw new Error(message);
      }
    } finally {
      setTrendLoading(false);
    }
  };

  const resetView = () => {
    void ensureCityRecords(DEFAULT_VIEW.cities).then(() => updateView(DEFAULT_VIEW));
  };

  const restoreDefaultFilters = () => {
    const previousView = view;
    const next = { ...view, metric: DEFAULT_VIEW.metric, propertyType: DEFAULT_VIEW.propertyType, range: DEFAULT_VIEW.range, sizeBand: DEFAULT_VIEW.sizeBand };
    updateView(next);
    scheduleToast({ message: "筛选已恢复默认", actionLabel: "撤销", onAction: () => { updateView(previousView); dismissToast(); } }, 5000);
  };

  const restoreDefaultCities = () => {
    const previousSelection = { cities: view.cities, focusCity: view.focusCity };
    void ensureCityRecords(DEFAULT_VIEW.cities).then(() => {
      updateView({ ...view, cities: [...DEFAULT_VIEW.cities], focusCity: DEFAULT_VIEW.focusCity });
      scheduleToast({ message: "趋势城市已恢复默认", actionLabel: "撤销", onAction: () => { updateView({ ...view, ...previousSelection }); dismissToast(); } }, 5000);
    });
  };

  const clearSavedFilters = () => {
    const previousView = view;
    clearStoredViewState();
    scheduleToast({
      message: "本地保存已清除，当前筛选保持不变",
      actionLabel: "恢复保存",
      onAction: () => {
        writeViewState(previousView);
        dismissToast();
      },
    }, 5000);
  };

  const selectedRecords = useMemo(() => {
    if (!data) return [];
    const records = view.cities.flatMap((city) => data.cityRecords[city] ?? []);
    return getWindowRecords(records.filter((record) => record.property_type === view.propertyType && record.size_band === view.sizeBand), view.range);
  }, [data, view.cities, view.propertyType, view.range, view.sizeBand]);

  const overviewTrendRecords = useMemo(() => data?.overviewRecords.filter((record) => record.property_type === view.propertyType && record.size_band === view.sizeBand) ?? [], [data, view.propertyType, view.sizeBand]);

  const latestMonth = data?.manifest.dataset_as_of ?? "—";
  const latestRecords = useMemo(() => overviewTrendRecords.filter((record) => record.stat_month === latestMonth), [overviewTrendRecords, latestMonth]);
  const overviewCities = useMemo(() => featuredCityOptions.map((city) => {
    const record = latestRecords.find((item) => item.city_id === city.id);
    return { ...city, record, value: record ? getChange(record, view.metric) : null };
  }).sort((a, b) => {
    if (a.value === null && b.value === null) return FEATURED_CITY_IDS.indexOf(a.id) - FEATURED_CITY_IDS.indexOf(b.id);
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return b.value - a.value || FEATURED_CITY_IDS.indexOf(a.id) - FEATURED_CITY_IDS.indexOf(b.id);
  }), [latestRecords, view.metric]);

  const marketPosition = useMemo(() => data ? getMarketPosition(data.marketRecords, view.propertyType, view.metric, view.focusCity, view.sizeBand) : null, [data, view.focusCity, view.metric, view.propertyType, view.sizeBand]);
  const breadthHistory = useMemo(() => data?.breadthRecords.filter((record) => record.property_type === view.propertyType && record.size_band === view.sizeBand && record.metric === view.metric).slice(-view.range) ?? [], [data, view.metric, view.propertyType, view.range, view.sizeBand]);

  const selectFocusCity = (focusCity: CityId) => {
    const currentView = viewRef.current;
    const shouldAddToTrend = !currentView.cities.includes(focusCity) && currentView.cities.length < 3;
    const apply = () => {
      const latestView = viewRef.current;
      const cities = latestView.cities.includes(focusCity) || latestView.cities.length >= 3 ? latestView.cities : [...latestView.cities, focusCity];
      updateView({ ...latestView, cities, focusCity });
    };
    if (shouldAddToTrend) void ensureCityRecords([focusCity]).then(apply).catch((error) => showToast(error instanceof Error ? error.message : "城市数据加载失败"));
    else apply();
  };

  const cityGroups = useMemo(() => {
    const query = cityQuery.trim().toLowerCase().replace(/\s+/g, "");
    const matches = cityOptions
      .filter((city) => !query || city.name.includes(query) || city.id.includes(query) || CITY_SEARCH_ALIASES[city.id].includes(query))
      .sort((a, b) => a.id.localeCompare(b.id, "en"));
    if (query) return [{ label: "搜索结果", cities: matches }];
    const featured = new Set<CityId>(FEATURED_CITY_IDS);
    const groups = new Map<string, typeof cityOptions>();
    for (const city of matches) {
      if (featured.has(city.id)) continue;
      const letter = city.id[0].toUpperCase();
      const group = groups.get(letter) ?? [];
      group.push(city);
      groups.set(letter, group);
    }
    const sortedFeaturedCities = [...featuredCityOptions].sort((a, b) => a.id.localeCompare(b.id, "en"));
    return [{ label: "常用城市", cities: sortedFeaturedCities }, ...[...groups].map(([label, cities]) => ({ label, cities }))];
  }, [cityQuery]);

  const toggleCity = (city: CityId) => {
    const currentView = viewRef.current;
    const isSelected = currentView.cities.includes(city);
    if (!isSelected && currentView.cities.length >= 3) {
      showToast("主图最多比较3座城市");
      return;
    }
    if (isSelected) {
      const cities = currentView.cities.filter((item) => item !== city);
      const focusCity = currentView.focusCity === city && cities.length > 0 ? cities[0] : currentView.focusCity;
      updateView({ ...currentView, cities, focusCity });
      return;
    }
    void ensureCityRecords([city]).then(() => {
      const latestView = viewRef.current;
      if (latestView.cities.includes(city)) return;
      if (latestView.cities.length >= 3) {
        showToast("主图最多比较3座城市");
        return;
      }
      updateView({ ...latestView, cities: [...latestView.cities, city], focusCity: city });
    }).catch((error) => showToast(error instanceof Error ? error.message : "城市数据加载失败"));
  };

  const share = async () => {
    const url = window.location.href;
    const isWeChat = /MicroMessenger/i.test(navigator.userAgent);
    if (navigator.share && !isWeChat) {
      try {
        await navigator.share({
          title: "70城住宅价格指数",
          text: "查看国家统计局70城住宅价格指数变化",
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      showToast(isWeChat ? "链接已复制，也可用微信右上角菜单分享" : "分享链接已复制");
      return;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      textarea.remove();
      showToast(copied ? (isWeChat ? "链接已复制，也可用微信右上角菜单分享" : "分享链接已复制") : isWeChat ? "请使用微信右上角菜单分享当前页面" : "无法自动复制，请长按地址栏复制链接");
    }
  };

  const statusLabel = data?.manifest.data_status === "current" ? "数据已更新" : data?.manifest.data_status === "stale" ? "数据已过期" : "数据更新中";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/">
            <span className="brand-mark" aria-hidden="true"><BarChart3 size={18} strokeWidth={2.2} /></span>
            <span><strong>70城住宅指数</strong><small>全国城市观察</small></span>
          </a>
          <div className="topbar-actions">
            {isInternalPreview && <span className="preview-chip"><span className="preview-dot" aria-hidden="true" />内部预览</span>}
            <span className="mobile-latest" aria-label={`数据截止 ${latestMonth}`}>{latestMonth}</span>
            <span className={`status-chip status-${data?.manifest.data_status ?? "updating"}`} role="status" aria-live="polite"><span className="status-dot" />{statusLabel}</span>
            <button className="icon-button" type="button" onClick={share} aria-label="分享当前页面" title="分享当前页面"><Share2 size={18} aria-hidden="true" /></button>
          </div>
        </div>
      </header>

      <main id="main-content" className="main-content">
        <section className="intro-row" aria-labelledby="page-title">
          <div>
            <h1 id="page-title">读懂你的城市住宅价格变化</h1>
            <p className="intro-copy">这里展示国家统计局住宅价格指数，不推算成交单价。环比看当月变化，同比看与上年同月的变化。</p>
            <span className="mobile-release-date">{data?.manifest.release_date ? `发布于 ${formatReleaseDate(data.manifest.release_date)}` : loading ? "正在读取发布日期…" : "发布日期暂不可用"}</span>
            <div className="focus-city-entry">
              <label htmlFor="focus-city-select"><MapPin size={16} aria-hidden="true" />重点城市</label>
              <div className="select-wrap"><select id="focus-city-select" name="focus-city" value={view.focusCity} onChange={(event) => selectFocusCity(event.target.value as CityId)}>{cityOptions.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></div>
            </div>
          </div>
          <div className="latest-readout" role="group" aria-label="数据截止信息">
            <span>数据截止</span>
            <strong>{latestMonth}</strong>
            <small>{data?.manifest.release_date ? `发布于 ${formatReleaseDate(data.manifest.release_date)}` : loading ? "正在读取数据清单…" : "暂时无法读取"}</small>
          </div>
        </section>

        <section id="filter-panel" className="filter-panel" aria-label="数据筛选">
          <div className="filter-group">
            <span className="filter-label" id="metric-label">指标</span>
            <Segmented labelId="metric-label" value={view.metric} options={[{ value: "mom", label: "环比" }, { value: "yoy", label: "同比" }]} onChange={(value) => updateView({ ...view, metric: value as Metric })} />
          </div>
          <div className="filter-group">
            <span className="filter-label" id="property-label">住宅类型</span>
            <Segmented labelId="property-label" value={view.propertyType} options={[{ value: "new", label: "新房" }, { value: "resale", label: "二手房" }]} onChange={(value) => updateView({ ...view, propertyType: value as PropertyType })} />
          </div>
          <span className="filter-summary">主图比较 {view.cities.length} 座城市 · 近 {view.range / 12} 年</span>
          <div className="filter-group filter-range">
            <label className="filter-label" htmlFor="range-select">时间范围</label>
            <div className="select-wrap"><select id="range-select" name="range" value={view.range} onChange={(event) => updateView({ ...view, range: Number(event.target.value) as ViewState["range"] })}><option value={36}>近3年</option><option value={60}>近5年</option><option value={120}>近10年</option></select><ChevronDown size={16} aria-hidden="true" /></div>
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor="size-select">面积段</label>
            <div className="select-wrap"><select id="size-select" name="size" value={view.sizeBand} onChange={(event) => updateView({ ...view, sizeBand: event.target.value as SizeBand })}><option value="all">全部面积</option><option value="le90">90㎡及以下</option><option value="90_144">90-144㎡</option><option value="gt144">144㎡以上</option></select><ChevronDown size={16} aria-hidden="true" /></div>
          </div>
          <button className="filter-reset-button" type="button" onClick={restoreDefaultFilters}><RotateCcw size={15} aria-hidden="true" />恢复默认筛选</button>
        </section>

        <nav className="analysis-nav" aria-label="页面数据导航">
          {isMobileCitySheet ? <ScopeBadges
            propertyType={view.propertyType}
            metric={view.metric}
            sizeBand={view.sizeBand}
            range={view.range}
            label="当前查看口径"
            className="mobile-scope-badges"
            onPropertyTypeChange={(propertyType) => updateView({ ...view, propertyType })}
            onMetricChange={(metric) => updateView({ ...view, metric })}
            onSizeBandChange={(sizeBand) => updateView({ ...view, sizeBand })}
            onRangeChange={(range) => updateView({ ...view, range })}
          /> : <ScopeBadges
            propertyType={view.propertyType}
            metric={view.metric}
            sizeBand={view.sizeBand}
            range={view.range}
            label="当前查看口径"
            className="desktop-scope-badges"
          />}
          <div className="analysis-nav-links">
            {[{ id: "overview", label: "城市概览" }, { id: "market", label: "市场位置" }, { id: "trend", label: "长期趋势" }].map((item) => <a key={item.id} href={`#${item.id}`} aria-current={activeSection === item.id ? "location" : undefined} onClick={() => setActiveSection(item.id)}>{item.label}</a>)}
          </div>
          <button className="quick-filter-reset" type="button" onClick={restoreDefaultFilters} aria-label="恢复默认筛选" title="恢复默认筛选"><RotateCcw size={16} aria-hidden="true" /></button>
        </nav>

        {marketPosition?.focus && <section className={`focus-insight ${marketPosition.focus.value > 0 ? "is-up" : marketPosition.focus.value < 0 ? "is-down" : "is-flat"}`} aria-label={`${CITY_NAMES[view.focusCity]}最新住宅价格变化摘要`}>
          <div className="focus-insight-city"><span>重点城市</span><strong>{CITY_NAMES[view.focusCity]}</strong></div>
          <p>本月70城中，{marketPosition.counts.up}城上涨、{marketPosition.counts.down}城下跌；{CITY_NAMES[view.focusCity]}{view.metric === "mom" ? "环比" : "同比"}{marketPosition.focus.value > 0 ? "上涨" : marketPosition.focus.value < 0 ? "下降" : "持平"}<strong>{formatChangeMagnitude(marketPosition.focus.value)}</strong>，位于第<strong>{marketPosition.focus.rank}/{marketPosition.ranked.length}</strong>位{marketPosition.focus.tied ? "（并列）" : ""}。</p>
        </section>}

        {linkNotice && <div className="notice notice-info" role="status"><Info size={17} aria-hidden="true" /><span>{linkNotice}</span><button type="button" onClick={() => setLinkNotice(null)}>知道了</button></div>}
        {isOffline && <div className="notice notice-info" role="status"><Info size={17} aria-hidden="true" /><span>当前处于离线状态，已加载的数据仍可查看；网络恢复后会自动重试。</span></div>}
        {data?.manifest.data_status !== "current" && data && <div className={`notice ${data.manifest.data_status === "stale" ? "notice-error" : "notice-info"}`} role="status"><Info size={17} aria-hidden="true" /><span>{data.manifest.status_reason}</span><a href={data.manifest.latest_official_url} target="_blank" rel="noreferrer">查看官方发布 <ExternalLink size={14} aria-hidden="true" /></a></div>}
        {loadError && <div className="notice notice-error" role="alert"><AlertCircle size={17} aria-hidden="true" /><span>{loadError}。请检查网络后重试。</span><button type="button" onClick={() => void loadData()} disabled={loading}><RefreshCw size={15} aria-hidden="true" />{loading ? "正在重试…" : "重试"}</button></div>}
        {trendLoadError && !loadError && <div className="notice notice-info" role="status"><Info size={17} aria-hidden="true" /><span>{trendLoadError}，首屏摘要不受影响。</span><button type="button" onClick={() => void loadData()} disabled={loading || trendLoading}><RefreshCw size={15} aria-hidden="true" />重试趋势</button></div>}

        <section className="overview-section" id="overview" aria-labelledby="overview-title">
          <div className="section-heading"><div className="section-title-block"><div className="section-title-row"><h2 id="overview-title">常用六城概览</h2></div><span className="section-meta">按变动率从高到低</span></div></div>
          {loading && !data ? <OverviewSkeleton /> : <div className="city-grid">{overviewCities.map((city, index) => <CityCard key={city.id} rank={index + 1} city={city} metric={view.metric} trendRecords={overviewTrendRecords.filter((record) => record.city_id === city.id).slice(-12)} hasData={Boolean(data?.overviewRecords.length)} />)}</div>}
        </section>

        <MarketPositionSection
          loading={loading && !data}
          position={marketPosition}
          marketCity={view.focusCity}
          breadthHistory={breadthHistory}
        />

        <section className="trend-section" id="trend" aria-labelledby="trend-title">
          <div className="section-heading trend-heading"><div className="section-title-block"><div className="section-title-row"><h2 id="trend-title">长期趋势</h2></div><span className="section-meta">趋势城市最多3座，重点城市默认同步加入</span></div><div className="trend-heading-right"><span className="selection-count">已选 {view.cities.length}/3 城市</span><button className="outline-button trend-reset-button" type="button" onClick={restoreDefaultCities} aria-label="恢复默认城市" title="恢复默认城市"><RefreshCw size={15} aria-hidden="true" /><span>恢复默认城市</span></button></div></div>
          <div className="city-picker" role="group" aria-label="选择趋势城市"><span className="city-picker-label">趋势城市</span>{view.cities.map((cityId) => <button key={cityId} type="button" className="city-chip city-chip-selected" aria-pressed="true" title="从主图移除" onClick={() => toggleCity(cityId)}>{CITY_NAMES[cityId]}<span className="chip-check" aria-hidden="true"><X size={12} strokeWidth={2.5} /></span></button>)}
          <div className="city-add-menu" ref={cityMenuRef}>
            <button ref={cityTriggerRef} className="city-add-trigger" type="button" aria-haspopup="dialog" aria-expanded={showCityMenu} aria-controls="city-add-options" onClick={() => showCityMenu ? closeCityMenu() : setShowCityMenu(true)}>
              <Plus size={15} aria-hidden="true" />添加城市
            </button>
            {showCityMenu && <>
              <button className="city-add-backdrop" type="button" tabIndex={-1} aria-label="关闭城市选择" onClick={closeCityMenu} />
                <div ref={cityDialogRef} className="city-add-popover" id="city-add-options" role="dialog" aria-modal={isMobileCitySheet} aria-label="添加趋势城市" tabIndex={-1}>
                <div className="city-add-header"><div><strong>添加城市</strong><span aria-live="polite">已选 {view.cities.length}/3</span></div><button className="compact-icon-button city-add-close" type="button" aria-label="关闭城市选择" onClick={closeCityMenu}><X size={17} aria-hidden="true" /></button></div>
                <label className="city-search"><Search size={16} aria-hidden="true" /><span className="sr-only">搜索城市</span><input ref={citySearchRef} name="city-search" value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder="搜索城市，如厦门或 xm…" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" /></label>
                <div className="city-add-list" role="region" aria-label="全部70城">
                  {cityGroups.map((group) => <div className="city-option-group" role="group" aria-label={group.label} key={group.label}><div className="city-option-group-label">{group.label}</div>{group.cities.map((city) => {
                    const selected = view.cities.includes(city.id);
                    const disabled = selected || view.cities.length >= 3;
                    return <button key={city.id} className={`city-add-option ${selected ? "city-add-option-selected" : ""}`} type="button" aria-pressed={selected} data-city-id={city.id} disabled={disabled} onClick={() => toggleCity(city.id)}>
                      <span>{city.name}</span>{selected ? <span className="city-add-status"><Check size={14} aria-hidden="true" />已选</span> : <Plus size={14} aria-hidden="true" />}
                    </button>;
                  })}</div>)}
                  {cityGroups.every((group) => group.cities.length === 0) && <div className="city-search-empty">没有匹配的城市</div>}
                </div>
                <div className="city-add-footer"><span aria-live="polite">{view.cities.length >= 3 ? "已满3座，请先移除一座" : `还可添加 ${3 - view.cities.length} 座城市`}</span><button type="button" onClick={closeCityMenu}>完成</button></div>
              </div>
            </>}
          </div>
          </div>
          {loading && !data
            ? <div className="chart-loading" role="status" aria-live="polite" aria-label="趋势数据加载中" aria-busy="true"><div className="skeleton skeleton-chart" /></div>
            : view.cities.length === 0
              ? <div className="chart-empty" role="region" aria-label="趋势图空状态"><div className="empty-chart-icon"><BarChart3 size={26} aria-hidden="true" /></div><strong>尚未选择趋势城市</strong><span aria-live="polite">添加城市后即可查看长期趋势和累计变化。</span><div className="empty-actions"><button type="button" className="outline-button" onClick={() => setShowCityMenu(true)}><Plus size={15} aria-hidden="true" />添加城市</button><button type="button" className="text-button" onClick={restoreDefaultCities}>恢复默认城市</button></div></div>
              : <ChartErrorBoundary title="历史走势图" onRetry={() => window.location.reload()}><Suspense fallback={<div className="chart-loading" role="status" aria-live="polite" aria-label="正在加载图表组件" aria-busy="true"><div className="skeleton skeleton-chart" /></div>}><TrendChart records={selectedRecords} cities={view.cities} metric={view.metric} hasData={Boolean(data?.overviewRecords.length || selectedRecords.length)} loading={trendLoading} loadError={selectedRecords.length === 0 ? trendLoadError : null} onReset={resetView} /></Suspense></ChartErrorBoundary>}
        </section>

        <section className="method-section" id="data-notice" aria-labelledby="method-title">
          <div className="method-icon"><CircleHelp size={19} aria-hidden="true" /></div>
          <div><div className="method-heading-line"><h2 id="method-title">来源、口径与免责声明</h2><span role="status" aria-live="polite">数据状态：{statusLabel}</span></div><p>数据引自国家统计局网站（www.stats.gov.cn）“70个大中城市商品住宅销售价格变动情况”。本站仅将官方指数减100展示为变动率，不提供平均房价、原因解释或投资建议。2026年1月起采用2025年新基期并调整分类权数，趋势图已在对应月份标注。</p></div>
          <div className="method-actions"><a href={data?.manifest.latest_official_url ?? "https://www.stats.gov.cn/sj/zxfb/index.html"} target="_blank" rel="noreferrer">查看最新官方来源 <ExternalLink size={15} aria-hidden="true" /></a><button type="button" onClick={clearSavedFilters}><Trash2 size={14} aria-hidden="true" />清除本地保存</button></div>
        </section>
      </main>
      <footer className="site-footer">{isInternalPreview && <span>内部预览</span>}<a href="#data-notice">来源与免责声明</a>{contactUrl && <a href={contactUrl}>纠错与反馈</a>}</footer>
      {toast && <div className="toast" role="status" aria-live="polite"><span>{toast.message}</span>{toast.actionLabel && toast.onAction && <button type="button" onClick={toast.onAction}>{toast.actionLabel}</button>}</div>}
    </div>
  );
}

function Segmented({ labelId, value, options, onChange }: { labelId: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <div className="segmented" role="group" aria-labelledby={labelId}>{options.map((option) => <button key={option.value} type="button" className={value === option.value ? "segmented-selected" : ""} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

function ScopeBadges({ propertyType, metric, sizeBand, range, label, className = "scope-badges", onPropertyTypeChange, onMetricChange, onSizeBandChange, onRangeChange }: {
  propertyType: PropertyType;
  metric: Metric;
  sizeBand?: SizeBand;
  range?: ViewState["range"];
  label: string;
  className?: string;
  onPropertyTypeChange?: (value: PropertyType) => void;
  onMetricChange?: (value: Metric) => void;
  onSizeBandChange?: (value: SizeBand) => void;
  onRangeChange?: (value: ViewState["range"]) => void;
}) {
  const sizeLabel = { all: "全部面积", le90: "90㎡及以下", "90_144": "90-144㎡", gt144: "144㎡以上" }[sizeBand ?? "all"];
  if (onPropertyTypeChange && onMetricChange && onSizeBandChange && onRangeChange && sizeBand && range) return <div className={`scope-badges ${className} scope-badges-interactive`} aria-label={label}>
    <label className={`scope-filter ${propertyType === "new" ? "scope-badge-new" : "scope-badge-resale"}`}>
      <select aria-label="快速筛选住宅类型" value={propertyType} onChange={(event) => onPropertyTypeChange(event.target.value as PropertyType)}><option value="new">新房</option><option value="resale">二手房</option></select><ChevronDown size={12} aria-hidden="true" />
    </label>
    <label className="scope-filter scope-badge-metric">
      <select aria-label="快速筛选指标" value={metric} onChange={(event) => onMetricChange(event.target.value as Metric)}><option value="mom">环比</option><option value="yoy">同比</option></select><ChevronDown size={12} aria-hidden="true" />
    </label>
    <label className="scope-filter scope-badge-size">
      <select aria-label="快速筛选面积段" value={sizeBand} onChange={(event) => onSizeBandChange(event.target.value as SizeBand)}><option value="all">全部面积</option><option value="le90">90㎡及以下</option><option value="90_144">90-144㎡</option><option value="gt144">144㎡以上</option></select><ChevronDown size={12} aria-hidden="true" />
    </label>
    <label className="scope-filter scope-badge-range">
      <select aria-label="快速筛选时间范围" value={range} onChange={(event) => onRangeChange(Number(event.target.value) as ViewState["range"])}><option value={36}>近3年</option><option value={60}>近5年</option><option value={120}>近10年</option></select><ChevronDown size={12} aria-hidden="true" />
    </label>
  </div>;
  return <div className={`scope-badges ${className}`} aria-label={label}><span className={propertyType === "new" ? "scope-badge-new" : "scope-badge-resale"}>{propertyType === "new" ? "新房" : "二手房"}</span><span className="scope-badge-metric">{metric === "mom" ? "环比" : "同比"}</span>{sizeBand && <span className="scope-badge-size">{sizeLabel}</span>}</div>;
}

function OverviewSkeleton() {
  return <div className="city-grid" aria-label="常用六城最新数据加载中" aria-busy="true">{FEATURED_CITY_IDS.map((city) => <div key={city} className="city-card skeleton-card"><span className="skeleton skeleton-label" /><span className="skeleton skeleton-value" /><span className="skeleton skeleton-row" /></div>)}</div>;
}

function marketPeerWindow(items: RankedMarketCity[], focusCity: CityId, limit = 5): RankedMarketCity[] {
  if (items.length <= limit) return items;
  const focusIndex = items.findIndex((item) => item.city_id === focusCity);
  if (focusIndex < 0) return items.slice(0, limit);
  const start = Math.max(0, Math.min(focusIndex - Math.floor(limit / 2), items.length - limit));
  return items.slice(start, start + limit);
}

function movementLabel(value: number): string {
  return value > 0 ? "上涨" : value < 0 ? "下跌" : "持平";
}

function ComparisonList({ items, focusCity, ariaLabel }: { items: RankedMarketCity[]; focusCity: CityId; ariaLabel: string }) {
  return <ol className="market-ranking" aria-label={ariaLabel}>{items.map((item) => <li key={item.city_id} className={item.city_id === focusCity ? "market-ranking-focus" : ""} aria-current={item.city_id === focusCity ? "true" : undefined}>
    <span className="market-rank-number">{item.rank}</span>
    <span className="market-rank-city">{CITY_NAMES[item.city_id]}{item.city_id === focusCity && <small>当前</small>}</span>
    <span className={`market-rank-value ${item.value > 0 ? "market-value-up" : item.value < 0 ? "market-value-down" : ""}`}><span className="sr-only">{movementLabel(item.value)}</span>{formatChange(item.value)}</span>
  </li>)}</ol>;
}

function MarketPositionSection({ loading, position, marketCity, breadthHistory }: {
  loading: boolean;
  position: MarketPosition | null;
  marketCity: CityId;
  breadthHistory: MarketBreadthPoint[];
}) {
  const total = position ? position.counts.up + position.counts.flat + position.counts.down : 0;
  const width = (count: number) => total > 0 ? `${count / total * 100}%` : "0%";
  const tierPeers = position ? marketPeerWindow(position.tier.ranked, marketCity) : [];

  return <section className="market-section" id="market" aria-labelledby="market-title">
    <div className="section-heading market-heading">
      <div className="section-title-block"><div className="section-title-row"><h2 id="market-title">市场位置</h2></div><span className="section-meta">重点城市的全国、同级和省内位置 · 最新月份</span></div>
      <div className="market-city-current" aria-label={`当前重点城市 ${CITY_NAMES[marketCity]}`}><span>重点城市</span><strong>{CITY_NAMES[marketCity]}</strong></div>
    </div>
    {loading ? <div className="market-grid market-skeleton" aria-label="市场位置数据加载中" aria-busy="true">{[0, 1, 2].map((item) => <div key={item} className="market-panel"><span className="skeleton skeleton-label" /><span className="skeleton skeleton-value" /><span className="skeleton skeleton-row" /><span className="skeleton skeleton-row" /></div>)}</div>
      : position?.focus ? <div className={`market-grid ${position.province.ranked.length <= 1 ? "market-grid-single-province" : ""}`}>
        <div className="market-panel market-temperature" role="group" aria-labelledby="temperature-title">
          <div className="market-panel-title"><Activity size={17} aria-hidden="true" /><div><h3 id="temperature-title">70城温度</h3><span>{position.stat_month} · 共{total}城</span></div></div>
          <div className="breadth-bar" role="img" aria-label={`${position.counts.up}城上涨，${position.counts.flat}城持平，${position.counts.down}城下跌；缺失数据不计入统计`}>
            <span className="breadth-up" style={{ width: width(position.counts.up) }} />
            <span className="breadth-flat" style={{ width: width(position.counts.flat) }} />
            <span className="breadth-down" style={{ width: width(position.counts.down) }} />
          </div>
          <dl className="breadth-counts">
            <div><dt><i className="breadth-dot breadth-dot-up" />上涨</dt><dd>{position.counts.up}<small>城</small></dd></div>
            <div><dt><i className="breadth-dot breadth-dot-flat" />持平</dt><dd>{position.counts.flat}<small>城</small></dd></div>
            <div><dt><i className="breadth-dot breadth-dot-down" />下跌</dt><dd>{position.counts.down}<small>城</small></dd></div>
          </dl>
          <p className="market-summary"><strong>{CITY_NAMES[marketCity]}</strong>位于70城第 <strong>{position.focus.rank}/{position.ranked.length}</strong> 位{position.focus.tied ? "（并列）" : ""}</p>
          {position.counts.missing > 0 && <p className="market-note" role="status">另有{position.counts.missing}城当前指标缺失，未计入排名和涨平跌统计。</p>}
        </div>

        <div className="market-panel" role="group" aria-labelledby="tier-title">
          <div className="market-panel-title"><Layers3 size={17} aria-hidden="true" /><div><h3 id="tier-title">同级城市对比</h3><span>{position.tier.label} · {position.tier.ranked.length}城</span></div></div>
          <div className="market-benchmark"><span>{CITY_NAMES[marketCity]}第 <strong>{position.tier.focus?.rank ?? "—"}/{position.tier.ranked.length}</strong> 位</span><span>同级平均 <strong>{formatChange(position.tier.average)}</strong></span></div>
          <ComparisonList items={tierPeers} focusCity={marketCity} ariaLabel={`${position.tier.label}相邻排名`} />
          {position.tier.ranked.length > tierPeers.length && <p className="market-note">显示当前城市前后相邻排名</p>}
        </div>

        <div className={`market-panel market-province-panel ${position.province.ranked.length <= 1 ? "market-province-single" : ""}`} role="group" aria-labelledby="province-title">
          <div className="market-panel-title"><MapPin size={17} aria-hidden="true" /><div><h3 id="province-title">省内城市对比</h3><span>70城样本 · {position.province.name}</span></div></div>
          {position.province.ranked.length > 1 ? <>
            <div className="market-benchmark"><span>{CITY_NAMES[marketCity]}第 <strong>{position.province.focus?.rank ?? "—"}/{position.province.ranked.length}</strong> 位</span><span>样本共{position.province.ranked.length}城</span></div>
            <ComparisonList items={position.province.ranked} focusCity={marketCity} ariaLabel={`${position.province.name}在70城样本中的城市排名`} />
            <p className="market-note">仅比较国家统计局70城名单中的同省城市</p>
          </> : <div className="market-single-city"><strong>{CITY_NAMES[marketCity]}</strong><span>70城名单中，该省级区域仅收录本市，暂无省内横向比较。</span></div>}
          </div>
      </div> : <div className="market-empty" role="status">当前筛选缺少最新70城数据，请查看来源或稍后重试。</div>}
    {!loading && breadthHistory.length > 0 && <ChartErrorBoundary title="70城温度走势" onRetry={() => window.location.reload()}><Suspense fallback={<div className="breadth-history-loading skeleton" aria-label="70城温度走势加载中" />}><BreadthHistoryChart records={breadthHistory} /></Suspense></ChartErrorBoundary>}
  </section>;
}

function Sparkline({ records, metric, cityName }: { records: PriceRecord[]; metric: Metric; cityName: string }) {
  const values = records.map((record) => getChange(record, metric));
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length < 2) return <span className="mini-trend-empty">趋势不足</span>;
  const min = Math.min(...finite, 0);
  const max = Math.max(...finite, 0);
  const range = max - min || 1;
  const point = (value: number, index: number) => `${(index / Math.max(1, values.length - 1)) * 72},${24 - ((value - min) / range) * 22}`;
  const segments: string[][] = [];
  let current: string[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 1) segments.push(current);
      current = [];
    } else current.push(point(value, index));
  });
  if (current.length > 1) segments.push(current);
  const zeroY = 24 - ((0 - min) / range) * 22;
  return <span className="mini-trend"><span className="sr-only">{cityName}最近12个月{metric === "mom" ? "环比" : "同比"}趋势</span><svg viewBox="0 0 72 26" width="72" height="26" aria-hidden="true" focusable="false"><line x1="0" y1={zeroY} x2="72" y2={zeroY} className="spark-zero" />{segments.map((points, index) => <polyline key={index} points={points.join(" ")} className="spark-line" />)}</svg></span>;
}

function CityCard({ rank, city, metric, trendRecords, hasData }: { rank: number; city: { id: CityId; name: string; record?: PriceRecord; value: number | null }; metric: Metric; trendRecords: PriceRecord[]; hasData: boolean }) {
  const { record, value } = city;
  return <article className="city-card"><div className="city-card-top"><span><span className="city-rank" aria-label={`排序第${rank}`}>{rank}</span><span className="city-name">{city.name}</span></span>{value !== null && <span className={`direction ${value > 0 ? "direction-up" : value < 0 ? "direction-down" : "direction-flat"}`}>{value > 0 ? <ArrowUpRight size={15} aria-hidden="true" /> : value < 0 ? <ArrowDownRight size={15} aria-hidden="true" /> : null}{value > 0 ? "上涨" : value < 0 ? "下跌" : "持平"}</span>}</div><div className="city-value">{hasData ? formatChange(value) : "—"}</div><div className="city-card-bottom"><span>{record ? `指数 ${formatIndex(metric === "mom" ? record.mom_index : record.yoy_index)}` : hasData ? "当前筛选暂无记录" : "暂时没有可用数据"}</span><Sparkline records={trendRecords} metric={metric} cityName={city.name} /></div></article>;
}

export default App;
