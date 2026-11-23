"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./booking-trade.module.css";

import { useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { ArrowRight, Check, Pencil, Unlink } from "lucide-react";
import { FormError } from "@/components/ui/form-error";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { useAccountHref } from "@/client/use-app-url";
import { dateWithYear } from "@/lib/date-format";
import { decimalAmount, money, signedMoney } from "@/lib/money";
import { today } from "@/lib/time";
import type { Transaction, BookingTrade } from "@/features/transactions/types";
import { useCorrectTrade, useDeleteTrade } from "../mutations";
import { cashPreview } from "./trade-dialog";
import { formatPrice, formatQuantity } from "./holding-format";

type Step = "view" | "edit" | "remove";

/** A micro-unit value as exact decimal text for editing, without floating-point division. */
function microsText(micros: number) {
  const whole = Math.trunc(micros / 1_000_000);
  const fraction = String(micros % 1_000_000).padStart(6, "0").replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * A booking that is a trade's cash side: the trade with a link to its brokerage account, and the only place it is corrected or removed (ADR 012).
 */
export function BookingTradePanel({
  transaction,
  trade,
  close
}: {
  transaction: Transaction;
  trade: BookingTrade;
  close: () => void;
}) {
  const [step, setStep] = useState<Step>("view");

  if (step === "edit") {
    return (
      <TradeCorrectionForm
        transaction={transaction}
        trade={trade}
        close={close}
        cancel={() => setStep("view")}
      />
    );
  }

  if (step === "remove") {
    return (
      <RemoveTrade
        trade={trade}
        close={close}
        cancel={() => setStep("view")}
      />
    );
  }

  return (
    <TradeSummary
      transaction={transaction}
      trade={trade}
      edit={() => setStep("edit")}
      remove={() => setStep("remove")}
    />
  );
}

function TradeSummary({
  transaction,
  trade,
  edit,
  remove
}: {
  transaction: Transaction;
  trade: BookingTrade;
  edit: () => void;
  remove: () => void;
}) {
  const locale = useLocale();
  const accountHref = useAccountHref();
  const frozen = transaction.account_archived || trade.account_archived;

  return (
    <div className={ui["form"]}>
      <p className={ui["form-description"]}>
        {transaction.account_name} · {dateWithYear(Temporal.PlainDate.from(transaction.date), locale)} · <strong>{signedMoney(transaction.amount_minor, transaction.currency, locale)}</strong>
      </p>
      <dl className={styles["facts"]}>
        <dt>Trade</dt>
        <dd>{trade.side === "buy" ? "Buy" : "Sale"} of {trade.security_name}{trade.security_isin && trade.security_isin !== trade.security_name ? ` (${trade.security_isin})` : ""}</dd>
        <dt>Trade date</dt>
        <dd>{dateWithYear(Temporal.PlainDate.from(trade.date), locale)}</dd>
        <dt>Shares</dt>
        <dd>{formatQuantity(trade.quantity_micros, locale)}</dd>
        <dt>Price per share</dt>
        <dd>{formatPrice(trade.price_micros, transaction.currency, locale)}</dd>
        <dt>Traded amount</dt>
        <dd>{money(trade.gross_minor, transaction.currency, locale)}</dd>
        {trade.fee_minor > 0 && (
          <>
            <dt>Fees</dt>
            <dd>{money(trade.fee_minor, transaction.currency, locale)}</dd>
          </>
        )}
        {trade.tax_minor > 0 && (
          <>
            <dt>Taxes</dt>
            <dd>{money(trade.tax_minor, transaction.currency, locale)}</dd>
          </>
        )}
      </dl>
      <Link className={clsx(ui["text-button"], styles["depot-link"])} href={accountHref(trade.account_id)}>
        Open {trade.account_name} <ArrowRight size={15} />
      </Link>
      {frozen ? <p className={ui["form-hint"]}>This account is archived; restore it to change the trade.</p> : (
        <div className={ui["button-group"]}>
          <button type="button" className={ui["button"]} onClick={edit}>
            <Pencil size={15} />
            Edit trade
          </button>
          <button type="button" className={ui["button"]} onClick={remove}>
            <Unlink size={15} />
            Remove trade
          </button>
        </div>
      )}
    </div>
  );
}

function TradeCorrectionForm({
  transaction,
  trade,
  close,
  cancel
}: {
  transaction: Transaction;
  trade: BookingTrade;
  close: () => void;
  cancel: () => void;
}) {
  const locale = useLocale();
  const currency = transaction.currency;
  const [quantity, setQuantity] = useState(microsText(trade.quantity_micros));
  const [price, setPrice] = useState(microsText(trade.price_micros));
  const [fee, setFee] = useState(trade.fee_minor ? decimalAmount(trade.fee_minor, currency) : "");
  const [tax, setTax] = useState(trade.tax_minor ? decimalAmount(trade.tax_minor, currency) : "");
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useCorrectTrade(), close);
  // A recorded gross can differ from shares × price through broker rounding; it is kept until shares or price change.
  const keepGross = quantity === microsText(trade.quantity_micros) && price === microsText(trade.price_micros);
  const gross = keepGross ? decimalAmount(trade.gross_minor, currency) : undefined;
  const cash = cashPreview(trade.side, quantity, price, fee, tax, currency, gross);
  // A trade on an imported booking must keep matching it; a trade's own cash entry follows the correction.
  const imported = !trade.entry_owned;
  const difference = imported && cash !== null ? transaction.amount_minor - cash : null;

  return (
    <form
      className={ui["form"]}
      onSubmit={event => submit(event, data => ({
        tradeId: trade.id,
        date: String(data.get("date")),
        quantity,
        price,
        gross,
        fee: fee.trim() || "0",
        tax: tax.trim() || "0"
      }))}
    >
      <p className={ui["form-description"]}>{trade.side === "buy" ? "Buy" : "Sale"} of {trade.security_name}</p>
      <div className={styles["grid"]}>
        <label>
          Shares
          <input
            name="quantity"
            required
            inputMode="decimal"
            value={quantity}
            onChange={event => setQuantity(event.target.value)}
            autoFocus
          />
        </label>
        <label>
          Price per share ({currency})
          <input
            name="price"
            required
            inputMode="decimal"
            value={price}
            onChange={event => setPrice(event.target.value)}
          />
        </label>
        <label>
          Fees (optional)
          <input
            name="fee"
            inputMode="decimal"
            value={fee}
            onChange={event => setFee(event.target.value)}
            placeholder="0.00"
          />
        </label>
        <label>
          Taxes (optional)
          <input
            name="tax"
            inputMode="decimal"
            value={tax}
            onChange={event => setTax(event.target.value)}
            placeholder="0.00"
          />
        </label>
        <label>
          Trade date
          <input
            name="date"
            type="date"
            required
            defaultValue={trade.date}
            max={today().toString()}
          />
        </label>
      </div>
      <p className={ui["form-hint"]} aria-live="polite">
        {cash === null ? "Enter shares and price to see the cash amount." : `Cash amount ${signedMoney(cash, currency, locale)}`}
        {difference !== null && difference !== 0 && ` · differs from the booking by ${money(Math.abs(difference), currency, locale)}; adjust fees or taxes`}
      </p>
      <FormError failure={error} />
      <div className={ui["button-group"]}>
        <button
          type="button"
          className={ui["button"]}
          onClick={cancel}
          disabled={pending}
        >Back</button>
        <button className={clsx(ui["button"], ui["primary"])} disabled={pending || cash === null || (difference !== null && difference !== 0)}>
          Save trade <Check size={16} />
        </button>
      </div>
    </form>
  );
}

function RemoveTrade({
  trade,
  close,
  cancel
}: {
  trade: BookingTrade;
  close: () => void;
  cancel: () => void;
}) {
  const remove = useDeleteTrade();

  return (
    <div className={ui["form"]}>
      <p className={ui["form-description"]}>
        The {trade.side === "buy" ? "buy" : "sale"} of {trade.security_name} is removed from {trade.account_name}.
        {trade.entry_owned ? " This booking was entered for the trade and is deleted with it." : " This booking stays and becomes an ordinary booking again; a type you had set before is not restored."}
      </p>
      <FormError failure={remove.error ? toFailure(remove.error) : null} />
      <div className={ui["button-group"]}>
        <button
          type="button"
          className={ui["button"]}
          onClick={cancel}
          disabled={remove.isPending}
        >Back</button>
        <button
          type="button"
          className={ui["danger-button"]}
          disabled={remove.isPending}
          onClick={() => remove.mutate(trade.id, {
            onSuccess: close
          })}
        >
          Remove trade
        </button>
      </div>
    </div>
  );
}
