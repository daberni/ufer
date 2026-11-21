"use client";

import { useId } from "react";
import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./wealth-summary.module.css";
import { Wallet } from "lucide-react";
import { money, signedMoney } from "@/lib/money";
import { valueMask, withPlaceholder } from "@/components/ui/result-presentation";
import { FailureCover } from "@/components/ui/area-placeholder";
import { useCurrency } from "@/client/use-app-url";
import { showsCurrencySelect } from "@/features/accounts/queries";
import { CurrencyChoice } from "@/features/accounts/components/currency-choice";
import type { Area } from "@/components/ui/use-area-result";
import type { NetWorth } from "@/features/accounts/types";
import { Temporal } from "temporal-polyfill";
import { netWorthBars } from "@/features/reports/net-worth-bars";
import { shortMonthWithYear } from "@/lib/date-format";
import { SignedArea } from "@/components/ui/signed-area";
import { valueScale } from "@/lib/value-scale";
import { netWorthChange, type NetWorthChange, type NetWorthHistory, type NetWorthPoint } from "@/features/reports/net-worth-series";
import { useCurveActivation } from "@/features/reports/use-curve-activation";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";
import { cssPercent } from "@/lib/percent";

type Props = {
  /** The currencies in use and the selected one; with several, the currency badge becomes the choice of accounts shown. */
  currencies: string[];
  /** Whether any account uses the display currency; assumed while the accounts load, so the masked figure keeps its place. */
  hasAccounts: boolean;
  netWorthArea: Area<NetWorth>;
  historyArea: Area<NetWorthHistory>;
};

/** Net worth and its composition; the period's income, expenses, net and savings rate belong to the cash-flow panels below. */
export function WealthSummary({
  currencies,
  hasAccounts,
  netWorthArea,
  historyArea
}: Props) {
  const locale = useLocale();
  const changesId = useId();
  const selectedCurrency = useCurrency();
  const netWorth = withPlaceholder(netWorthArea, () => ({
    currency: selectedCurrency,
    netWorth: 0,
    liquidity: 0,
    investments: 0,
    property: 0,
    liabilities: 0,
    unvalued: 0
  }));
  const summary = netWorth.data;
  const netWorthValue = valueMask(netWorth.status);
  const currency = summary.currency;
  const bars = netWorthBars(summary);
  const historyReady = historyArea.status === "ready" && historyArea.data.currency === currency;
  const points = historyReady ? historyArea.data.points : [];
  const historyPending = !historyReady || netWorth.status !== "ready";
  const change = netWorth.status === "ready" && hasAccounts ? netWorthChange(points) : null;
  const {
    active,
    curveProps
  } = useCurveActivation();
  const shownChange = active ? change : null;
  const since = change ? shortMonthWithYear(Temporal.PlainYearMonth.from(change.since), locale) : "";
  // While the curve is active, each figure gets its change over the curve's period beneath it; the line's space is always reserved, so nothing moves.
  const delta = (changed: number | undefined) => {
    const amount = changed ?? 0;

    return (
      <span className={clsx(styles["delta"], amount > 0 && styles["gain"], amount < 0 && styles["loss"], !shownChange && styles["concealed"])} aria-hidden="true">
        {change ? signedMoney(amount, currency, locale) : "\u00a0"}
      </span>
    );
  };

  return (
    <section className={styles["wealth-card"]} aria-busy={netWorth.status === "loading"}>
      <div className={styles["wealth-card-top"]}>
        <span>
          <span className={styles["wealth-mark"]}>
            <Wallet size={17} />
          </span>
          Net worth
        </span>
        {showsCurrencySelect(currencies) ? <CurrencyChoice compact className={styles["currency-choice"]} currencies={currencies} /> : <span className={clsx(styles["small-tag"], netWorthValue)}>{currency}</span>}
      </div>
      <div className={styles["headline"]}>
        <div className={clsx(styles["wealth-number"], netWorthValue)}>{hasAccounts ? money(summary.netWorth, currency, locale) : "—"}</div>
        {hasAccounts && (
          <span className={clsx(styles["headline-delta"], !shownChange && styles["concealed"])} aria-hidden="true">
            {delta(change?.amount_minor)} {change ? `since ${since}` : ""}
          </span>
        )}
      </div>
      {summary.unvalued > 0 && <p>{formatCount(summary.unvalued, locale)} without a balance</p>}
      {/* Assets and loans share one scale; the loan track is always laid out, so the card's height does not depend on having loans. */}
      <div className={clsx(styles["bars"], netWorthValue)} aria-hidden="true">
        <div className={styles["bar-track"]}>
          <span
            className={styles["bar-fill"]}
            style={{
              width: cssPercent(bars.assets)
            }}
          >
            <span
              className={styles["cash-segment"]}
              style={{
                flex: bars.segments.cash
              }}
            />
            <span
              className={styles["investment-segment"]}
              style={{
                flex: bars.segments.investments
              }}
            />
            <span
              className={styles["property-segment"]}
              style={{
                flex: bars.segments.property
              }}
            />
          </span>
        </div>
        <div className={clsx(styles["bar-track"], styles["loan-track"])}>
          <span
            className={clsx(styles["bar-fill"], styles["loan-segment"])}
            style={{
              width: cssPercent(bars.loans)
            }}
          />
        </div>
      </div>
      <div className={styles["wealth-allocation"]}>
        <span>
          <i className={clsx(styles["legend-dot"], ui["liquid"])} />
          Cash<strong className={netWorthValue}>{money(summary.liquidity, currency, locale)}
            {delta(change?.categories.liquidity)}
          </strong>
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], styles["invested"])} />
          Investments<strong className={netWorthValue}>{money(summary.investments, currency, locale)}
            {delta(change?.categories.investments)}
          </strong>
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], ui["property"])} />
          Property<strong className={netWorthValue}>{money(summary.property, currency, locale)}
            {delta(change?.categories.property)}
          </strong>
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], styles["loans"])} />
          Loans<strong className={netWorthValue}>{summary.liabilities === 0 && netWorth.status === "ready" ? "—" : money(summary.liabilities, currency, locale)}
            {delta(change?.categories.liabilities)}
          </strong>
        </span>
      </div>
      {/* The curve's place is held until the history for the shown currency arrives, so the card and the accounts panel beside it keep their height. */}
      {hasAccounts && (historyPending ? <div className={styles["history-curve"]} aria-hidden="true" /> : change && (
        <button
          type="button"
          className={styles["history-curve"]}
          aria-label={`Show changes since ${since}`}
          aria-pressed={active}
          aria-describedby={changesId}
          {...curveProps}
        >
          <HistoryCurve points={points} active={active} />
        </button>
      ))}
      <span id={changesId} className={ui["visually-hidden"]} aria-live="polite">{shownChange && changeAnnouncement(shownChange, since, currency, locale)}</span>
      {netWorthArea.status === "pending" && netWorthArea.failure && <FailureCover failure={netWorthArea.failure} subject="Your net worth" />}
    </section>
  );
}

function changeAnnouncement(change: NetWorthChange, since: string, currency: string, locale: string) {
  const amount = (value: number) => signedMoney(value, currency, locale);

  return `Since ${since}: net worth ${amount(change.amount_minor)}, cash ${amount(change.categories.liquidity)}, investments ${amount(change.categories.investments)}, property ${amount(change.categories.property)}, loans ${amount(change.categories.liabilities)}.`;
}

const curveHeight = 40;
const curveTop = 2;
const curveBase = curveHeight * 0.8;

/** An area curve of the past year; activating it shows the changes over that year in the figures above. */
function HistoryCurve({
  points,
  active
}: {
  points: NetWorthPoint[];
  active: boolean;
}) {
  if (points.length < 2) {
    return null;
  }

  // Min–max scale between a small top margin and a base fifth of the height, so the area never touches the bottom edge; a flat year rests on that base.
  const scale = valueScale(points.map(point => point.amount_minor), {
    top: curveTop,
    base: curveBase,
    flat: curveBase
  });
  const x = (index: number) => index / (points.length - 1) * 100;
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${scale.y(point.amount_minor)}`).join(" ");

  return (
    <svg
      className={clsx(styles["curve"], active && styles["active"])}
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <SignedArea
        line={line}
        height={curveHeight}
        zero={scale.zero}
        areaClassName={styles["history-area"]}
        lineClassName={styles["history-line"]}
        positiveClassName={styles["positive"]}
        negativeClassName={styles["negative"]}
        zeroClassName={styles["zero"]}
      />
    </svg>
  );
}
