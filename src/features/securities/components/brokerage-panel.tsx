"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./brokerage-panel.module.css";

import { useId, useState } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { FormError } from "@/components/ui/form-error";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { dateWithYear } from "@/lib/date-format";
import { currencyExponent, money, signedMoney } from "@/lib/money";
import type { Account } from "@/features/accounts/types";
import { useBrokerageTrades, useSecurities } from "../queries";
import type { Holding, Security, Trade } from "../types";
import { formatPrice, formatQuantity } from "./holding-format";
import { BookingDialog } from "./booking-dialog";

/**
 * A brokerage account's holdings: one row per security with quantity, average cost, cost basis, current price with its date and venue, value and gain.
 * Each row opens its buys and sales, and each of those opens its booking, where the trade is changed (ADR 012); the depot itself is read-only.
 */
export function BrokeragePanel({ account }: {
  account: Account
}) {
  const locale = useLocale();
  const trades = useBrokerageTrades(account.id);
  const securities = useSecurities();
  const [booking, setBooking] = useState<string | null>(null);
  const priceSource = securities.data?.price_source;
  const byId = new Map((securities.data?.securities ?? []).map(security => [security.id, security]));

  if (trades.isPending) {
    return <section className={clsx(ui["panel"], styles["panel"])} aria-busy="true"><h2>Holdings</h2></section>;
  }

  if (trades.isError) {
    return (
      <section className={clsx(ui["panel"], styles["panel"])}>
        <h2>Holdings</h2>
        <FormError failure={toFailure(trades.error)} />
      </section>
    );
  }

  const { valuation } = trades.data;
  const open = valuation.holdings.filter(holding => holding.quantity_micros > 0);
  const closed = valuation.holdings.filter(holding => holding.quantity_micros === 0);
  const tradesOf = (securityId: string) => trades.data.trades.filter(trade => trade.security_id === securityId).toReversed();
  const rows = (holdings: Holding[]) => holdings.map(holding => (
    <HoldingRow
      key={holding.security_id}
      holding={holding}
      security={byId.get(holding.security_id)}
      trades={tradesOf(holding.security_id)}
      currency={account.currency}
      locale={locale}
      openBooking={setBooking}
    />
  ));

  return (
    <>
      <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={`${account.id}-holdings`}>
        <h2 id={`${account.id}-holdings`}>Holdings</h2>
        {priceSource && !priceSource.configured && <p className={styles["notice"]}>{priceSource.message} Holdings are valued at their last known price or their cost.</p>}
        {open.length ? (
          <div className={styles["table"]} role="table" aria-label="Holdings">
            <HeadRow />
            {rows(open)}
          </div>
        ) : <Empty title="No holdings yet" illustration={null}>Record a buy from its booking on the cash account, or with Add trade.</Empty>}
      </section>
      {closed.length > 0 && (
        <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={`${account.id}-closed`}>
          <h2 id={`${account.id}-closed`}>Closed positions</h2>
          <div className={styles["table"]} role="table" aria-label="Closed positions">
            <HeadRow />
            {rows(closed)}
          </div>
        </section>
      )}
      {booking && <BookingDialog transactionId={booking} close={() => setBooking(null)} />}
    </>
  );
}

function HeadRow() {
  return (
    <div className={clsx(styles["row"], styles["head"])} role="row">
      <span role="columnheader">Security</span>
      <span role="columnheader" className={styles["number"]}>Shares</span>
      <span role="columnheader" className={styles["number"]}>Avg. cost</span>
      <span role="columnheader" className={styles["number"]}>Cost basis</span>
      <span role="columnheader" className={styles["number"]}>Price</span>
      <span role="columnheader" className={styles["number"]}>Value</span>
      <span role="columnheader" className={styles["number"]}>Gain</span>
    </div>
  );
}

function HoldingRow({
  holding,
  security,
  trades,
  currency,
  locale,
  openBooking
}: {
  holding: Holding;
  security: Security | undefined;
  trades: Trade[];
  currency: string;
  locale: string;
  openBooking: (transactionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tradesId = useId();
  const held = holding.quantity_micros > 0;
  const gain = held ? holding.value_minor - holding.cost_minor : holding.realized_minor;
  const showGain = !held || holding.status !== "missing";
  const gainPercent = held && holding.cost_minor > 0 && showGain ? gain / holding.cost_minor : null;
  // Display only: the average cost per share in micro-units, from the cost in minor units and the quantity in micro-units.
  const microsPerMinor = 10 ** (6 - (currencyExponent(currency) ?? 2));
  const averageCostMicros = held ? Math.round(holding.cost_minor * microsPerMinor * 1_000_000 / holding.quantity_micros) : null;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <>
      <div className={styles["row"]} role="row">
        <span role="cell" className={styles["security"]}>
          <button
            type="button"
            className={styles["toggle"]}
            aria-expanded={expanded}
            aria-controls={tradesId}
            onClick={() => setExpanded(!expanded)}
          >
            <Chevron size={16} aria-hidden="true" />
            <span>
              <strong>{holding.security_name}</strong>
              {security?.isin && security.isin !== holding.security_name && <small>{security.isin}</small>}
            </span>
          </button>
        </span>
        <span role="cell" className={styles["number"]} data-label="Shares">{held ? formatQuantity(holding.quantity_micros, locale) : "Sold"}</span>
        <span role="cell" className={styles["number"]} data-label="Avg. cost">{averageCostMicros === null ? "—" : formatPrice(averageCostMicros, currency, locale)}</span>
        <span role="cell" className={styles["number"]} data-label="Cost basis">{held ? money(holding.cost_minor, currency, locale) : "—"}</span>
        <span role="cell" className={styles["number"]} data-label="Price">
          <PriceCell
            holding={holding}
            security={security}
            currency={currency}
            locale={locale}
          />
        </span>
        <span role="cell" className={clsx(styles["number"], styles["value"])} data-label="Value">{held ? money(holding.value_minor, currency, locale) : "—"}</span>
        <span role="cell" className={clsx(styles["number"], showGain && gain > 0 && ui["positive"])} data-label={held ? "Gain" : "Realized"}>
          {showGain ? signedMoney(gain, currency, locale) : "—"}
          {gainPercent !== null && (
            <small>
              {new Intl.NumberFormat(locale, {
                style: "percent",
                signDisplay: "exceptZero",
                maximumFractionDigits: 1
              }).format(gainPercent)}
            </small>
          )}
        </span>
      </div>
      {expanded && (
        <div id={tradesId} className={styles["trades"]} role="row">
          <ul role="cell" aria-label={`Trades of ${holding.security_name}`}>
            {trades.map(trade => (
              <li key={trade.id}>
                <span>{dateWithYear(Temporal.PlainDate.from(trade.date), locale)}</span>
                <span>{trade.side === "buy" ? "Buy" : "Sale"}</span>
                <span className={styles["number"]}>{formatQuantity(trade.quantity_micros, locale)} × {formatPrice(trade.price_micros, trade.currency, locale)}</span>
                <span className={styles["number"]}>
                  {money(trade.gross_minor, trade.currency, locale)}
                  {trade.fee_minor > 0 && <small>+ {money(trade.fee_minor, trade.currency, locale)} fees</small>}
                </span>
                {trade.settlement_transaction_id ? (
                  <button type="button" className={ui["text-button"]} onClick={() => openBooking(trade.settlement_transaction_id!)}>
                    Booking
                  </button>
                ) : <span />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** The price a holding is valued with, its date and venue, or why there is none. */
function PriceCell({
  holding,
  security,
  currency,
  locale
}: {
  holding: Holding;
  security: Security | undefined;
  currency: string;
  locale: string;
}) {
  if (holding.quantity_micros === 0) {
    return "—";
  }

  if (holding.status === "missing" || !holding.price) {
    return (
      <span className={styles["warning"]} title={security?.price_error ?? undefined}>
        No price
        <small>valued at cost</small>
      </span>
    );
  }

  const venue = security?.venue ?? security?.provider_symbol?.split(".").at(-1);

  return (
    <>
      {formatPrice(holding.price.close_micros, currency, locale)}
      <small className={clsx(holding.status === "stale" && styles["warning"])}>
        {dateWithYear(Temporal.PlainDate.from(holding.price.date), locale)}{venue ? ` · ${venue}` : ""}{holding.status === "stale" ? " · not updated recently" : ""}
      </small>
    </>
  );
}
