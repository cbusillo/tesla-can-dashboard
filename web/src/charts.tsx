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
import { summarizeCells } from "./cell-summary";
import {
  convert,
  display,
  displayUnit,
  decimalPlaces,
  readingStatus,
  usableReading,
  type DialRange,
  type Reading,
} from "./types";
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
  unit: fallbackUnit,
  range,
  units,
  dark,
  label,
}: {
  reading: Reading | undefined;
  unit: string;
  range: DialRange;
  units: string;
  dark: boolean;
  label: string;
}) {
  const usable = usableReading(reading);
  const unit = reading?.unit ?? fallbackUnit;
  const value = usable ? convert(reading.value, unit, units) : null,
    minimum = convert(range.minimum, unit, units),
    maximum = convert(range.maximum, unit, units);
  const primary =
    reading?.quality === "fresh"
      ? color("chart-primary")
      : color("chart-muted");
  const option: Option = {
    series: [
      {
        type: "gauge",
        min: minimum,
        max: maximum,
        startAngle: 210,
        endAngle: -30,
        radius: "95%",
        center: ["50%", "58%"],
        splitNumber: 4,
        axisLine: {
          lineStyle: { width: 4, color: [[1, color("chart-track")]] },
        },
        progress: {
          show: minimum >= 0,
          width: 4,
          itemStyle: {
            color: primary,
            opacity: usable && reading?.quality === "fresh" ? 1 : 0,
          },
        },
        pointer: {
          show: usable && reading?.quality === "fresh",
          length: "12%",
          width: 3,
          icon: "rect",
          offsetCenter: [0, "-86%"],
          itemStyle: { color: color("chart-text") },
        },
        axisTick: {
          show: true,
          splitNumber: 1,
          length: 3,
          lineStyle: { color: color("chart-muted"), width: 1 },
        },
        splitLine: {
          length: 7,
          lineStyle: { color: color("chart-muted"), width: 1 },
        },
        axisLabel: {
          distance: -18,
          color: color("chart-muted"),
          fontSize: 12,
          formatter: (v) =>
            Math.abs(v - minimum) < 0.00001 ||
            Math.abs(v - maximum) < 0.00001 ||
            Math.abs(v) < 0.00001
              ? Number(v.toFixed(1)).toString()
              : "",
        },
        anchor: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: false,
          offsetCenter: [0, "-2%"],
          fontSize: 54,
          fontWeight: 400,
          color: color(
            reading?.quality === "fresh" ? "chart-text" : "chart-muted",
          ),
          fontFamily: getComputedStyle(document.documentElement).fontFamily,
          formatter: () =>
            value === null ? "—" : value.toFixed(decimalPlaces(unit, units)),
        },
        data: [
          {
            value:
              value === null
                ? minimum
                : Math.max(minimum, Math.min(maximum, value)),
          },
        ],
      },
    ],
  };
  return (
    <div data-theme={dark ? "night" : "day"}>
      <Chart
        option={option}
        height={210}
        label={`${label}: ${display(reading, units)}${readingStatus(reading) ? ", " + readingStatus(reading) : ""}`}
      />
      <div class="dial-unit">
        {displayUnit(unit, units)}
        {value !== null && (value < minimum || value > maximum)
          ? " · outside dial range"
          : ""}
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
  height = 160,
  samplesOnly = false,
  choices,
  range,
}: {
  reading: Reading | undefined;
  units: string;
  dark: boolean;
  label: string;
  staleAfter?: number;
  height?: number;
  samplesOnly?: boolean;
  choices?: Record<string, string> | null;
  range?: DialRange;
}) {
  const points = (reading?.history || []).filter(
    (point) =>
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]),
  );
  const history: (number | null)[][] = [];
  for (let index = 0; index < points.length; index++) {
    const previous = points[index - 1],
      point = points[index];
    if (!samplesOnly && previous && point[0] - previous[0] > staleAfter)
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
  const categories = choices ? Object.keys(choices).map(Number) : [];
  const padding = Math.max(
    (highest - lowest) * 0.1,
    Math.abs(highest) * 0.01,
    reading?.unit === "kW"
      ? 5
      : reading?.unit === "A"
        ? 1
        : reading?.unit === "°C"
          ? 1
          : 0.1,
  );
  const option: Option = {
    grid: { left: 48, right: 16, top: 12, bottom: 28 },
    tooltip: {
      trigger: "axis",
      renderMode: "richText",
      confine: true,
      valueFormatter: (v) =>
        typeof v === "number"
          ? choices
            ? (choices[String(v)] ?? "—")
            : v.toFixed(2)
          : "—",
    },
    xAxis: {
      type: "time",
      min: points.length
        ? points[0][0] * 1000 - (points.length === 1 ? 60000 : 0)
        : undefined,
      max: points.length ? points[points.length - 1][0] * 1000 : undefined,
      splitNumber: 3,
      axisLabel: { color: color("chart-muted"), fontSize: 12 },
      axisLine: { lineStyle: { color: color("chart-track") } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      splitNumber: 2,
      min: range
        ? convert(range.minimum, reading?.unit || "", units)
        : categories.length
          ? Math.min(...categories)
          : lowest - padding,
      max: range
        ? convert(range.maximum, reading?.unit || "", units)
        : categories.length
          ? Math.max(...categories)
          : highest + padding,
      interval: categories.length ? 1 : undefined,
      axisLabel: {
        color: color("chart-muted"),
        fontSize: 12,
        formatter: (v: number) =>
          choices
            ? (choices[String(v)] ?? "")
            : Number(v.toFixed(2)).toString(),
      },
      splitLine: { lineStyle: { color: color("chart-track") } },
    },
    series: [
      {
        type: "line",
        step: choices ? "end" : undefined,
        showSymbol: samplesOnly || points.length < 2,
        symbolSize: 4,
        connectNulls: false,
        lineStyle: {
          width: samplesOnly ? 0 : 2,
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
      {points.length ? (
        <Chart
          option={option}
          height={height}
          label={
            label + (samplesOnly ? " recorded observations" : " recent history")
          }
        />
      ) : (
        <div class="history-empty" style={{ height }}>
          No history available
        </div>
      )}
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
  const { fresh, average } = summarizeCells(cells);
  const deviations = cells.map((cell) =>
    cell.quality === "fresh" &&
    cell.value !== null &&
    Number.isFinite(cell.value) &&
    average !== null
      ? (cell.value - average) * 1000
      : null,
  );
  const extent = Math.max(
    5,
    ...deviations.map((value) =>
      value === null ? 0 : Math.ceil(Math.abs(value) / 5) * 5,
    ),
  );
  const option: Option = {
    grid: { left: 45, right: 12, top: 14, bottom: 32 },
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      confine: true,
      valueFormatter: (v) =>
        typeof v === "number"
          ? (v > 0 ? "+" : "") + v.toFixed(1) + " mV"
          : "Unavailable",
    },
    xAxis: {
      type: "category",
      data: cells.map((c) => String(c.index)),
      axisLabel: {
        color: color("chart-muted"),
        fontSize: 12,
        interval: (index: number) =>
          index === 0 ||
          index === cells.length - 1 ||
          (index + 1) % Math.max(1, Math.round(cells.length / 8)) === 0,
      },
      axisLine: { lineStyle: { color: color("chart-track") } },
    },
    yAxis: {
      type: "value",
      min: -extent,
      max: extent,
      splitNumber: 2,
      axisLabel: {
        color: color("chart-muted"),
        fontSize: 12,
        formatter: (v) => (v > 0 ? "+" : "") + Number(v.toFixed(1)).toString(),
      },
      splitLine: { lineStyle: { color: color("chart-track") } },
    },
    series: [
      {
        type: "bar",
        barMinHeight: 1,
        barCategoryGap: "15%",
        data: cells.map((c, index) => ({
          value: deviations[index],
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
      {fresh.length ? (
        <Chart
          option={option}
          height={190}
          label="Cell group voltage differences from the average, in millivolts"
          onPointClick={(index) => {
            if (cells[index]) onSelect(cells[index].index);
          }}
        />
      ) : (
        <div class="history-empty" style={{ height: 190 }}>
          No current cell readings
        </div>
      )}
    </div>
  );
}
