"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./brokerage-panel.module.css";

import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import { dateWithYear } from "@/lib/date-format";
import { clsx } from "clsx";
import { Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty-state";
import { FormError } from "@/components/ui/form-error";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { money, signedMoney } from "@/lib/money";
import type { Account } from "@/features/accounts/types";
import { useBrokerageTrades, useSecurities } from "../queries";
import { useDeleteTrade } from "../mutations";
import type { Holding, Security, Trade } from "../types";
import { ListingDialog } from "./listing-dialog";

/** Display only: a micro-unit quantity as a localized number with up to six decimals. */
export function formatQuantity(micros: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 6
  }).format(micros / 1_000_000);
}

/** Display only: a micro-unit price in its currency with up to four decimals. */
function formatPrice(micros: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 4
  }).format(micros / 1_000_000);
}

/** A brokerage account's holdings with their value today and the trades they come from. */
export function BrokeragePanel({ account }: {
  account: Account
}) {
  const locale = useLocale();
  const trades = useBrokerageTrades(account.id);
  const securities = useSecurities();
  const [listingFor, setListingFor] = useState<Security | null>(null);
  const [deleting, setDeleting] = useState<Trade | null>(null);
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
  const held = valuation.holdings.filter(holding => holding.quantity_micros > 0);

  return (
    <>
      <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={`${account.id}-holdings`}>
        <h2 id={`${account.id}-holdings`}>Holdings</h2>
        {priceSource && !priceSource.configured && <p className={styles["notice"]}>{priceSource.message} Holdings are valued at their last known price or their cost.</p>}
        {held.length ? (
          <ul className={styles["list"]}>
            {held.map(holding => (
              <HoldingRow
                key={holding.security_id}
                holding={holding}
                security={byId.get(holding.security_id)}
                currency={account.currency}
                locale={locale}
                changeListing={account.archived_at === null ? setListingFor : undefined}
              />
            ))}
          </ul>
        ) : <Empty title="No holdings yet" illustration={null}>Record a buy, or start one from its booking on the cash account.</Empty>}
      </section>
      <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={`${account.id}-trades`}>
        <h2 id={`${account.id}-trades`}>Trades</h2>
        {trades.data.trades.length ? (
          <ul className={styles["list"]}>
            {trades.data.trades.toReversed().map(trade => (
              <li key={trade.id} className={styles["row"]}>
                <div className={styles["main"]}>
                  <strong>{trade.side === "buy" ? "Buy" : "Sell"} · {trade.security_name}</strong>
                  <span className={styles["meta"]}>{dateWithYear(Temporal.PlainDate.from(trade.date), locale)} · {formatQuantity(trade.quantity_micros, locale)} × {formatPrice(trade.price_micros, trade.currency, locale)}{trade.fee_minor ? ` · fees ${money(trade.fee_minor, trade.currency, locale)}` : ""}{trade.tax_minor ? ` · taxes ${money(trade.tax_minor, trade.currency, locale)}` : ""}</span>
                </div>
                <span className={styles["amount"]}>{money(trade.gross_minor, trade.currency, locale)}</span>
                {account.archived_at === null && (
                  <button
                    type="button"
                    className={ui["icon-button"]}
                    aria-label={`Delete ${trade.side === "buy" ? "buy" : "sale"} of ${trade.security_name} on ${trade.date}`}
                    title="Delete trade"
                    onClick={() => setDeleting(trade)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : <Empty title="No trades yet" illustration={null}>Trades you record appear here with their cash side.</Empty>}
      </section>
      {listingFor && <ListingDialog security={listingFor} close={() => setListingFor(null)} />}
      {deleting && <DeleteTradeDialog trade={deleting} close={() => setDeleting(null)} />}
    </>
  );
}

function HoldingRow({
  holding,
  security,
  currency,
  locale,
  changeListing
}: {
  holding: Holding;
  security: Security | undefined;
  currency: string;
  locale: string;
  changeListing?: (security: Security) => void;
}) {
  const gain = holding.value_minor - holding.cost_minor;
  const status = holdingStatus(holding, security, locale);

  return (
    <li className={styles["row"]}>
      <div className={styles["main"]}>
        <strong>{holding.security_name}</strong>
        <span className={styles["meta"]}>
          {formatQuantity(holding.quantity_micros, locale)} shares · cost <span className={styles["figure"]}>{money(holding.cost_minor, currency, locale)}</span>
          {holding.status !== "missing" && <> · gain <span className={styles["figure"]}>{signedMoney(gain, currency, locale)}</span></>}
        </span>
        {status && <span className={clsx(styles["status"], holding.status === "missing" && styles["warning"])}>{status}</span>}
      </div>
      <span className={styles["amount"]}>{money(holding.value_minor, currency, locale)}</span>
      {changeListing && security && (
        <button type="button" className={ui["text-button"]} onClick={() => changeListing(security)}>
          Price listing
        </button>
      )}
    </li>
  );
}

/** Why a holding's value is not a current market price, or which price it uses. */
function holdingStatus(holding: Holding, security: Security | undefined, locale: string) {
  if (holding.status === "missing") {
    return security?.price_error ? `No price: ${security.price_error} Valued at cost.` : "No price · valued at cost";
  }

  const priced = holding.price ? `Price of ${dateWithYear(Temporal.PlainDate.from(holding.price.date), locale)}${security?.provider_symbol ? ` (${security.provider_symbol})` : ""}` : null;

  if (holding.status === "stale") {
    return `${priced} · not updated recently`;
  }

  return security?.price_error ? `${priced} · ${security.price_error}` : priced;
}

function DeleteTradeDialog({
  trade,
  close
}: {
  trade: Trade;
  close: () => void;
}) {
  const remove = useDeleteTrade();

  return (
    <Dialog eyebrow="BROKERAGE" title="Delete trade" onClose={close}>
      <div className={ui["form"]}>
        <p className={ui["form-description"]}>
          The {trade.side === "buy" ? "buy" : "sale"} of {trade.security_name} on {dateWithYear(Temporal.PlainDate.from(trade.date), useLocale())} is removed. A booking entered for its cash is deleted with it; a linked bank booking stays and becomes an ordinary booking again.
        </p>
        <FormError failure={remove.error ? toFailure(remove.error) : null} />
        <button
          type="button"
          className={clsx(ui["danger-button"], ui["full-width"])}
          disabled={remove.isPending}
          onClick={() => remove.mutate(trade.id, {
            onSuccess: close
          })}
        >
          Delete trade
        </button>
      </div>
    </Dialog>
  );
}
