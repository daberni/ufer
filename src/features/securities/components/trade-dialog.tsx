"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./trade-dialog.module.css";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("securities.tradeForm");

  return (
    <Dialog eyebrow={t("eyebrow")} title={props.booking ? t("fromBookingTitle") : t("addTitle")} onClose={props.close}>
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
  const t = useTranslations("securities.tradeForm");
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
  let cashHint = t("enterSharesAndPrice");

  if (cash !== null && difference !== null && difference !== 0) {
    cashHint = t("cashAmountDiffers", {
      amount: signedMoney(cash, currency, locale),
      difference: money(Math.abs(difference), currency, locale)
    });
  } else if (cash !== null) {
    cashHint = t("cashAmount", {
      amount: signedMoney(cash, currency, locale)
    });
  }

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
    return <p className={ui["form-description"]}>{t("noBrokerageAccount")}</p>;
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
          {t("brokerageAccount")}
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
          {t("isin")}
          <input
            name="isin"
            required
            defaultValue={isin}
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            pattern="[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]"
            autoFocus={Boolean(accountId)}
            onInput={event => {
              const problem = isinProblem(event.currentTarget.value);

              event.currentTarget.setCustomValidity(problem ? t(problem) : "");
            }}
          />
        </label>
        <label>
          {t("trade")}
          <Select value={side} onChange={event => setSide(event.target.value as TradeSide)}>
            <option value="buy">{t("buy")}</option>
            <option value="sell">{t("sell")}</option>
          </Select>
        </label>
        <label>
          {t("shares")}
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
          {t("pricePerShare", {
            currency
          })}
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
          {t("feesOptional")}
          <input
            name="fee"
            inputMode="decimal"
            value={fee}
            onChange={event => setFee(event.target.value)}
            placeholder="0.00"
          />
        </label>
        <label>
          {t("taxesOptional")}
          <input
            name="tax"
            inputMode="decimal"
            value={tax}
            onChange={event => setTax(event.target.value)}
            placeholder="0.00"
          />
        </label>
        <label>
          {t("date")}
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
            {t("cashAccount")}
            <Select name="settlement_account_id" required>
              {settlementChoices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
        )}
      </div>
      <label>
        {t("nameOptional")}
        <input name="name" maxLength={200} placeholder={t("namePlaceholder")} />
      </label>
      <p className={ui["form-hint"]} aria-live="polite">
        {cashHint}
      </p>
      {!booking && !settlementChoices.length && (
        <p className={ui["form-hint"]}>{t("noCashAccount", {
          currency
        })}</p>
      )}
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || (!booking && !settlementChoices.length) || (difference !== null && difference !== 0)}>
        {t("submit")} <Check size={16} />
      </button>
    </form>
  );
}

/** The message key for why the browser should refuse an ISIN as typed: the full code must carry a matching check digit, so a typo is caught before the trade is sent. */
function isinProblem(value: string): "isinCheckDigit" | "isinLength" | null {
  const code = value.trim().toUpperCase();

  if (!code || validIsin(code)) {
    return null;
  }

  return code.length === 12 ? "isinCheckDigit" : "isinLength";
}

/** The signed cash movement the entered values produce, or null while they are incomplete or invalid. */
export function cashPreview(side: TradeSide, quantity: string, price: string, fee: string, tax: string, currency: string, grossAmount?: string) {
  try {
    const computed = amountMinor(parseMicros(quantity, "quantity"), parseMicros(price, "price"), currency);
    const gross = grossAmount === undefined ? computed : minorUnits(grossAmount, currency);

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
