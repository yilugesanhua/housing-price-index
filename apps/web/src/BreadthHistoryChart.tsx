import { useEffect, useRef, useState } from "react";
import { BarChart } from "echarts/charts";
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { MarketBreadthPoint } from "@housing/core";

echarts.use([BarChart, AriaComponent, GridComponent, TooltipComponent, CanvasRenderer]);

interface TooltipItem {
  axisValue: string;
  marker: string;
  seriesName: string;
  value: number;
}

export function BreadthHistoryChart({ records }: { records: MarketBreadthPoint[] }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const firstMonth = records[0]?.stat_month ?? "";
  const lastMonth = records.at(-1)?.stat_month ?? "";
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, records.length - 1));

  useEffect(() => {
    setSelectedIndex(Math.max(0, records.length - 1));
  }, [records]);

  useEffect(() => {
    if (!chartRef.current || records.length === 0) return;
    const chart = echarts.init(chartRef.current);
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targetTicks = window.innerWidth <= 767 ? 4 : 8;
    chart.setOption({
      animation: !reducedMotion,
      animationDuration: reducedMotion ? 0 : 180,
      aria: { enabled: true, description: `${firstMonth}至${lastMonth}的70城有效数据中上涨、持平和下跌城市数量走势。` },
      grid: { left: 38, right: 8, top: 12, bottom: 30 },
      tooltip: {
        trigger: "axis",
        confine: true,
        axisPointer: { type: "shadow" },
        formatter: (params: TooltipItem | TooltipItem[]) => {
          const items = Array.isArray(params) ? params : [params];
          if (!items.length) return "";
          return `<strong>${items[0].axisValue}</strong><br/>${items.map((item) => `${item.marker}${item.seriesName} <strong>${item.value}城</strong>`).join("<br/>")}`;
        },
      },
      xAxis: {
        type: "category",
        data: records.map((record) => record.stat_month),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: token("--color-divider") } },
        axisLabel: { color: token("--color-muted"), interval: Math.max(0, Math.ceil(records.length / targetTicks) - 1), formatter: (value: string) => value.slice(2) },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 70,
        interval: 20,
        axisLabel: { color: token("--color-muted"), fontSize: 10 },
        splitLine: { lineStyle: { color: token("--color-grid") } },
      },
      series: [
        { name: "上涨", type: "bar", stack: "cities", barMaxWidth: 12, itemStyle: { color: token("--color-up") }, data: records.map((record, index) => ({ value: record.up, itemStyle: { opacity: index === selectedIndex ? 1 : 0.72 } })) },
        { name: "持平", type: "bar", stack: "cities", barMaxWidth: 12, itemStyle: { color: token("--color-axis") }, data: records.map((record, index) => ({ value: record.flat, itemStyle: { opacity: index === selectedIndex ? 1 : 0.72 } })) },
        { name: "下跌", type: "bar", stack: "cities", barMaxWidth: 12, itemStyle: { color: token("--color-down") }, data: records.map((record, index) => ({ value: record.down, itemStyle: { opacity: index === selectedIndex ? 1 : 0.72 } })) },
      ],
    });
    const handleClick = (params: { dataIndex?: number }) => { if (typeof params.dataIndex === "number") setSelectedIndex(params.dataIndex); };
    chart.on("click", handleClick);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartRef.current);
    return () => { observer.disconnect(); chart.off("click", handleClick); chart.dispose(); };
  }, [firstMonth, lastMonth, records, selectedIndex]);

  const selected = records[selectedIndex] ?? records.at(-1);
  return <div className="breadth-history" aria-labelledby="breadth-history-title">
    <div className="breadth-history-heading"><div><h3 id="breadth-history-title">70城温度走势</h3><p>按月统计上涨、持平和下跌城市数量</p></div><span>有效城市数 / 70</span></div>
    <div ref={chartRef} className="breadth-history-chart" role="img" aria-label={`${firstMonth}至${lastMonth}的70城温度历史堆叠图`} />
    {selected && <div className="breadth-history-detail"><div><span>查看月份</span><strong>{selected.stat_month}</strong></div><div><span className="detail-up">上涨</span><strong>{selected.up}城</strong></div><div><span className="detail-flat">持平</span><strong>{selected.flat}城</strong></div><div><span className="detail-down">下跌</span><strong>{selected.down}城</strong></div></div>}
    <label className="breadth-history-slider"><span>拖动查看月份</span><input type="range" min="0" max={Math.max(0, records.length - 1)} value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))} aria-label="选择温度月份" /></label>
    <p className="breadth-history-note">温度图中红色表示上涨、绿色表示下跌，灰色表示持平；缺失数据不计入统计。</p>
    {selected && <p className="sr-only">{selected.stat_month}：有效数据中上涨{selected.up}城，持平{selected.flat}城，下跌{selected.down}城。</p>}
  </div>;
}
