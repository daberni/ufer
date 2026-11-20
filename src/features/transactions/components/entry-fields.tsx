"use client";

import ui from "../../../components/ui/primitives.module.css";

import { PayeeInput } from "./payee-input";
import { today } from "@/lib/time";
import type { TransactionType } from "@/features/transactions/transaction-types";

/** The values an entry form starts with; the amount as a signed decimal. */
export type EntryDefaults = {
  booking_date: string;
  amount: string;
  counterparty: string;
  description: string;
};

type Props = {
  defaults?: EntryDefaults;
  /** Shows the payee field; a transfer between manual accounts names the other account instead. */
  payee: boolean;
  /** The account whose linked booking fixes the date and amount; they are then read-only. */
  followedAccount?: string;
  onAmount: (amount: string) => void;
};

/** The type an amount suggests until the person chooses one: money in is income, money out an expense. */
export function suggestedType(amount: string): TransactionType | null {
  const value = amount.trim();

  if (value.startsWith("-")) {
    return "expense";
  }

  return Number(value) > 0 ? "income" : null;
}

/** Date, amount, payee and description of a transaction entered in Ufer; submitted with the surrounding form. */
export function EntryFields({
  defaults,
  payee,
  followedAccount,
  onAmount
}: Props) {
  const latestDate = today().toString();
  const locked = followedAccount !== undefined;

  return (
    <>
      <div className={ui["form-grid"]}>
        <label>
          Date
          <input
            name="booking_date"
            type="date"
            required
            readOnly={locked}
            defaultValue={defaults?.booking_date ?? latestDate}
            max={latestDate}
          />
        </label>
        <label>
          Amount
          <input
            name="amount"
            required
            readOnly={locked}
            inputMode="decimal"
            pattern="[+\-]?[0-9]+([.][0-9]+)?"
            placeholder="-12.50"
            defaultValue={defaults?.amount}
            onChange={event => onAmount(event.target.value)}
          />
        </label>
      </div>
      <p className={ui["form-hint"]}>{locked ? `The date and amount follow the linked booking on ${followedAccount}.` : "Enter money leaving the account as a negative amount."}</p>
      {payee && (
        <PayeeInput
          label="Payee"
          name="counterparty"
          maxLength={500}
          defaultValue={defaults?.counterparty}
        />
      )}
      <label>
        Description
        <input
          name="description"
          maxLength={2000}
          defaultValue={defaults?.description}
        />
      </label>
    </>
  );
}
