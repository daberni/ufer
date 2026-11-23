"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./brokerage-panel.module.css";

import { useId, useState } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { FormError } from "@/components/ui/form-error";
import { Tooltip } from "@/components/ui/tooltip";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { dateWithYear } from "@/lib/date-format";
import { money, signedMoney } from "@/lib/money";
import type { Account } from "@/features/accounts/types";
import { useBrokerageTrades, useSecurities } from "../queries";
import type { Holding, Security, Trade } from "../types";
import { averageCostMicros } from "../holdings";
import { formatPrice, formatQuantity, priceDigits } from "./holding-format";
import { BookingDialog } from "./booking-dialog";

/**
 * A brokerage account's holdings: one row per security with quantity, average cost (Einstandskurs), cost basis (Einstandswert), current price, value and gain.
 * Each row expands to its buys and sells in the same columns; a trade row opens its booking, where the trade is changed (ADR 012). The depot itself is read-only.
 */
export function BrokeragePanel({ account }: {
  account: Account
}) {
  const trades = useBrokerageTrades(account.id);
  const securities = useSecurities();
  const [booking, setBooking] = useState<string | null>(null);
  const priceSource = securities.data?.price_source;

  // The price-source notice comes from the securities query and sits above the table, so the skeleton waits for both.
  if (!trades.isError && (trades.isPending || securities.isPending)) {
    return (
      <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={`${account.id}-holdings`} aria-busy="true">
        <h2 id={`${account.id}-holdings`}>Holdings</h2>
        <HoldingsTableSkeleton />
      </section>
    );
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

  return (
    <>
      <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={`${account.id}-holdings`}>
        <h2 id={`${account.id}-holdings`}>Holdings</h2>
        {priceSource && !priceSource.configured && <p className={styles["notice"]}>{priceSource.message} Holdings are valued at their last known price or their cost.</p>}
        {open.length ? (
          <HoldingsTable
            label="Holdings"
            holdings={open}
            trades={trades.data.trades}
            securities={securities.data?.securities ?? []}
            currency={account.currency}
            openBooking={setBooking}
          />
        ) : <Empty title="No holdings yet" illustration={null}>Record a buy from its booking on the cash account, or with Add trade.</Empty>}
      </section>
      {closed.length > 0 && (
        <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={`${account.id}-closed`}>
          <h2 id={`${account.id}-closed`}>Closed positions</h2>
          <HoldingsTable
            label="Closed positions"
            holdings={closed}
            trades={trades.data.trades}
            securities={securities.data?.securities ?? []}
            currency={account.currency}
            openBooking={setBooking}
          />
        </section>
      )}
      {booking && <BookingDialog transactionId={booking} depotId={account.id} close={() => setBooking(null)} />}
    </>
  );
}

/** Holdings with their expandable trades; the Brokerage overview reuses it per account. */
export function HoldingsTable({
  label,
  holdings,
  trades,
  securities,
  currency,
  openBooking
}: {
  label: string;
  holdings: Holding[];
  trades: Trade[];
  securities: Security[];
  currency: string;
  openBooking: (transactionId: string) => void;
}) {
  const locale = useLocale();
  const byId = new Map(securities.map(security => [security.id, security]));
  const tradesOf = (securityId: string) => trades.filter(trade => trade.security_id === securityId).toReversed();

  return (
    <div className={styles["table"]} role="table" aria-label={label}>
      <div className={clsx(styles["row"], styles["head"])} role="row">
        <span role="columnheader">Security</span>
        <span role="columnheader" className={styles["number"]}>Shares</span>
        <span role="columnheader" className={styles["number"]}>Avg. cost</span>
        <span role="columnheader" className={styles["number"]}>Cost basis</span>
        <span role="columnheader" className={styles["number"]}>Price</span>
        <span role="columnheader" className={styles["number"]}>Value</span>
        <span role="columnheader" className={styles["number"]}>Gain</span>
      </div>
      {holdings.map(holding => (
        <HoldingRows
          key={holding.security_id}
          holding={holding}
          security={byId.get(holding.security_id)}
          trades={tradesOf(holding.security_id)}
          currency={currency}
          locale={locale}
          openBooking={openBooking}
        />
      ))}
    </div>
  );
}

/** The holdings table's columns with placeholder rows, held while the holdings load. */
export function HoldingsTableSkeleton({ rows = 2 }: {
  rows?: number
}) {
  return (
    <div className={styles["table"]} aria-hidden="true">
      <div className={clsx(styles["row"], styles["head"])}>
        <span>Security</span>
        <span className={styles["number"]}>Shares</span>
        <span className={styles["number"]}>Avg. cost</span>
        <span className={styles["number"]}>Cost basis</span>
        <span className={styles["number"]}>Price</span>
        <span className={styles["number"]}>Value</span>
        <span className={styles["number"]}>Gain</span>
      </div>
      {Array.from({
        length: rows
      }, (_, index) => (
        <div key={index} className={styles["row"]}>
          <span className={clsx(styles["security"], styles["skeleton-security"])}>
            <strong className={ui["skeleton"]}>Global equity ETF</strong>
            <small className={ui["skeleton"]}>IE00B0000000</small>
          </span>
          <span className={styles["number"]} data-label="Shares"><span className={ui["skeleton"]}>00.000</span></span>
          <span className={styles["number"]} data-label="Avg. cost"><span className={ui["skeleton"]}>€00.00</span></span>
          <span className={styles["number"]} data-label="Cost basis"><span className={ui["skeleton"]}>€0,000.00</span></span>
          <span className={styles["number"]} data-label="Price">
            <span className={ui["skeleton"]}>€00.00</span>
            <small className={ui["skeleton"]}>23 Nov 2026</small>
          </span>
          <span className={clsx(styles["number"], styles["value"])} data-label="Value"><span className={ui["skeleton"]}>€0,000.00</span></span>
          <span className={styles["number"]} data-label="Gain">
            <span className={ui["skeleton"]}>+€000.00</span>
            <small className={ui["skeleton"]}>+0.0%</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function percent(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    signDisplay: "exceptZero",
    maximumFractionDigits: 1
  }).format(value);
}

function HoldingRows({
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
  // Per-share figures of one holding share their decimals; the average cost is rounded to them.
  const digits = priceDigits([...trades.map(trade => trade.price_micros), ...holding.price ? [holding.price.close_micros] : []], currency);
  const averageCost = held ? averageCostMicros(holding.cost_minor, holding.quantity_micros, currency) : null;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <>
      <div className={clsx(styles["row"], styles["holding"])} role="row">
        <span role="rowheader" className={styles["security"]}>
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
              {security?.isin && security.isin !== holding.security_name && <small className={styles["isin"]}>{security.isin}</small>}
            </span>
          </button>
        </span>
        <span role="cell" className={styles["number"]} data-label="Shares">{held ? formatQuantity(holding.quantity_micros, locale) : "Sold"}</span>
        <span role="cell" className={styles["number"]} data-label="Avg. cost">{averageCost === null ? "—" : formatPrice(averageCost, currency, locale, digits)}</span>
        <span role="cell" className={styles["number"]} data-label="Cost basis">{held ? money(holding.cost_minor, currency, locale) : "—"}</span>
        <span role="cell" className={styles["number"]} data-label="Price">
          <PriceCell
            holding={holding}
            security={security}
            currency={currency}
            locale={locale}
            digits={digits}
          />
        </span>
        <span role="cell" className={clsx(styles["number"], styles["value"])} data-label="Value">{held ? money(holding.value_minor, currency, locale) : "—"}</span>
        <span role="cell" className={clsx(styles["number"], showGain && gain > 0 && ui["positive"], showGain && gain < 0 && ui["negative"])} data-label={held ? "Gain" : "Realized"}>
          {showGain ? signedMoney(gain, currency, locale) : "—"}
          {gainPercent !== null && <small>{percent(gainPercent, locale)}</small>}
        </span>
      </div>
      {/* A presentational wrapper, so the trade rows belong to the table directly. */}
      <div
        id={tradesId}
        className={styles["trades"]}
        role="none"
        hidden={!expanded}
      >
        {expanded && trades.map(trade => (
          <TradeRow
            key={trade.id}
            trade={trade}
            locale={locale}
            digits={digits}
            openBooking={openBooking}
          />
        ))}
      </div>
    </>
  );
}

/** A buy or sell in its holding's columns; the whole row opens the trade with its settlement booking. */
function TradeRow({
  trade,
  locale,
  digits,
  openBooking
}: {
  trade: Trade;
  locale: string;
  digits: number;
  openBooking: (transactionId: string) => void;
}) {
  const buy = trade.side === "buy";
  const side = buy ? "Buy" : "Sell";
  const date = dateWithYear(Temporal.PlainDate.from(trade.date), locale);
  const quantity = formatQuantity(trade.quantity_micros, locale);
  const bookingText = trade.settlement_counterparty || trade.settlement_description;
  const settlement = [trade.settlement_account_name, bookingText].filter(Boolean).join(" · ");
  const fees = trade.fee_minor > 0 ? money(trade.fee_minor, trade.currency, locale) : null;
  const settlementId = trade.settlement_transaction_id;

  return (
    <div className={clsx(styles["row"], styles["trade"])} role="row">
      <span role="rowheader" className={styles["security"]}>
        {settlementId ? (
          <button
            type="button"
            className={styles["open-trade"]}
            onClick={() => openBooking(settlementId)}
            aria-label={`Open ${side.toLowerCase()} of ${quantity} on ${date}${settlement ? `, booked on ${settlement}` : ""}`}
          >
            <strong>{side}</strong>
          </button>
        ) : <strong>{side}</strong>}
        {settlement && <small className={styles["settlement"]}>{settlement}</small>}
      </span>
      <span role="cell" className={styles["number"]} data-label="Shares">{buy ? quantity : `−${quantity}`}</span>
      <span role="cell" className={clsx(styles["number"], styles["empty"])} data-label="Avg. cost" />
      <span role="cell" className={clsx(styles["number"], !buy && styles["empty"])} data-label="Cost basis">
        {buy && (
          <>
            {money(trade.gross_minor + trade.fee_minor, trade.currency, locale)}
            {fees && <small>incl. {fees} fees</small>}
          </>
        )}
      </span>
      <span role="cell" className={styles["number"]} data-label="Price">
        {formatPrice(trade.price_micros, trade.currency, locale, digits)}
        <small>{date}</small>
      </span>
      <span role="cell" className={clsx(styles["number"], buy && styles["empty"])} data-label="Proceeds">
        {!buy && (
          <>
            {money(trade.gross_minor - trade.fee_minor, trade.currency, locale)}
            {fees && <small>after {fees} fees</small>}
          </>
        )}
      </span>
      <span role="cell" className={clsx(styles["number"], trade.realized_minor === null && styles["empty"], trade.realized_minor !== null && trade.realized_minor > 0 && ui["positive"], trade.realized_minor !== null && trade.realized_minor < 0 && ui["negative"])} data-label="Realized gain">
        {trade.realized_minor !== null && (
          <>
            {signedMoney(trade.realized_minor, trade.currency, locale)}
            <small>realized</small>
          </>
        )}
      </span>
    </div>
  );
}

/** The price a holding is valued with and its date; its listing and closing date are in a tooltip. Without a price, why there is none. */
function PriceCell({
  holding,
  security,
  currency,
  locale,
  digits
}: {
  holding: Holding;
  security: Security | undefined;
  currency: string;
  locale: string;
  digits: number;
}) {
  if (holding.quantity_micros === 0) {
    return "—";
  }

  if (holding.status === "missing" || !holding.price) {
    return (
      <Tooltip text={security?.price_error ?? "No price is known for this security yet."}>
        {trigger => (
          <span {...trigger} className={styles["warning"]}>
            No price
            <small>valued at cost</small>
          </span>
        )}
      </Tooltip>
    );
  }

  const date = dateWithYear(Temporal.PlainDate.from(holding.price.date), locale);
  const venue = security?.venue ?? security?.provider_symbol?.split(".").at(-1);
  const listing = [venue, security?.provider_symbol && security.provider_symbol !== venue ? security.provider_symbol : null].filter(Boolean);
  const stale = holding.status === "stale";
  const tip = `Closing price on ${date}${listing.length ? ` · ${listing.join(", ")}` : ""}${stale ? " · not updated recently" : ""}`;

  return (
    <Tooltip text={tip}>
      {trigger => (
        <span {...trigger} className={styles["price"]}>
          {formatPrice(holding.price!.close_micros, currency, locale, digits)}
          <small className={clsx(stale && styles["warning"])}>{date}</small>
        </span>
      )}
    </Tooltip>
  );
}
