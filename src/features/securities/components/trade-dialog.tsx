"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./trade-dialog.module.css";

import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import { dateWithYear } from "@/lib/date-format";
import { clsx } from "clsx";
import { Check } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { useLocale } from "@/client/locale-provider";
import { minorUnits, money, signedMoney } from "@/lib/money";
import { today } from "@/lib/time";
import type { Account } from "@/features/accounts/types";
import { amountMinor } from "../holdings";
import { findIsin, validIsin } from "../isin";
import { parseMicros } from "../quantities";
import { tradeCashAmount } from "../trade-decisions";
import type { TradeSide } from "../trade-sides";
import { useRecordTrade, type TradeRequest } from "../mutations";

/** An imported bank booking a trade is recorded from; it becomes the trade's cash side. */
export type TradeBooking = {
  id: string;
  date: string;
  amount_minor: number;
  currency: string;
  text: string;
  account_name: string;
};

export type TradeFormProps = {
  /** Active brokerage accounts the trade can be recorded on. */
  brokerageAccounts: Account[];
  /** Records on this brokerage account; without it, the form offers a choice. */
  accountId?: string;
  /** Active manual accounts that can carry the cash side when no booking is given. */
  settlementAccounts: Account[];
  booking?: TradeBooking;
  close: () => void;
};

/**
 * Records a buy or sale: ISIN, shares, price and date, with fees and taxes kept apart. Started from a bank booking, it takes the ISIN from the booking text and the date and cash amount from the booking, which becomes the trade's cash side.
 * The price listing is chosen automatically when the security is new (ADR 012); there is no listing field.
 */
export function TradeDialog(props: TradeFormProps) {
  return (
    <Dialog eyebrow="BROKERAGE" title={props.booking ? "Record trade from booking" : "Add trade"} onClose={props.close}>
      <TradeForm {...props} />
    </Dialog>
  );
}

/** The trade fields without their dialog, so the transaction dialog can show them as a step. */
export function TradeForm({
  brokerageAccounts,
  accountId,
  settlementAccounts,
  booking,
  close
}: TradeFormProps) {
  const locale = useLocale();
  const [chosenAccountId, setAccountId] = useState(accountId ?? brokerageAccounts.find(account => !booking || account.currency === booking.currency)?.id ?? "");
  const account = brokerageAccounts.find(item => item.id === chosenAccountId);
  const currency = account?.currency ?? booking?.currency ?? "EUR";
  const [side, setSide] = useState<TradeSide>(booking && booking.amount_minor > 0 ? "sell" : "buy");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [tax, setTax] = useState("");
  const settlementChoices = settlementAccounts.filter(item => item.currency === currency);
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useRecordTrade(), close);
  const cash = cashPreview(side, quantity, price, fee, tax, currency);
  const difference = booking && cash !== null ? booking.amount_minor - cash : null;
  const isin = booking ? findIsin(booking.text) ?? "" : "";

  function request(data: FormData): TradeRequest {
    const name = String(data.get("name") ?? "").trim();

    return {
      accountId: chosenAccountId,
      isin: String(data.get("isin")).trim().toUpperCase(),
      name: name || undefined,
      currency,
      date: String(data.get("date")),
      side,
      quantity,
      price,
      fee: fee.trim() || "0",
      tax: tax.trim() || "0",
      settlement: booking ? {
        transaction_id: booking.id
      } : {
        account_id: String(data.get("settlement_account_id"))
      }
    };
  }

  if (!brokerageAccounts.length) {
    return <p className={ui["form-description"]}>Add a brokerage account first; trades are recorded on it.</p>;
  }

  return (
    <form className={ui["form"]} onSubmit={event => submit(event, request)}>
      {booking && (
        <p className={ui["form-description"]}>
          {booking.account_name} · {dateWithYear(Temporal.PlainDate.from(booking.date), locale)} · <strong>{signedMoney(booking.amount_minor, booking.currency, locale)}</strong>
          <span className={styles["booking-text"]}>{booking.text}</span>
        </p>
      )}
      {!accountId && (
        <label>
          Brokerage account
          <Select
            value={chosenAccountId}
            onChange={event => setAccountId(event.target.value)}
            required
            autoFocus
          >
            {brokerageAccounts.map(item => <option key={item.id} value={item.id}>{item.name} ({item.currency})</option>)}
          </Select>
        </label>
      )}
      <div className={styles["grid"]}>
        <label>
          ISIN
          <input
            name="isin"
            required
            defaultValue={isin}
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            pattern="[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]"
            autoFocus={Boolean(accountId)}
            onInput={event => event.currentTarget.setCustomValidity(isinProblem(event.currentTarget.value))}
          />
        </label>
        <label>
          Trade
          <Select value={side} onChange={event => setSide(event.target.value as TradeSide)}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </Select>
        </label>
        <label>
          Shares
          <input
            name="quantity"
            required
            inputMode="decimal"
            value={quantity}
            onChange={event => setQuantity(event.target.value)}
            placeholder="10"
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
            placeholder="100.00"
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
          Date
          <input
            name="date"
            type="date"
            required
            defaultValue={booking?.date ?? today().toString()}
            max={today().toString()}
          />
        </label>
        {!booking && (
          <label>
            Cash account
            <Select name="settlement_account_id" required>
              {settlementChoices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
        )}
      </div>
      <label>
        Name (optional)
        <input name="name" maxLength={200} placeholder="Used when no price listing is found" />
      </label>
      <p className={ui["form-hint"]} aria-live="polite">
        {cash === null ? "Enter shares and price to see the cash amount." : `Cash amount ${signedMoney(cash, currency, locale)}`}
        {difference !== null && difference !== 0 && ` · differs from the booking by ${money(Math.abs(difference), currency, locale)}; adjust fees or taxes`}
      </p>
      {!booking && !settlementChoices.length && <p className={ui["form-hint"]}>Add a manual {currency} account for the cash, or record the trade from its bank booking.</p>}
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || (!booking && !settlementChoices.length) || (difference !== null && difference !== 0)}>
        Record trade <Check size={16} />
      </button>
    </form>
  );
}

/** Why the browser should refuse an ISIN as typed: the full code must carry a matching check digit, so a typo is caught before the trade is sent. */
function isinProblem(value: string) {
  const code = value.trim().toUpperCase();

  if (!code || validIsin(code)) {
    return "";
  }

  return code.length === 12 ? "This ISIN's check digit does not match; check it for typos." : "Enter a 12-character ISIN.";
}

/** The signed cash movement the entered values produce, or null while they are incomplete or invalid. */
function cashPreview(side: TradeSide, quantity: string, price: string, fee: string, tax: string, currency: string) {
  try {
    const gross = amountMinor(parseMicros(quantity, "quantity"), parseMicros(price, "price"), currency);

    return tradeCashAmount({
      side,
      gross_minor: gross,
      fee_minor: fee.trim() ? minorUnits(fee, currency) : 0,
      tax_minor: tax.trim() ? minorUnits(tax, currency) : 0
    });
  } catch {
    return null;
  }
}
