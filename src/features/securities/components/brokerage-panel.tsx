"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./brokerage-panel.module.css";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("securities.holdings");
  const trades = useBrokerageTrades(account.id);
  const securities = useSecurities();
  const [booking, setBooking] = useState<string | null>(null);
  const priceSource = securities.data?.price_source;

  if (trades.isPending) {
    return <section className={clsx(ui["panel"], styles["panel"])} aria-busy="true"><h2>{t("title")}</h2></section>;
  }

  if (trades.isError) {
    return (
      <section className={clsx(ui["panel"], styles["panel"])}>
        <h2>{t("title")}</h2>
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
        <h2 id={`${account.id}-holdings`}>{t("title")}</h2>
        {priceSource && !priceSource.configured && (
          <p className={styles["notice"]}>{t("priceSourceNotice", {
            message: priceSource.message ?? ""
          })}</p>
        )}
        {open.length ? (
          <HoldingsTable
            label={t("title")}
            holdings={open}
            trades={trades.data.trades}
            securities={securities.data?.securities ?? []}
            currency={account.currency}
            openBooking={setBooking}
          />
        ) : <Empty title={t("emptyTitle")} illustration={null}>{t("emptyBody")}</Empty>}
      </section>
      {closed.length > 0 && (
        <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={`${account.id}-closed`}>
          <h2 id={`${account.id}-closed`}>{t("closed")}</h2>
          <HoldingsTable
            label={t("closed")}
            holdings={closed}
            trades={trades.data.trades}
            securities={securities.data?.securities ?? []}
            currency={account.currency}
            openBooking={setBooking}
          />
        </section>
      )}
      {booking && <BookingDialog transactionId={booking} close={() => setBooking(null)} />}
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
  const t = useTranslations("securities.holdings.columns");
  const locale = useLocale();
  const byId = new Map(securities.map(security => [security.id, security]));
  const tradesOf = (securityId: string) => trades.filter(trade => trade.security_id === securityId).toReversed();

  return (
    <div className={styles["table"]} role="table" aria-label={label}>
      <div className={clsx(styles["row"], styles["head"])} role="row">
        <span role="columnheader">{t("security")}</span>
        <span role="columnheader" className={styles["number"]}>{t("shares")}</span>
        <span role="columnheader" className={styles["number"]}>{t("averageCost")}</span>
        <span role="columnheader" className={styles["number"]}>{t("costBasis")}</span>
        <span role="columnheader" className={styles["number"]}>{t("price")}</span>
        <span role="columnheader" className={styles["number"]}>{t("value")}</span>
        <span role="columnheader" className={styles["number"]}>{t("gain")}</span>
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
  const t = useTranslations("securities.holdings");
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
        <span role="cell" className={styles["number"]} data-label={t("columns.shares")}>{held ? formatQuantity(holding.quantity_micros, locale) : t("sold")}</span>
        <span role="cell" className={styles["number"]} data-label={t("columns.averageCost")}>{averageCost === null ? "—" : formatPrice(averageCost, currency, locale, digits)}</span>
        <span role="cell" className={styles["number"]} data-label={t("columns.costBasis")}>{held ? money(holding.cost_minor, currency, locale) : "—"}</span>
        <span role="cell" className={styles["number"]} data-label={t("columns.price")}>
          <PriceCell
            holding={holding}
            security={security}
            currency={currency}
            locale={locale}
            digits={digits}
          />
        </span>
        <span role="cell" className={clsx(styles["number"], styles["value"])} data-label={t("columns.value")}>{held ? money(holding.value_minor, currency, locale) : "—"}</span>
        <span role="cell" className={clsx(styles["number"], showGain && gain > 0 && ui["positive"])} data-label={held ? t("columns.gain") : t("columns.realized")}>
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
  const t = useTranslations("securities.holdings");
  const buy = trade.side === "buy";
  const side = t("side", {
    side: trade.side
  });
  const date = dateWithYear(Temporal.PlainDate.from(trade.date), locale);
  const quantity = formatQuantity(trade.quantity_micros, locale);
  const bookingText = trade.settlement_counterparty || trade.settlement_description;
  const settlement = [trade.settlement_account_name, bookingText].filter(Boolean).join(" · ");
  const fees = trade.fee_minor > 0 ? money(trade.fee_minor, trade.currency, locale) : null;
  const settlementId = trade.settlement_transaction_id;
  const openLabel = settlement ? t("openTradeBooked", {
    side: trade.side,
    quantity,
    date,
    settlement
  }) : t("openTrade", {
    side: trade.side,
    quantity,
    date
  });

  return (
    <div className={clsx(styles["row"], styles["trade"])} role="row">
      <span role="rowheader" className={styles["security"]}>
        {settlementId ? (
          <button
            type="button"
            className={styles["open-trade"]}
            onClick={() => openBooking(settlementId)}
            aria-label={openLabel}
          >
            <strong>{side}</strong>
          </button>
        ) : <strong>{side}</strong>}
        {settlement && <small className={styles["settlement"]}>{settlement}</small>}
      </span>
      <span role="cell" className={styles["number"]} data-label={t("columns.shares")}>{buy ? quantity : `−${quantity}`}</span>
      <span role="cell" className={clsx(styles["number"], styles["empty"])} data-label={t("columns.averageCost")} />
      <span role="cell" className={clsx(styles["number"], !buy && styles["empty"])} data-label={t("columns.costBasis")}>
        {buy && (
          <>
            {money(trade.gross_minor + trade.fee_minor, trade.currency, locale)}
            {fees && (
              <small>{t("includingFees", {
                fees
              })}</small>
            )}
          </>
        )}
      </span>
      <span role="cell" className={styles["number"]} data-label={t("columns.price")}>
        {formatPrice(trade.price_micros, trade.currency, locale, digits)}
        <small>{date}</small>
      </span>
      <span role="cell" className={clsx(styles["number"], buy && styles["empty"])} data-label={t("columns.proceeds")}>
        {!buy && (
          <>
            {money(trade.gross_minor - trade.fee_minor, trade.currency, locale)}
            {fees && (
              <small>{t("afterFees", {
                fees
              })}</small>
            )}
          </>
        )}
      </span>
      <span role="cell" className={clsx(styles["number"], trade.realized_minor === null && styles["empty"], trade.realized_minor !== null && trade.realized_minor > 0 && ui["positive"])} data-label={t("columns.realizedGain")}>
        {trade.realized_minor !== null && (
          <>
            {signedMoney(trade.realized_minor, trade.currency, locale)}
            <small>{t("realizedNote")}</small>
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
  const t = useTranslations("securities.holdings");

  if (holding.quantity_micros === 0) {
    return "—";
  }

  if (holding.status === "missing" || !holding.price) {
    return (
      <Tooltip text={security?.price_error ?? t("noPriceKnown")}>
        {trigger => (
          <span {...trigger} className={styles["warning"]}>
            {t("noPrice")}
            <small>{t("valuedAtCost")}</small>
          </span>
        )}
      </Tooltip>
    );
  }

  const date = dateWithYear(Temporal.PlainDate.from(holding.price.date), locale);
  const venue = security?.venue ?? security?.provider_symbol?.split(".").at(-1);
  const listing = [venue, security?.provider_symbol && security.provider_symbol !== venue ? security.provider_symbol : null].filter(Boolean);
  const stale = holding.status === "stale";
  const tip = [t("closingPrice", {
    date
  }), listing.join(", "), stale ? t("notUpdatedRecently") : ""].filter(Boolean).join(" · ");

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
