import { useEffect, useRef } from "preact/hooks";
import * as echarts from "echarts/core";
import {
  GaugeChart,
  LineChart,
  BarChart,
  type GaugeSeriesOption,
  type LineSeriesOption,
  type BarSeriesOption,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  type GridComponentOption,
  type TooltipComponentOption,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { convert, displayUnit, type DialRange, type Reading } from "./types";
echarts.use([
  GaugeChart,
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  SVGRenderer,
]);
type Option = echarts.ComposeOption<
  | GaugeSeriesOption
  | LineSeriesOption
  | BarSeriesOption
  | GridComponentOption
  | TooltipComponentOption
>;
function color(id: string) {
  const element = document.getElementById(id);
  return element
    ? getComputedStyle(element).color
    : getComputedStyle(document.documentElement).color;
}
export function Chart({
  option,
  height = 180,
  label,
  onPointClick,
}: {
  option: Option;
  height?: number;
  label: string;
  onPointClick?: (index: number) => void;
}) {
  const node = useRef<HTMLDivElement>(null),
    chart = useRef<echarts.ECharts | null>(null),
    latest = useRef(option),
    click = useRef(onPointClick);
  latest.current = option;
  click.current = onPointClick;
  useEffect(() => {
    if (!node.current) return;
    const resize = () => {
      if (!node.current || node.current.clientWidth === 0) return;
      if (!chart.current) {
        const instance = echarts.init(node.current, undefined, {
          renderer: "svg",
        });
        chart.current = instance;
        instance.on("click", (event: { dataIndex?: number }) => {
          if (typeof event.dataIndex === "number")
            click.current?.(event.dataIndex);
        });
        instance.setOption(
          { ...latest.current, animation: false },
          { notMerge: true },
        );
      } else chart.current.resize();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node.current);
    resize();
    return () => {
      observer.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(
      { ...option, animation: false },
      { notMerge: true, lazyUpdate: true },
    );
  }, [option]);
  return (
    <div
      class="data-chart"
      style={{ height }}
      ref={node}
      role="img"
      aria-label={label}
    />
  );
}
export function Dial({
  reading,
  range,
  units,
  dark,
  label,
}: {
  reading: Reading;
  range: DialRange;
  units: string;
  dark: boolean;
  label: string;
}) {
  const value = convert(reading.value!, reading.unit, units),
    minimum = convert(range.minimum, reading.unit, units),
    maximum = convert(range.maximum, reading.unit, units);
  const primary =
    reading.quality === "fresh" ? color("chart-primary") : color("chart-muted");
  const option: Option = {
    series: [
      {
        type: "gauge",
        min: minimum,
        max: maximum,
        startAngle: 210,
        endAngle: -30,
        radius: "85%",
        center: ["50%", "48%"],
        splitNumber: 4,
        axisLine: {
          lineStyle: { width: 5, color: [[1, color("chart-track")]] },
        },
        progress: {
          show: reading.quality === "fresh",
          width: 5,
          itemStyle: { color: primary },
        },
        pointer: {
          show: reading.quality === "fresh",
          length: "55%",
          width: 3,
          itemStyle: { color: primary },
        },
        axisTick: { show: false },
        splitLine: {
          length: 7,
          lineStyle: { color: color("chart-muted"), width: 1 },
        },
        axisLabel: {
          distance: 12,
          color: color("chart-muted"),
          fontSize: 10,
          formatter: (v) => Number(v.toFixed(1)).toString(),
        },
        anchor: { show: true, size: 7, itemStyle: { color: primary } },
        title: { show: false },
        detail: {
          valueAnimation: false,
          offsetCenter: [0, "62%"],
          fontSize: 25,
          color: color("chart-text"),
          fontFamily: getComputedStyle(document.documentElement).fontFamily,
          formatter: () => value.toFixed(reading.unit === "V" ? 2 : 1),
        },
        data: [{ value: Math.max(minimum, Math.min(maximum, value)) }],
      },
    ],
  };
  return (
    <div data-theme={dark ? "night" : "day"}>
      <Chart option={option} height={200} label={label + " dial"} />
      <div class="dial-unit">
        {displayUnit(reading.unit, units)}
        {value < minimum || value > maximum ? " · outside dial range" : ""}
      </div>
    </div>
  );
}
export function History({
  reading,
  units,
  dark,
  label,
  staleAfter = 3,
}: {
  reading: Reading | undefined;
  units: string;
  dark: boolean;
  label: string;
  staleAfter?: number;
}) {
  const points = reading?.history || [];
  const history: (number | null)[][] = [];
  for (let index = 0; index < points.length; index++) {
    const previous = points[index - 1],
      point = points[index];
    if (previous && point[0] - previous[0] > staleAfter)
      history.push([(previous[0] + staleAfter) * 1000, null]);
    history.push([
      point[0] * 1000,
      convert(point[1], reading?.unit || "", units),
    ]);
  }
  const values = history
    .map((point) => point[1])
    .filter((value): value is number => value !== null);
  const lowest = values.length ? Math.min(...values) : 0;
  const highest = values.length ? Math.max(...values) : 1;
  const padding = Math.max(
    (highest - lowest) * 0.1,
    Math.abs(highest) * 0.001,
    0.01,
  );
  const option: Option = {
    grid: { left: 48, right: 16, top: 12, bottom: 28 },
    tooltip: {
      trigger: "axis",
      renderMode: "richText",
      confine: true,
      valueFormatter: (v) => (typeof v === "number" ? v.toFixed(2) : String(v)),
    },
    xAxis: {
      type: "time",
      axisLabel: { color: color("chart-muted"), fontSize: 10 },
      axisLine: { lineStyle: { color: color("chart-track") } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      min: lowest - padding,
      max: highest + padding,
      axisLabel: { color: color("chart-muted"), fontSize: 10 },
      splitLine: { lineStyle: { color: color("chart-track") } },
    },
    series: [
      {
        type: "line",
        showSymbol: points.length < 2,
        symbolSize: 4,
        connectNulls: false,
        lineStyle: {
          width: 2,
          type: reading?.quality === "fresh" ? "solid" : "dashed",
          color: color(
            reading?.quality === "fresh" ? "chart-primary" : "chart-muted",
          ),
        },
        itemStyle: { color: color("chart-primary") },
        data: history,
      },
    ],
  };
  return (
    <div data-theme={dark ? "night" : "day"}>
      <Chart option={option} height={160} label={label + " recent history"} />
    </div>
  );
}
export function CellChart({
  cells,
  selected,
  onSelect,
  dark,
}: {
  cells: (Reading & { index: number })[];
  selected: number | null;
  onSelect: (index: number) => void;
  dark: boolean;
}) {
  const fresh = cells.filter((c) => c.quality === "fresh" && c.value !== null),
    min = fresh.length ? Math.min(...fresh.map((c) => c.value!)) : 0,
    max = fresh.length ? Math.max(...fresh.map((c) => c.value!)) : 0;
  const option: Option = {
    grid: { left: 55, right: 12, top: 10, bottom: 30 },
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      confine: true,
      valueFormatter: (v) =>
        typeof v === "number" ? v.toFixed(4) + " V" : "Unavailable",
    },
    xAxis: {
      type: "category",
      data: cells.map((c) => String(c.index)),
      axisLabel: { color: color("chart-muted"), fontSize: 10 },
      axisLine: { lineStyle: { color: color("chart-track") } },
    },
    yAxis: {
      type: "value",
      min: Math.floor((min - 0.001) * 1000) / 1000,
      max: Math.ceil((max + 0.001) * 1000) / 1000,
      axisLabel: {
        color: color("chart-muted"),
        fontSize: 10,
        formatter: (v) => v.toFixed(3),
      },
      splitLine: { lineStyle: { color: color("chart-track") } },
    },
    series: [
      {
        type: "bar",
        barCategoryGap: "15%",
        data: cells.map((c) => ({
          value: c.quality === "fresh" ? c.value : null,
          itemStyle: {
            color: color(
              c.index === selected ? "chart-accent" : "chart-primary",
            ),
          },
        })),
      },
    ],
  };
  return (
    <div class="cell-chart-wrap" data-theme={dark ? "night" : "day"}>
      <Chart
        option={option}
        height={185}
        label="Cell group voltages by group number"
        onPointClick={(index) => {
          if (cells[index]) onSelect(cells[index].index);
        }}
      />
    </div>
  );
}
