"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./booking-trade.module.css";

import { useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { ArrowRight, Check, Pencil, Trash2, Unlink } from "lucide-react";
import { FormError } from "@/components/ui/form-error";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { useAccountHref } from "@/client/use-app-url";
import { dateWithYear } from "@/lib/date-format";
import { decimalAmount, minorUnits, money, signedMoney } from "@/lib/money";
import { today } from "@/lib/time";
import type { Transaction, BookingTrade } from "@/features/transactions/types";
import { useCorrectTrade, useDeleteTrade } from "../mutations";
import { amountMinor } from "../holdings";
import { parseMicros } from "../quantities";
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
  depotId,
  close
}: {
  transaction: Transaction;
  trade: BookingTrade;
  /** The depot whose page opened the panel; its own link is then left out. */
  depotId?: string;
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
      showDepot={trade.account_id !== depotId}
      edit={() => setStep("edit")}
      remove={() => setStep("remove")}
    />
  );
}

/** The settlement booking as one compact row: where and when the cash moved, and how much. The trade itself is described by the dialog title. */
function CashBooking({ transaction }: {
  transaction: Transaction
}) {
  const locale = useLocale();

  return (
    <section className={styles["booking"]} aria-labelledby={`${transaction.id}-cash`}>
      <h3 id={`${transaction.id}-cash`} className={styles["section-title"]}>Cash booking</h3>
      <div className={styles["booking-main"]}>
        <span className={styles["booking-text"]}>
          <strong>{transaction.account_name}</strong>
          <small>{dateWithYear(Temporal.PlainDate.from(transaction.date), locale)}</small>
        </span>
        <strong className={clsx(styles["amount"], transaction.amount_minor > 0 && ui["positive"])}>{signedMoney(transaction.amount_minor, transaction.currency, locale)}</strong>
      </div>
    </section>
  );
}

function TradeSummary({
  transaction,
  trade,
  showDepot,
  edit,
  remove
}: {
  transaction: Transaction;
  trade: BookingTrade;
  showDepot: boolean;
  edit: () => void;
  remove: () => void;
}) {
  const locale = useLocale();
  const accountHref = useAccountHref();
  const frozen = transaction.account_archived || trade.account_archived;
  const currency = transaction.currency;

  return (
    <div className={ui["form"]}>
      <CashBooking transaction={transaction} />
      <section aria-labelledby={`${trade.id}-trade`}>
        <h3 id={`${trade.id}-trade`} className={styles["section-title"]}>Trade</h3>
        <dl className={styles["facts"]}>
          {trade.security_isin && (
            <>
              <dt>ISIN</dt>
              <dd>{trade.security_isin}</dd>
            </>
          )}
          {showDepot && (
            <>
              <dt>Depot</dt>
              <dd>
                <Link className={ui["text-button"]} href={accountHref(trade.account_id)}>
                  {trade.account_name} <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </dd>
            </>
          )}
          <dt>Trade date</dt>
          <dd>{dateWithYear(Temporal.PlainDate.from(trade.date), locale)}</dd>
          <dt>Shares</dt>
          <dd>{formatQuantity(trade.quantity_micros, locale)}</dd>
          <dt>Price per share</dt>
          <dd>{formatPrice(trade.price_micros, currency, locale)}</dd>
          <dt>Traded amount</dt>
          <dd>{money(trade.gross_minor, currency, locale)}</dd>
          {trade.fee_minor > 0 && (
            <>
              <dt>Fees</dt>
              <dd>{trade.side === "buy" ? "+" : "−"} {money(trade.fee_minor, currency, locale)}</dd>
            </>
          )}
          {trade.tax_minor > 0 && (
            <>
              <dt>Taxes</dt>
              <dd>{trade.side === "buy" ? "+" : "−"} {money(trade.tax_minor, currency, locale)}</dd>
            </>
          )}
          <dt className={styles["total"]}>Cash amount</dt>
          <dd className={styles["total"]}>{signedMoney(transaction.amount_minor, currency, locale)}</dd>
        </dl>
      </section>
      {frozen ? <p className={ui["form-hint"]}>This account is archived; restore it to change the trade.</p> : (
        <div className={ui["button-group"]}>
          <button type="button" className={ui["button"]} onClick={edit}>
            <Pencil size={15} aria-hidden="true" />
            Edit trade
          </button>
          <button type="button" className={ui["button"]} onClick={remove}>
            {trade.entry_owned ? <Trash2 size={15} aria-hidden="true" /> : <Unlink size={15} aria-hidden="true" />}
            {trade.entry_owned ? "Delete trade" : "Unlink trade"}
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
  const [ownFee, setFee] = useState(trade.fee_minor ? decimalAmount(trade.fee_minor, currency) : "");
  const [tax, setTax] = useState(trade.tax_minor ? decimalAmount(trade.tax_minor, currency) : "");
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useCorrectTrade(), close);
  // A recorded gross can differ from shares × price through broker rounding; it is kept until shares or price change.
  const keepGross = quantity === microsText(trade.quantity_micros) && price === microsText(trade.price_micros);
  const gross = keepGross ? decimalAmount(trade.gross_minor, currency) : undefined;
  // A trade on an imported booking must keep matching it, so its fees are what remains of the booking amount; a trade's own cash entry follows the correction.
  const imported = !trade.entry_owned;
  const derivedFee = imported ? remainingFee(trade.side, transaction.amount_minor, quantity, price, tax, currency, gross) : null;
  const mismatch = imported && (derivedFee === null || derivedFee < 0);
  const derivedText = derivedFee !== null && !mismatch ? decimalAmount(derivedFee, currency) : "";
  const fee = imported ? derivedText : ownFee;
  const cash = cashPreview(trade.side, quantity, price, fee, tax, currency, gross);

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
      <CashBooking transaction={transaction} />
      <h3 className={styles["section-title"]}>Correct trade</h3>
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
          Taxes (optional)
          <input
            name="tax"
            inputMode="decimal"
            value={tax}
            onChange={event => setTax(event.target.value)}
            placeholder="0.00"
          />
        </label>
        {imported ? (
          <label>
            Fees (from the booking)
            <input
              name="fee"
              value={fee}
              readOnly
              aria-describedby={`${trade.id}-fee-hint`}
            />
          </label>
        ) : (
          <label>
            Fees (optional)
            <input
              name="fee"
              inputMode="decimal"
              value={ownFee}
              onChange={event => setFee(event.target.value)}
              placeholder="0.00"
            />
          </label>
        )}
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
      <p id={`${trade.id}-fee-hint`} className={ui["form-hint"]} aria-live="polite">
        {correctionHint({
          imported,
          mismatch,
          cash,
          side: trade.side,
          bookingMinor: transaction.amount_minor,
          hasTax: Boolean(tax.trim()),
          currency,
          locale
        })}
      </p>
      <FormError failure={error} />
      <div className={ui["button-group"]}>
        <button
          type="button"
          className={ui["button"]}
          onClick={cancel}
          disabled={pending}
        >Back</button>
        <button className={clsx(ui["button"], ui["primary"])} disabled={pending || cash === null || mismatch}>
          Save trade <Check size={16} />
        </button>
      </div>
    </form>
  );
}

function correctionHint({ imported, mismatch, cash, side, bookingMinor, hasTax, currency, locale }: {
  imported: boolean;
  mismatch: boolean;
  cash: number | null;
  side: BookingTrade["side"];
  bookingMinor: number;
  hasTax: boolean;
  currency: string;
  locale: string;
}) {
  if (!imported) {
    return cash === null ? "Enter shares and price to see the cash amount." : `Cash amount ${signedMoney(cash, currency, locale)}`;
  }

  if (mismatch) {
    const booking = money(Math.abs(bookingMinor), currency, locale);

    // A buy's cost grows with fees, a sale's proceeds shrink by them, so a negative remainder means opposite things.
    return side === "buy"
      ? `Shares × price${hasTax ? " and taxes" : ""} exceed the booking amount of ${booking}; check them.`
      : `Shares × price${hasTax ? " less taxes" : ""} fall short of the booking amount of ${booking}; check them.`;
  }

  return `The trade stays equal to the booking amount of ${signedMoney(bookingMinor, currency, locale)}; fees are the remainder.`;
}

/** The fee that makes a trade's cash equal a booking's amount, or null while shares, price or taxes are incomplete. Negative when the trade alone already exceeds the booking. */
function remainingFee(side: BookingTrade["side"], bookingMinor: number, quantity: string, price: string, tax: string, currency: string, grossAmount?: string) {
  try {
    const gross = grossAmount === undefined ? amountMinor(parseMicros(quantity, "quantity"), parseMicros(price, "price"), currency) : minorUnits(grossAmount, currency);
    const taxes = tax.trim() ? minorUnits(tax, currency) : 0;

    return (side === "buy" ? -bookingMinor - gross : gross - bookingMinor) - taxes;
  } catch {
    return null;
  }
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
  const action = trade.entry_owned ? "Delete trade" : "Unlink trade";

  return (
    <div className={ui["form"]}>
      <h3 className={styles["section-title"]}>{action}?</h3>
      <ul className={styles["consequences"]}>
        <li>The {trade.side === "buy" ? "buy" : "sell"} of {trade.security_name} is removed from {trade.account_name}, and its holdings and gains are recalculated.</li>
        <li>{trade.entry_owned ? "This cash booking was entered for the trade and is deleted with it." : "The cash booking stays on its account with its amount and becomes an ordinary booking again. A type you had set before is not restored."}</li>
        <li>You can record the trade again later{trade.entry_owned ? "" : " from the same booking"}.</li>
      </ul>
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
          {trade.entry_owned ? "Delete trade and booking" : "Unlink trade, keep booking"}
        </button>
      </div>
    </div>
  );
}
