import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart } from "echarts/charts";
import { AriaComponent, DataZoomComponent, GraphicComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart3, ExternalLink, Info, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { CITY_NAMES, formatChange, formatCompactStatMonth, formatIndex, formatReleaseDate, formatStatMonth, getChange, getCumulativeIndexSeries, getPeakDrawdownSeries, type CityId, type Metric, type PriceRecord } from "@housing/core";

echarts.use([LineChart, AriaComponent, DataZoomComponent, GraphicComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

const LINE_TYPES = ["solid", "dashed", "dotted"] as const;
const LINE_SYMBOLS = ["circle", "rect", "triangle"] as const;

interface ChartPoint {
  value: number | null;
  rawIndex: number | null;
  releaseDate: string;
}

interface TooltipItem {
  axisValue: string;
  marker: string;
  seriesName: string;
  data: ChartPoint;
}

interface CumulativeTooltipItem {
  axisValue: string;
  marker: string;
  seriesName: string;
  data: {
    value: number | null;
    drawdown: number | null;
  };
}

interface TrendChartProps {
  records: PriceRecord[];
  cities: CityId[];
  metric: Metric;
  hasData: boolean;
  loading: boolean;
  loadError: string | null;
  onReset: () => void;
}

interface ZoomWindow {
  start: number;
  end: number;
}

function rawIndex(record: PriceRecord, metric: Metric): number | null {
  return metric === "mom" ? record.mom_index : record.yoy_index;
}

export function TrendChart({ records, cities, metric, hasData, loading, loadError, onReset }: TrendChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const cumulativeChartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<ReturnType<typeof echarts.init> | null>(null);
  const zoomWindowRef = useRef<ZoomWindow>({ start: 0, end: 100 });
  const [zoomWindow, setZoomWindow] = useState<ZoomWindow>(zoomWindowRef.current);
  const [hiddenCities, setHiddenCities] = useState<CityId[]>([]);
  const [legendNotice, setLegendNotice] = useState("");
  const [cumulativeReady, setCumulativeReady] = useState(false);
  const chartRecords = useMemo(() => records.filter((record) => cities.includes(record.city_id)), [records, cities]);
  const months = useMemo(() => [...new Set(chartRecords.map((record) => record.stat_month))].sort(), [chartRecords]);
  const cumulativeSeries = useMemo(() => Object.fromEntries(cities.map((city) => [city, getPeakDrawdownSeries(getCumulativeIndexSeries(chartRecords.filter((record) => record.city_id === city)))])) as Record<CityId, ReturnType<typeof getPeakDrawdownSeries>>, [chartRecords, cities]);
  const [accessibleMonth, setAccessibleMonth] = useState(months.at(-1) ?? "");

  useEffect(() => {
    setAccessibleMonth(months.at(-1) ?? "");
    setCumulativeReady(false);
    zoomWindowRef.current = { start: 0, end: 100 };
    setZoomWindow(zoomWindowRef.current);
  }, [months]);

  useEffect(() => {
    setHiddenCities((current) => current.filter((city) => cities.includes(city)));
  }, [cities]);

  useEffect(() => {
    if (!chartRef.current || !chartRecords.length) return;
    const chart = echarts.init(chartRef.current);
    chartInstance.current = chart;
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();
    const lineColors = [token("--color-series-1"), token("--color-series-2"), token("--color-series-3")];
    const targetTickCount = window.innerWidth <= 767 ? 4 : window.innerWidth <= 1023 ? 6 : 9;
    const recordMap = new Map(chartRecords.map((record) => [`${record.city_id}|${record.stat_month}`, record]));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const methodologyMarkers: Array<Record<string, unknown>> = [{ yAxis: 0, name: "0%基准线", label: { show: false } }];
    if (months.includes("2026-01")) methodologyMarkers.push({ xAxis: "2026-01", name: "2025年新基期", label: { show: true, formatter: "2025年新基期", color: token("--color-muted"), position: "insideEndTop" } });
    chart.setOption({
      animation: !reducedMotion,
      animationDuration: reducedMotion ? 0 : 180,
      aria: { enabled: true, description: `${cities.map((city) => CITY_NAMES[city]).join("、")}的${metric === "mom" ? "环比" : "同比"}住宅价格变动率趋势。` },
      grid: { left: 48, right: 22, top: 34, bottom: 72, containLabel: false },
      legend: { show: false, selected: Object.fromEntries(cities.map((city) => [CITY_NAMES[city], !hiddenCities.includes(city)])) },
      tooltip: {
        trigger: "axis",
        confine: true,
        formatter: (params: TooltipItem | TooltipItem[]) => {
          const items = Array.isArray(params) ? params : [params];
          if (items.length === 0) return "";
          return `<strong>${formatStatMonth(items[0].axisValue)}</strong><br/>${items.map((item) => `${item.marker}${item.seriesName}<br/>变动率 <strong>${formatChange(item.data.value)}</strong> · 原始指数 ${formatIndex(item.data.rawIndex)}<br/>发布于 ${formatReleaseDate(item.data.releaseDate)}`).join("<br/>")}`;
        },
      },
      xAxis: {
        type: "category",
        data: months,
        boundaryGap: false,
        axisLabel: { color: token("--color-muted"), interval: Math.max(0, Math.ceil(months.length / targetTickCount) - 1), formatter: (value: string) => formatCompactStatMonth(value), hideOverlap: true },
        axisLine: { lineStyle: { color: token("--color-divider") } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: token("--color-muted"), formatter: "{value}%" },
        splitLine: { lineStyle: { color: token("--color-grid") } },
      },
      dataZoom: [
        { type: "inside", filterMode: "none", start: zoomWindowRef.current.start, end: zoomWindowRef.current.end, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false, preventDefaultMouseMove: false },
        { type: "slider", start: zoomWindowRef.current.start, end: zoomWindowRef.current.end, height: 18, bottom: 10, borderColor: "transparent", backgroundColor: token("--color-page"), fillerColor: token("--color-accent-fill"), handleStyle: { color: token("--color-accent") } },
      ],
      series: cities.map((city, index) => ({
        name: CITY_NAMES[city],
        type: "line",
        smooth: 0.12,
        showSymbol: false,
        symbol: LINE_SYMBOLS[index],
        symbolSize: 7,
        connectNulls: false,
        data: months.map((month) => {
          const record = recordMap.get(`${city}|${month}`);
          return { value: record ? getChange(record, metric) : null, rawIndex: record ? rawIndex(record, metric) : null, releaseDate: record?.release_date ?? "—" } satisfies ChartPoint;
        }),
        lineStyle: { width: index === 2 ? 2.5 : 2, color: lineColors[index], type: LINE_TYPES[index] },
        itemStyle: { color: lineColors[index] },
        emphasis: { focus: "series" },
        markLine: index === 0 ? { silent: true, symbol: ["none", "none"], lineStyle: { color: token("--color-axis"), width: 1.4, type: "dashed" }, data: methodologyMarkers } : undefined,
      })),
      graphic: { type: "text", left: 48, top: 15, style: { text: "变动率 (%)", fill: token("--color-muted"), fontSize: 11 } },
    });
    const handleDataZoom = (...args: unknown[]) => {
      const event = (args[0] ?? {}) as { start?: number; end?: number; batch?: Array<{ start?: number; end?: number }> };
      const values = event.batch?.[0] ?? event;
      if (typeof values.start !== "number" || typeof values.end !== "number") return;
      const next = { start: values.start, end: values.end };
      zoomWindowRef.current = next;
      setZoomWindow(next);
    };
    chart.on("datazoom", handleDataZoom);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartRef.current);
    return () => {
      observer.disconnect();
      chart.off("datazoom", handleDataZoom);
      chartInstance.current = null;
      chart.dispose();
    };
  }, [chartRecords, cities, hiddenCities, metric, months]);

  useEffect(() => {
    if (!cumulativeChartRef.current || !chartRecords.length) return;
    const chart = echarts.init(cumulativeChartRef.current);
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();
    const lineColors = [token("--color-series-1"), token("--color-series-2"), token("--color-series-3")];
    const targetTickCount = window.innerWidth <= 767 ? 4 : window.innerWidth <= 1023 ? 6 : 9;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const methodologyMarkers: Array<Record<string, unknown>> = [{ yAxis: 100, name: "起点100", label: { show: false } }];
    if (months.includes("2026-01")) methodologyMarkers.push({ xAxis: "2026-01", name: "2025年新基期", label: { show: false } });
    chart.setOption({
      animation: !reducedMotion,
      animationDuration: reducedMotion ? 0 : 180,
      aria: { enabled: true, description: `${cities.map((city) => CITY_NAMES[city]).join("、")}从${formatStatMonth(months[0])}的100点起算，按月度环比指数复合计算的累计变化。` },
      grid: { left: 48, right: 22, top: 36, bottom: 36, containLabel: false },
      legend: { show: false, selected: Object.fromEntries(cities.map((city) => [CITY_NAMES[city], !hiddenCities.includes(city)])) },
      tooltip: {
        trigger: "axis",
        confine: true,
        formatter: (params: CumulativeTooltipItem | CumulativeTooltipItem[]) => {
          const items = (Array.isArray(params) ? params : [params]).filter((item) => item.data.value !== null);
          if (items.length === 0) return "";
          return `<strong>${formatStatMonth(items[0].axisValue)}</strong><br/>${items.map((item) => `${item.marker}${item.seriesName} <strong>${formatIndex(item.data.value)}</strong> · 较起点 ${formatChange(item.data.value === null ? null : item.data.value - 100)} · 较高点 ${formatChange(item.data.drawdown)}`).join("<br/>")}`;
        },
      },
      xAxis: {
        type: "category",
        data: months,
        boundaryGap: false,
        axisLabel: { color: token("--color-muted"), interval: Math.max(0, Math.ceil(months.length / targetTickCount) - 1), formatter: (value: string) => formatCompactStatMonth(value), hideOverlap: true },
        axisLine: { lineStyle: { color: token("--color-divider") } },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: token("--color-muted"), formatter: (value: number) => formatIndex(value) },
        splitLine: { lineStyle: { color: token("--color-grid") } },
      },
      series: cities.map((city, index) => ({
        name: CITY_NAMES[city],
        type: "line",
        smooth: 0.12,
        showSymbol: false,
        symbol: LINE_SYMBOLS[index],
        symbolSize: 7,
        connectNulls: false,
        data: months.map((month) => {
          const point = cumulativeSeries[city].find((item) => item.stat_month === month);
          return { value: point?.value ?? null, drawdown: point?.drawdown ?? null };
        }),
        lineStyle: { width: index === 2 ? 2.5 : 2, color: lineColors[index], type: LINE_TYPES[index] },
        itemStyle: { color: lineColors[index] },
        emphasis: { focus: "series" },
        markLine: index === 0 ? { silent: true, symbol: ["none", "none"], lineStyle: { color: token("--color-axis"), width: 1.2, type: "dashed" }, data: methodologyMarkers } : undefined,
      })),
      graphic: { type: "text", left: 48, top: 15, style: { text: "累计值（起点=100）", fill: token("--color-muted"), fontSize: 11 } },
    });
    setCumulativeReady(true);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(cumulativeChartRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [chartRecords, cities, cumulativeSeries, hiddenCities, months]);

  const changeZoom = (direction: "in" | "out") => {
    const current = zoomWindowRef.current;
    const next = direction === "in"
      ? { start: Math.min(current.end - 20, current.start + 5), end: Math.max(current.start + 20, current.end - 5) }
      : { start: Math.max(0, current.start - 5), end: Math.min(100, current.end + 5) };
    zoomWindowRef.current = next;
    setZoomWindow(next);
    chartInstance.current?.dispatchAction({ type: "dataZoom", start: next.start, end: next.end });
  };

  const toggleSeries = (city: CityId) => {
    setHiddenCities((current) => {
      if (current.includes(city)) {
        setLegendNotice("");
        return current.filter((item) => item !== city);
      }
      if (current.length >= cities.length - 1) {
        setLegendNotice("至少保留一条趋势线");
        return current;
      }
      setLegendNotice("");
      return [...current, city];
    });
  };

  if (loading) return <div className="chart-loading" role="status" aria-live="polite" aria-label="趋势数据加载中" aria-busy="true"><div className="skeleton skeleton-chart" /></div>;
  if (loadError) return <div className="chart-empty" role="status"><div className="empty-chart-icon"><BarChart3 size={26} aria-hidden="true" /></div><strong>趋势数据暂时不可用</strong><span>{loadError}。城市概览和市场位置仍可查看，可在提示条中重试趋势。</span></div>;
  if (!hasData || !chartRecords.length) return <div className="chart-empty" role="region" aria-label="趋势图空状态"><div className="empty-chart-icon"><BarChart3 size={26} aria-hidden="true" /></div><strong>当前筛选没有可用记录</strong><span aria-live="polite">可恢复默认视图，或查看国家统计局原始发布。</span><div className="empty-actions"><button type="button" className="outline-button" onClick={onReset}><RotateCcw size={15} aria-hidden="true" />恢复默认视图</button><a href="https://www.stats.gov.cn/sj/zxfb/index.html" target="_blank" rel="noreferrer">查看官方来源 <ExternalLink size={14} aria-hidden="true" /></a></div></div>;

  const selectedRecords = cities.map((city) => chartRecords.find((record) => record.city_id === city && record.stat_month === accessibleMonth)).filter((record): record is PriceRecord => Boolean(record));
  const cumulativeValue = (city: CityId, month: string) => cumulativeSeries[city].find((point) => point.stat_month === month)?.value ?? null;
  const startMonth = months[0] ?? "";
  const latestCumulativeValues = cities.map((city) => ({ city, value: cumulativeSeries[city].at(-1)?.value ?? null }));
  const visibleStartIndex = Math.max(0, Math.min(months.length - 1, Math.floor((months.length - 1) * zoomWindow.start / 100)));
  const visibleEndIndex = Math.max(0, Math.min(months.length - 1, Math.ceil((months.length - 1) * zoomWindow.end / 100)));
  const visibleRange = months.length > 0 ? `${formatStatMonth(months[visibleStartIndex])}—${formatStatMonth(months[visibleEndIndex])}` : "暂无月份";
  return <div className="chart-wrap">
    <div className="chart-toolbar" role="group" aria-label="趋势图缩放控件">
      <span>当前：{visibleRange}</span>
      <div>
        <button type="button" className="icon-button compact-icon-button" aria-label="放大趋势图" title="放大趋势图" disabled={zoomWindow.end - zoomWindow.start <= 20} onClick={() => changeZoom("in")}><ZoomIn size={16} aria-hidden="true" /></button>
        <button type="button" className="icon-button compact-icon-button" aria-label="缩小趋势图" title="缩小趋势图" disabled={zoomWindow.start <= 0 && zoomWindow.end >= 100} onClick={() => changeZoom("out")}><ZoomOut size={16} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="series-legend" role="group" aria-label="显示或隐藏趋势线">{cities.map((city, index) => {
      const visible = !hiddenCities.includes(city);
      return <button key={city} type="button" aria-pressed={visible} onClick={() => toggleSeries(city)}><span className={`legend-line legend-line-${index}`} aria-hidden="true" />{CITY_NAMES[city]}</button>;
    })}</div>
    <p className="series-color-note">线条颜色和线型用于区分城市，不表示涨跌方向。</p>
    {legendNotice && <p className="legend-notice" role="status" aria-live="polite">{legendNotice}</p>}
    <div ref={chartRef} className="trend-chart" role="img" aria-label={`${cities.map((city) => CITY_NAMES[city]).join("、")}的${metric === "mom" ? "环比" : "同比"}住宅价格变动率趋势`} />
    <p className="chart-note"><Info size={14} aria-hidden="true" />缺失月份会断线，不按0计算；竖线标记统计基期变化。</p>
    <section className="cumulative-section" aria-labelledby="cumulative-title">
      <div className="cumulative-heading">
        <div><h3 id="cumulative-title">累计变化</h3><p>{formatStatMonth(startMonth)}设为100，按月度环比指数逐月复合；这是比较基准，不是实际元/㎡房价。</p></div>
        <span className="baseline-label">起点 100</span>
      </div>
      <div className="cumulative-latest" aria-label="最新累计变化">{latestCumulativeValues.map(({ city, value }, index) => <span key={city}><i className={`legend-line legend-line-${index}`} aria-hidden="true" />{CITY_NAMES[city]} <strong>{formatIndex(value)}</strong> <small>{value === null ? "无法计算" : formatChange(value - 100)}</small></span>)}</div>
      <div className={`cumulative-chart-shell ${cumulativeReady ? "is-ready" : ""}`}>
        {!cumulativeReady && <div className="cumulative-chart-skeleton skeleton" role="status" aria-label="累计变化图加载中" />}
        <div ref={cumulativeChartRef} className="cumulative-chart" role="img" aria-label="以100为起点的住宅价格指数累计变化图" aria-busy={!cumulativeReady || undefined} />
      </div>
      <p className="chart-note"><Info size={14} aria-hidden="true" />累计图固定使用环比；中途缺少环比数据时停止后续计算，不跨越缺口拼接。</p>
    </section>
    <details className="accessible-data">
      <summary>查看精确数据</summary>
      <div className="accessible-data-controls">
        <label htmlFor="accessible-month">统计月份</label>
        <select id="accessible-month" name="accessible-month" value={accessibleMonth} onChange={(event) => setAccessibleMonth(event.target.value)}>{months.map((month) => <option key={month} value={month}>{formatStatMonth(month)}</option>)}</select>
      </div>
      <div className="table-scroll" tabIndex={0} aria-label="所选月份数据表，可横向滚动">
        <table>
          <caption>{formatStatMonth(accessibleMonth)} · {metric === "mom" ? "环比" : "同比"}与累计变化数据</caption>
          <thead><tr><th scope="col">城市</th><th scope="col">原始指数</th><th scope="col">变动率</th><th scope="col">累计值<br /><small>{formatStatMonth(startMonth)}=100</small></th><th scope="col">发布日期</th></tr></thead>
          <tbody>{selectedRecords.map((record) => <tr key={record.city_id}><th scope="row">{record.city_name}</th><td>{formatIndex(rawIndex(record, metric))}</td><td>{formatChange(getChange(record, metric))}</td><td>{formatIndex(cumulativeValue(record.city_id, accessibleMonth))}</td><td>{formatReleaseDate(record.release_date)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="mobile-data-list" aria-label={`${formatStatMonth(accessibleMonth)}精确数据`}>
        {selectedRecords.map((record) => <section className="mobile-data-city" key={record.city_id} aria-labelledby={`mobile-data-${record.city_id}`}>
          <h4 id={`mobile-data-${record.city_id}`}>{record.city_name}</h4>
          <dl>
            <div><dt>原始指数</dt><dd>{formatIndex(rawIndex(record, metric))}</dd></div>
            <div><dt>{metric === "mom" ? "环比" : "同比"}变动率</dt><dd>{formatChange(getChange(record, metric))}</dd></div>
            <div><dt>累计值</dt><dd>{formatIndex(cumulativeValue(record.city_id, accessibleMonth))}</dd></div>
            <div><dt>发布日期</dt><dd>{formatReleaseDate(record.release_date)}</dd></div>
          </dl>
        </section>)}
      </div>
    </details>
  </div>;
}
