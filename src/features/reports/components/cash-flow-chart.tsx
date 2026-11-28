"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import styles from "./cash-flow-chart.module.css";
import { groupByCategory, type CategoryGroup } from "@/features/reports/category-groups";
import type { useChartDetails } from "@/features/reports/use-chart-details";
import { categoryBarColor, themedColor } from "@/features/categorization/category-colors";
import { describeMonth, monthRangeLabel } from "@/lib/date-format";
import { money } from "@/lib/money";
import { describeCategoryGroups } from "@/features/reports/components/category-rows";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { currentMonth, trendLength, trendMonths } from "@/lib/period";
import { chartMonthCount, minimumChartMonths, skeletonMonthBreakpoints } from "@/features/reports/chart-months";
import { useMonthTransactionsHref, usePeriod } from "@/client/use-app-url";
import type { Area, AreaResult, PendingArea } from "@/components/ui/use-area-result";
import type { CashFlow } from "@/features/reports/types";
import type { EarlierMonths } from "@/features/reports/use-earlier-months";
import { barSpan, cashFlowScale, scaleOffset, type CashFlowScale } from "@/features/reports/cash-flow-scale";
import { edgeNet, hasCashFlowToDraw, formatSavingsRate, isNegativeRate, netFlow, trendCashFlow, type CashFlowSelection } from "@/features/reports/cash-flow-selection";
import { useLocale } from "@/client/locale-provider";
import { useTranslations } from "next-intl";
import { cssPercent } from "@/lib/percent";

type Props = {
  cashFlow: Area<CashFlow>;
  selection: CashFlowSelection | null;
  targetProps: ReturnType<typeof useChartDetails>["targetProps"];
  detailsId: string;
  /** Called when the selected month is no longer among the loaded months, so the panel does not describe a missing month. */
  onSelectionHidden: () => void;
  /** Months before the trend the chart scrolls to; without it the chart scrolls through the trend alone. */
  earlier?: EarlierMonths;
};

type Flow = "income" | "expenses";

type ChartMonth = {
  month: string;
  label: string;
  title: string;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number | null;
  incomeGroups: CategoryGroup[];
  expenseGroups: CategoryGroup[];
};

export function CashFlowChart({
  cashFlow,
  selection,
  targetProps,
  detailsId,
  onSelectionHidden,
  earlier
}: Props) {
  const locale = useLocale();
  const period = usePeriod();
  const plotRef = useRef<HTMLDivElement>(null);
  const plot = usePlotColumns(plotRef);
  // Whole months scrolled out of view to the right; the chart opens at the trend's latest month.
  const [hiddenAfter, setHiddenAfter] = useState(0);
  // The trend's months follow from the selected period, so the heading and month labels are known before the figures.
  const trend = cashFlow.status === "pending" ? trendMonths(period, currentMonth()) : cashFlow.data.trend.map(item => Temporal.PlainYearMonth.from(item.month));
  // While earlier months load, placeholder columns in view describe nothing yet; the heading and rate keep the oldest loaded view.
  const visibleEnd = Math.max(Math.min(plot.count, trend.length), trend.length - hiddenAfter);
  const visibleStart = Math.max(0, visibleEnd - plot.count);
  const months = trend.slice(visibleStart, visibleEnd);
  const rangeMask = cashFlow.status === "pending" ? "" : valueMask(cashFlow.status);
  const rateMask = cashFlow.status === "pending" ? ui["skeleton"] : rangeMask;
  // The rate covers exactly the months the chart shows.
  const visibleRate = cashFlow.status === "pending" ? null : trendCashFlow(cashFlow.data.trend.slice(visibleStart, visibleEnd)).savingsRate;

  return (
    <section className={clsx(ui["panel"], styles["chart-panel"])}>
      <ChartHeading
        range={monthRangeLabel(months, locale)}
        rangeMask={rangeMask}
        rate={visibleRate}
        rateMask={rateMask}
      />
      <div className={styles["plot"]} ref={plotRef}>
        {cashFlow.status === "pending" ? <ChartSkeleton area={cashFlow} columns={trend.map(month => skeletonColumn(month, locale))} /> : (
          <ChartPlot
            cashFlow={cashFlow}
            selection={selection}
            targetProps={targetProps}
            detailsId={detailsId}
            onSelectionHidden={onSelectionHidden}
            earlier={earlier}
            columns={plot}
            onScrolled={setHiddenAfter}
          />
        )}
      </div>
    </section>
  );
}

/** The panel's title with the shown range, and the legend with the savings rate of the shown columns. */
export function ChartHeading({
  range,
  rangeMask,
  rate,
  rateMask,
  netDetail
}: {
  range: string;
  rangeMask: string;
  rate: number | null;
  rateMask: string;
  /** A figure beside the net entry, such as the shown columns' average net. */
  netDetail?: ReactNode;
}) {
  const t = useTranslations("reports.chart");
  const locale = useLocale();

  return (
    <>
      <div className={clsx(ui["card-heading"], styles["heading"])}>
        <div className={styles["title"]}>
          <h2>{t("title")}</h2>
          <span className={clsx(ui["subtle"], rangeMask)}>{range}</span>
        </div>
      </div>
      <div className={styles["chart-legend"]}>
        <span>
          <i className={clsx(styles["legend-dot"], styles["income-dot"])} />
          {t("income")}
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], styles["expense-dot"])} />
          {t("expenses")}
        </span>
        <span>
          <i className={styles["legend-area"]} />
          {t("net")}
          {netDetail}
        </span>
        <span className={styles["savings-rate"]}>
          {t("savingsRate")} <strong className={clsx(isNegativeRate(rate, locale) && styles["negative"], rateMask)}>{formatSavingsRate(rate, locale)}</strong>
        </span>
      </div>
    </>
  );
}

/** How many month columns the plot shows at once and how wide each is, measured before paint so a resize never shows a squeezed chart. */
export type PlotColumns = {
  count: number;
  width: number;
};

export function usePlotColumns(plotRef: RefObject<HTMLDivElement | null>) {
  const [columns, setColumns] = useState<PlotColumns>({
    count: minimumChartMonths,
    width: 0
  });

  useLayoutEffect(() => {
    const plot = plotRef.current;

    if (!plot) {
      return;
    }

    const measure = () => {
      const count = chartMonthCount(plot.clientWidth);

      setColumns({
        count,
        width: plot.clientWidth / count
      });
    };
    const observer = new ResizeObserver(measure);

    measure();
    observer.observe(plot);

    return () => observer.disconnect();
  }, [plotRef]);

  return columns;
}

/** The month column a key moves focus to, from the focused one among `count` columns; null for keys the chart leaves alone. */
function keyTarget(key: string, index: number, count: number, page: number) {
  const targets: Record<string, number> = {
    ArrowLeft: index - 1,
    ArrowRight: index + 1,
    PageUp: index - page,
    PageDown: index + page,
    Home: 0,
    End: count - 1
  };

  if (!(key in targets)) {
    return null;
  }

  return Math.min(count - 1, Math.max(0, targets[key]));
}

/**
 * Keeps the plot scrolled to the same months while columns are added before them or resized: the months hidden to the right stay hidden, so the latest month is the initial position and a loaded batch of earlier months never moves the visible ones. Near the start, it asks for earlier months.
 */
function useMonthScroller({
  columnCount,
  placeholderCount,
  width,
  visibleCount,
  earlier,
  onScrolled
}: {
  columnCount: number;
  placeholderCount: number;
  width: number;
  visibleCount: number;
  earlier: EarlierMonths | undefined;
  onScrolled: (hiddenAfter: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const hiddenAfter = useRef(0);

  // Earlier months load once the loaded months' start is less than a view away, before their placeholders come into view; half a column of slack absorbs fractional scroll positions at the initial position.
  function loadIfNearStart(viewport: HTMLDivElement) {
    if (earlier?.hasEarlier && viewport.scrollLeft < (placeholderCount + visibleCount - 0.5) * width) {
      earlier.load();
    }
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport || width === 0) {
      return;
    }

    viewport.scrollLeft = viewport.scrollWidth - viewport.clientWidth - hiddenAfter.current * width;
  }, [columnCount, width]);

  function onScroll() {
    const viewport = viewportRef.current;

    if (!viewport || width === 0) {
      return;
    }

    const hidden = Math.max(0, Math.round((viewport.scrollWidth - viewport.clientWidth - viewport.scrollLeft) / width));

    hiddenAfter.current = hidden;
    onScrolled(hidden);
    loadIfNearStart(viewport);
  }

  return {
    viewportRef,
    onScroll
  };
}

/** A flow's bar from the zero line: income upward and expenses downward, each reversed when its amount is negative. */
function signedAmount(flow: Flow, amount: number) {
  return flow === "income" ? amount : -amount;
}

/** Each bar is anchored at the zero line, so a minimum height for tiny bars grows away from it. */
function barPosition(flow: Flow, amount: number, scale: CashFlowScale): CSSProperties {
  const signed = signedAmount(flow, amount);
  const span = barSpan(signed, scale);

  if (signed > 0) {
    return {
      bottom: cssPercent(1 - scale.zero),
      height: cssPercent(span.height)
    };
  }

  return {
    top: cssPercent(scale.zero),
    height: cssPercent(span.height)
  };
}

export function ZeroLine({ scale }: {
  scale: CashFlowScale;
}) {
  return (
    <span className={clsx(styles["plot-area"], styles["zero-layer"])} aria-hidden="true">
      <Hairline fraction={scale.zero} />
    </span>
  );
}

/** A one-device-pixel line at a fraction of its positioned parent's height, like the zero line and the dividers between category segments. */
function Hairline({ fraction }: {
  fraction: number;
}) {
  const lineRef = useRef<HTMLSpanElement>(null);

  useDevicePixelTop(lineRef, fraction);

  return (
    <span
      className={styles["hairline"]}
      ref={lineRef}
      aria-hidden="true"
      style={{
        top: cssPercent(fraction)
      }}
    />
  );
}

/** Exposes the device pixel ratio as `--device-pixel-ratio`, so sizes measured in device pixels (like the bars' minimum height beside the hairlines) can be written in CSS. */
export function useDevicePixelRatioProperty() {
  const elementRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    elementRef.current?.style.setProperty("--device-pixel-ratio", String(window.devicePixelRatio || 1));
  });

  return elementRef;
}

/** Places a hairline (one device pixel tall) at a fraction of its container's height, rounded to a device pixel row, so it is drawn crisp and identical over everything beneath it. */
function useDevicePixelTop(lineRef: RefObject<HTMLSpanElement | null>, fraction: number) {
  useLayoutEffect(() => {
    const line = lineRef.current;
    const container = line?.parentElement;

    if (!line || !container) {
      return;
    }

    const place = () => {
      const ratio = window.devicePixelRatio || 1;
      const box = container.getBoundingClientRect();
      const target = Math.round((box.top + fraction * box.height) * ratio) / ratio;

      line.style.top = `${target - box.top}px`;
      line.style.height = `${1 / ratio}px`;
    };
    const observer = new ResizeObserver(place);

    place();
    observer.observe(container);
    window.addEventListener("scroll", place, {
      passive: true
    });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", place);
    };
  }, [lineRef, fraction]);
}

// Container queries on the plot that hide the skeleton's oldest months exactly where chartMonthCount drops them.
const skeletonMonthStyles = skeletonMonthBreakpoints().map(({
  belowWidth,
  hiddenMonths
}) => `@container (width < ${belowWidth}px) { [data-skeleton-months] > :nth-child(-n + ${hiddenMonths} of .${styles["month"]}) { display: none; } }`).join("\n");

// Relative income and expense heights of the skeleton for each month of the trend.
const skeletonFlows = [[0.55, 0.4], [0.7, 0.5], [0.45, 0.6], [0.8, 0.55], [0.6, 0.35], [0.75, 0.65]];

/** A loading month's income and expense bars, each filling its share of the room on its side of the zero line. */
function SkeletonBars({
  index,
  scale
}: {
  index: number;
  scale: CashFlowScale;
}) {
  const [income, expenses] = skeletonFlows[index % skeletonFlows.length];

  return (
    <span className={styles["bars"]}>
      <span className={clsx(styles["bar"], ui["skeleton"])} style={barPosition("income", income * scale.zero * scale.extent, scale)} />
      <span className={clsx(styles["bar"], ui["skeleton"])} style={barPosition("expenses", expenses * (1 - scale.zero) * scale.extent, scale)} />
    </span>
  );
}

/** A column of the loading chart: its label and whether it is the highlighted one. */
export type SkeletonColumn = {
  key: string;
  label: string;
  current: boolean;
};

function skeletonColumn(month: Temporal.PlainYearMonth, locale: string): SkeletonColumn {
  return {
    key: month.toString(),
    label: describeMonth(month, locale).label,
    current: month.equals(currentMonth())
  };
}

export function ChartSkeleton({
  area,
  columns
}: {
  area: PendingArea;
  columns: SkeletonColumn[];
}) {
  const t = useTranslations("reports.chart");
  const scale = {
    zero: 0.5,
    extent: 2
  };

  return (
    <AreaPlaceholder area={area} failureTitle={t("failure")}>
      {/* The skeleton lays out every trend month and its stylesheet shows the ones that fit, so it matches the loaded chart before the page's script measures the width. */}
      <div className={styles["bar-chart"]} data-skeleton-months>
        <style>{skeletonMonthStyles}</style>
        <ZeroLine scale={scale} />
        {columns.map((column, index) => (
          <div className={styles["month"]} key={column.key} data-current={column.current ? "" : undefined}>
            <SkeletonBars index={index} scale={scale} />
            <span className={styles["month-label"]}>{column.label}</span>
          </div>
        ))}
      </div>
    </AreaPlaceholder>
  );
}

/** Columns that hold the place of a batch of earlier months while it loads, as wide as the months they become. */
function EarlierPlaceholders({
  count,
  scale
}: {
  count: number;
  scale: CashFlowScale;
}) {
  return (
    <div className={styles["earlier"]} aria-hidden="true">
      <ZeroLine scale={scale} />
      {Array.from({
        length: count
      }, (_, index) => (
        <div className={styles["month"]} key={index}>
          <SkeletonBars index={index} scale={scale} />
          <span className={styles["month-label"]} />
        </div>
      ))}
    </div>
  );
}

function ChartPlot({
  cashFlow,
  selection,
  targetProps,
  detailsId,
  onSelectionHidden,
  earlier,
  columns,
  onScrolled
}: Omit<Props, "cashFlow"> & {
  cashFlow: AreaResult<CashFlow>;
  columns: PlotColumns;
  onScrolled: (hiddenAfter: number) => void;
}) {
  const t = useTranslations("reports.chart");
  const tCategories = useTranslations("reports.categories");
  const locale = useLocale();
  const groupWords = {
    none: tCategories("none"),
    more: (count: string) => tCategories("more", {
      count
    })
  };
  const descriptionPrefix = useId();
  const chartRef = useDevicePixelRatioProperty();
  const router = useRouter();
  const monthTransactionsHref = useMonthTransactionsHref();
  const {
    currency
  } = cashFlow.data;
  const trend = cashFlow.data.trend;
  const months = trend.map(item => Temporal.PlainYearMonth.from(item.month));
  // A batch of placeholder columns before the loaded months keeps their size while earlier months load.
  const placeholderCount = earlier?.hasEarlier ? trendLength : 0;
  const {
    viewportRef,
    onScroll
  } = useMonthScroller({
    columnCount: placeholderCount + trend.length,
    placeholderCount,
    width: columns.width,
    visibleCount: columns.count,
    earlier,
    onScrolled
  });
  const leftEdgeNet = edgeNet(cashFlow.data, trend.length);
  const scale = cashFlowScale(trend, leftEdgeNet === null ? [] : [leftEdgeNet]);
  const chartMonths: ChartMonth[] = trend.map((item, index) => {
    const display = describeMonth(months[index], locale);

    return {
      month: item.month,
      label: display.label,
      title: display.title,
      income: item.income,
      expenses: item.expenses,
      ...netFlow(item.income, item.expenses),
      incomeGroups: groupByCategory(item.incomeBreakdown),
      expenseGroups: groupByCategory(item.expenseBreakdown)
    };
  });
  const activeMonth = chartMonths.find(item => item.month === selection?.month);
  const thisMonth = currentMonth().toString();
  const selectionHidden = selection !== null && activeMonth === undefined;

  useEffect(() => {
    if (selectionHidden) {
      onSelectionHidden();
    }
  }, [selectionHidden, onSelectionHidden]);
  const hasHistory = hasCashFlowToDraw(trend, leftEdgeNet);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-month]")];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    const target = index === -1 ? null : keyTarget(event.key, index, buttons.length, columns.count);

    if (target === null) {
      return;
    }

    event.preventDefault();
    buttons[target].focus({
      preventScroll: true
    });
    buttons[target].scrollIntoView({
      block: "nearest",
      inline: "nearest"
    });
  }

  return (
    <>
      <div
        className={styles["viewport"]}
        ref={viewportRef}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        style={{
          "--month-width": `${columns.width}px`
        } as CSSProperties}
      >
        <div className={styles["strip"]}>
          {placeholderCount > 0 && <EarlierPlaceholders count={placeholderCount} scale={scale} />}
          <div
            {...areaProps(cashFlow.status, styles["bar-chart"])}
            ref={chartRef}
            role="group"
            aria-label={t("plotLabel", {
              range: monthRangeLabel(months, locale)
            })}
            data-active={activeMonth ? "" : undefined}
          >
            {/* The selected month's column is highlighted behind the net area, so the area stays continuous across all months. */}
            {activeMonth && (
              <span
                className={styles["column-highlight"]}
                aria-hidden="true"
                style={{
                  left: cssPercent(chartMonths.indexOf(activeMonth) / chartMonths.length),
                  width: cssPercent(1 / chartMonths.length)
                }}
              />
            )}
            {hasHistory && <NetArea nets={chartMonths.map(item => item.net)} leftEdgeNet={leftEdgeNet} scale={scale} />}
            {/* Drawn after the highlight and the net area, so the zero line runs uninterrupted beneath the bars. */}
            <ZeroLine scale={scale} />
            {chartMonths.map(item => {
              const active = item === activeMonth;
              const descriptionId = `${descriptionPrefix}-${item.month}`;
              const description = t("monthDescription", {
                income: describeCategoryGroups(item.incomeGroups, currency, locale, groupWords),
                expenses: describeCategoryGroups(item.expenseGroups, currency, locale, groupWords)
              });
              const monthFigures = {
                month: item.title,
                income: money(item.income, currency, locale),
                expenses: money(item.expenses, currency, locale),
                net: money(item.net, currency, locale),
                rate: formatSavingsRate(item.savingsRate, locale)
              };

              return (
                <button
                  type="button"
                  className={styles["month"]}
                  key={item.month}
                  data-month={item.month}
                  aria-label={item.month === thisMonth ? t("currentMonthLabel", monthFigures) : t("monthLabel", monthFigures)}
                  aria-describedby={descriptionId}
                  aria-controls={detailsId}
                  data-active={active ? "" : undefined}
                  data-current={item.month === thisMonth ? "" : undefined}
                  {...targetProps(item.month, () => router.push(monthTransactionsHref(item.month)))}
                >
                  <ColumnBars
                    column={item}
                    incomeGroups={item.incomeGroups}
                    expenseGroups={item.expenseGroups}
                    active={active}
                    scale={scale}
                  />
                  <span className={styles["month-label"]}>{item.label}</span>
                  <span id={descriptionId} hidden>{description}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {!hasHistory && <p className={clsx(styles["chart-empty-note"], valueMask(cashFlow.status))}>{t("empty")}</p>}
    </>
  );
}

/**
 * The net flow across the columns as an area from the zero line. With the net entering from an earlier column (`leftEdgeNet`), the area starts at the left edge so it reads as continuing beyond the visible columns; it ends at the last column, after which there is no data.
 */
export function NetArea({
  nets,
  leftEdgeNet,
  scale
}: {
  nets: number[];
  leftEdgeNet: number | null;
  scale: CashFlowScale;
}) {
  const clipPrefix = useId();
  // Columns share the width equally, so their centres lie at even steps of a 0–100 coordinate space that stretches with the plot.
  const centre = (index: number) => (index + 0.5) / nets.length * 100;
  const zero = scale.zero * 100;
  const columnPoints = nets.map((net, index) => `${centre(index)},${scaleOffset(net, scale) * 100}`);
  const startX = leftEdgeNet === null ? centre(0) : 0;
  const netPoints = [...leftEdgeNet === null ? [] : [`0,${scaleOffset(leftEdgeNet, scale) * 100}`], ...columnPoints].join(" ");
  // The area closes along the zero line; clipping splits it into a surplus tone above and a deficit tone below.
  const netArea = `${startX},${zero} ${netPoints} ${centre(nets.length - 1)},${zero}`;
  const surplusClip = `${clipPrefix}-surplus`;
  const deficitClip = `${clipPrefix}-deficit`;

  return (
    <span className={styles["plot-area"]} aria-hidden="true">
      <svg className={styles["net-area"]} viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <clipPath id={surplusClip}>
            <rect
              x="0"
              y="0"
              width="100"
              height={zero}
            />
          </clipPath>
          <clipPath id={deficitClip}>
            <rect
              x="0"
              y={zero}
              width="100"
              height={100 - zero}
            />
          </clipPath>
        </defs>
        <polygon className={styles["net-surplus"]} points={netArea} clipPath={`url(#${surplusClip})`} />
        <polygon className={styles["net-deficit"]} points={netArea} clipPath={`url(#${deficitClip})`} />
        <polyline className={styles["net-outline"]} points={netPoints} vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

/** A column's income and expense bars; while it is active, they split into category segments and its net is marked. */
export function ColumnBars({
  column,
  incomeGroups,
  expenseGroups,
  active,
  scale
}: {
  column: {
    income: number;
    expenses: number;
    net: number;
  };
  incomeGroups: CategoryGroup[];
  expenseGroups: CategoryGroup[];
  active: boolean;
  scale: CashFlowScale;
}) {
  return (
    <span className={styles["bars"]}>
      <FlowBar
        flow="income"
        shared={sharesDirection(column)}
        amount={column.income}
        groups={active ? incomeGroups : []}
        scale={scale}
      />
      <FlowBar
        flow="expenses"
        shared={sharesDirection(column)}
        amount={column.expenses}
        groups={active ? expenseGroups : []}
        scale={scale}
      />
      {active && (
        <span
          className={styles["net-point"]}
          style={{
            top: cssPercent(scaleOffset(column.net, scale))
          }}
        />
      )}
    </span>
  );
}

/** Distances from the bar's top edge of the boundaries between its segments, which stack outward from the zero line. */
function dividerOffsets(segments: CategoryGroup[], direction: "up" | "down") {
  const boundaries = segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).reduce((sum, group) => sum + group.share, 0));

  return direction === "up" ? boundaries.map(boundary => 1 - boundary) : boundaries;
}

/** Segments show the categories of a positive total only when every category is positive: negative categories (corrections or net refunds) reduce the total, and stacking the others would overstate it. */
function splitsIntoSegments(amount: number, groups: CategoryGroup[]) {
  const shareSum = groups.reduce((sum, group) => sum + group.share, 0);

  return amount > 0 && groups.every(group => group.amount > 0) && Math.abs(shareSum - 1) < 1e-9;
}

/** Whether a month's income and expense bars extend to the same side of the zero line, as when refunds exceed spending; they are then drawn next to each other instead of on top of each other. */
function sharesDirection(month: {
  income: number;
  expenses: number;
}) {
  return month.income * -month.expenses > 0;
}

/** A month's income above or expenses below the zero line (reversed for a negative amount); while its month is selected, a positive total splits into category segments stacked outward from the zero line. */
function FlowBar({
  flow,
  shared,
  amount,
  groups,
  scale
}: {
  flow: Flow;
  shared: boolean;
  amount: number;
  groups: CategoryGroup[];
  scale: CashFlowScale;
}) {
  if (amount === 0) {
    return null;
  }

  const direction = signedAmount(flow, amount) > 0 ? "up" : "down";
  const segments = splitsIntoSegments(amount, groups) ? groups : [];

  return (
    <span
      className={clsx(styles["bar"], flow === "income" ? styles["income-bar"] : styles["expense-bar"])}
      data-flow={flow}
      data-direction={direction}
      data-shared={shared ? "" : undefined}
      style={barPosition(flow, amount, scale)}
    >
      {segments.map(group => (
        <span
          key={group.key}
          style={{
            height: cssPercent(group.share),
            background: themedColor(scheme => categoryBarColor(group.color, scheme))
          }}
        />
      ))}
      {/* Hairlines between segments, drawn over them so every segment keeps a height proportional to its amount. */}
      {dividerOffsets(segments, direction).map(offset => <Hairline key={offset} fraction={offset} />)}
    </span>
  );
}
