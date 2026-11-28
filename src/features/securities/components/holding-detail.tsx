"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./brokerage-panel.module.css";
import detail from "./holding-detail.module.css";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { ArrowRightLeft } from "lucide-react";
import { FormError } from "@/components/ui/form-error";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { useHoldingSecurity } from "@/client/use-app-url";
import { dateWithYear } from "@/lib/date-format";
import { money, signedMoney } from "@/lib/money";
import type { Account } from "@/features/accounts/types";
import { useAccounts } from "@/features/accounts/queries";
import { useBrokerageHolding } from "../queries";
import type { Holding, Trade } from "../types";
import { formatPrice, formatQuantity, priceDigits } from "./holding-format";
import { HoldingsTable, HoldingsTableSkeleton } from "./brokerage-panel";
import { PriceHistoryPanel } from "./price-history-chart";
import { BookingDialog } from "./booking-dialog";
import { TransferDialog, TransferEditDialog } from "./transfer-dialog";

/**
 * One holding of a brokerage account: its figures today, its buys, sells and transfers newest first, and a chart of the closes Ufer stores for its security.
 * A trade row opens its booking, where the trade is changed or deleted (ADR 012), and a transfer row opens the transfer; shares move to another brokerage account from here.
 */
export function HoldingDetail({ account }: {
  account: Account
}) {
  const t = useTranslations("securities.holding");
  const securityId = useHoldingSecurity();
  const detailQuery = useBrokerageHolding(account.id, securityId);
  const accounts = useAccounts();
  const locale = useLocale();
  const [booking, setBooking] = useState<string | null>(null);
  const [transferring, setTransferring] = useState<Holding | null>(null);
  const [editing, setEditing] = useState<Trade | null>(null);

  if (detailQuery.isError) {
    return (
      <section className={ui["panel"]}>
        <FormError failure={toFailure(detailQuery.error)} />
      </section>
    );
  }

  if (detailQuery.isPending) {
    return (
      <section className={ui["panel"]} aria-busy="true">
        <HoldingsTableSkeleton rows={1} />
      </section>
    );
  }

  const {
    security,
    holding,
    trades,
    prices,
    currency
  } = detailQuery.data;
  const held = holding.quantity_micros > 0;
  const brokerageAccounts = (accounts.data ?? []).filter(item => item.kind === "brokerage");
  // Per-share figures of one holding share their decimals, including every stored close, so no close is rounded; the average cost and a transfer's carried cost per share are rounded to them.
  const digits = priceDigits([...trades.filter(trade => !trade.transfer).map(trade => trade.price_micros), ...prices.map(price => price.close_micros)], currency);
  const tradesId = `${securityId}-trades`;

  return (
    <div className={detail["detail"]}>
      <section className={ui["panel"]} aria-label={t("position")}>
        <HoldingsTable
          label={t("position")}
          holdings={[holding]}
          trades={trades}
          securities={[security]}
          currency={currency}
          priceDigits={digits}
        />
      </section>
      <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={tradesId}>
        <div className={detail["panel-heading"]}>
          <h2 id={tradesId}>{t("trades")}</h2>
          {held && account.archived_at === null && (
            <button type="button" className={clsx(ui["button"], ui["small"])} onClick={() => setTransferring(holding)}>
              <ArrowRightLeft size={14} aria-hidden="true" /> {t("transferAction")}
            </button>
          )}
        </div>
        <TradesTable
          label={t("trades")}
          trades={trades}
          locale={locale}
          digits={digits}
          openBooking={setBooking}
          openTransfer={setEditing}
        />
      </section>
      <PriceHistoryPanel
        title={t("prices")}
        prices={prices}
        currency={currency}
        digits={digits}
      />
      {booking && <BookingDialog transactionId={booking} depotId={account.id} close={() => setBooking(null)} />}
      {transferring && (
        <TransferDialog
          account={account}
          holding={transferring}
          brokerageAccounts={brokerageAccounts}
          close={() => setTransferring(null)}
        />
      )}
      {editing && <TransferEditDialog trade={editing} accountName={account.name} close={() => setEditing(null)} />}
    </div>
  );
}

/** The holding's buys, sells and transfers in the holdings table's columns. */
function TradesTable({
  label,
  trades,
  locale,
  digits,
  openBooking,
  openTransfer
}: {
  label: string;
  trades: Trade[];
  locale: string;
  digits: number;
  openBooking: (transactionId: string) => void;
  openTransfer: (trade: Trade) => void;
}) {
  const t = useTranslations("securities.holdings.columns");

  return (
    <div className={styles["table"]} role="table" aria-label={label}>
      <div className={clsx(styles["row"], styles["head"])} role="row">
        <span role="columnheader">{t("trade")}</span>
        <span role="columnheader" className={styles["number"]}>{t("shares")}</span>
        <span role="columnheader" className={styles["number"]} />
        <span role="columnheader" className={styles["number"]}>{t("costBasis")}</span>
        <span role="columnheader" className={styles["number"]}>{t("price")}</span>
        <span role="columnheader" className={styles["number"]}>{t("proceeds")}</span>
        <span role="columnheader" className={styles["number"]}>{t("realizedGain")}</span>
      </div>
      {trades.map(trade => trade.transfer ? (
        <TransferRow
          key={`${trade.id}-${trade.side}`}
          trade={trade}
          locale={locale}
          digits={digits}
          openTransfer={openTransfer}
        />
      ) : (
        <TradeRow
          key={trade.id}
          trade={trade}
          locale={locale}
          digits={digits}
          openBooking={openBooking}
        />
      ))}
    </div>
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
    <div className={clsx(styles["row"], detail["trade"])} role="row">
      <span role="rowheader" className={styles["security"]}>
        {settlementId ? (
          <button
            type="button"
            className={detail["open-trade"]}
            onClick={() => openBooking(settlementId)}
            aria-label={openLabel}
          >
            <strong>{side}</strong>
          </button>
        ) : <strong>{side}</strong>}
        {settlement && <small className={detail["settlement"]}>{settlement}</small>}
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
      <span role="cell" className={clsx(styles["number"], trade.realized_minor === null && styles["empty"], trade.realized_minor !== null && trade.realized_minor > 0 && ui["positive"], trade.realized_minor !== null && trade.realized_minor < 0 && ui["negative"])} data-label={t("columns.realizedGain")}>
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

/** One leg of a transfer in its holding's columns: the shares and cost basis it moved, and that cost per share. */
function TransferRow({
  trade,
  locale,
  digits,
  openTransfer
}: {
  trade: Trade;
  locale: string;
  digits: number;
  openTransfer?: (trade: Trade) => void;
}) {
  const t = useTranslations("securities.holdings");
  const received = trade.side === "transfer_in";
  const direction = received ? "in" : "out";
  const label = t("transferSide", {
    direction
  });
  const date = dateWithYear(Temporal.PlainDate.from(trade.date), locale);
  const quantity = formatQuantity(trade.quantity_micros, locale);
  const counterpart = t("transferCounterpart", {
    direction,
    account: trade.transfer?.counterpart_account_name ?? t("anotherAccount")
  });

  return (
    <div className={clsx(styles["row"], detail["trade"])} role="row">
      <span role="rowheader" className={styles["security"]}>
        {openTransfer ? (
          <button
            type="button"
            className={detail["open-trade"]}
            onClick={() => openTransfer(trade)}
            aria-label={t("openTransfer", {
              direction,
              quantity,
              date,
              counterpart
            })}
          >
            <strong>{label}</strong>
          </button>
        ) : <strong>{label}</strong>}
        <small className={detail["settlement"]}>{counterpart}</small>
      </span>
      <span role="cell" className={styles["number"]} data-label={t("columns.shares")}>{received ? quantity : `−${quantity}`}</span>
      <span role="cell" className={clsx(styles["number"], styles["empty"])} data-label={t("columns.averageCost")} />
      <span role="cell" className={styles["number"]} data-label={t("columns.costBasis")}>
        {money(trade.gross_minor, trade.currency, locale)}
        <small>{t("transferCost", {
          direction
        })}</small>
      </span>
      <span role="cell" className={styles["number"]} data-label={t("columns.costPerShare")}>
        {formatPrice(trade.price_micros, trade.currency, locale, digits)}
        <small>{date}</small>
      </span>
      <span role="cell" className={clsx(styles["number"], styles["empty"])} data-label={t("columns.proceeds")} />
      <span role="cell" className={clsx(styles["number"], styles["empty"])} data-label={t("columns.realizedGain")} />
    </div>
  );
}
