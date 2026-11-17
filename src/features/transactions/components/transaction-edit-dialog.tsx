"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useState } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { Check } from "lucide-react";
import styles from "./transaction-type.module.css";
import { toFailure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { describeDate } from "@/lib/date-format";
import { money } from "@/lib/money";
import { isTransactionType, manualAccountTypes, transactionTypeLabels, transactionTypes, type TransactionType } from "@/features/transactions/transaction-types";
import { useSaveTransaction, type TransactionEdit } from "@/features/transactions/mutations";
import { useTransferOptions } from "@/features/transactions/queries";
import type { Transaction, TransferBooking, TransferOptions } from "@/features/transactions/types";

type Props = {
  transaction: Transaction;
  close: () => void;
};

/** Where the transfer goes, as chosen in the form. */
type Target = {
  kind: "none";
} | {
  kind: "booking";
  booking: TransferBooking;
} | {
  kind: "account";
  accountId: string;
};

const noTarget: Target = {
  kind: "none"
};

function signedMoney(amount: number, currency: string) {
  return `${amount > 0 ? "+" : ""}${money(amount, currency)}`;
}

function bookingLabel(booking: TransferBooking) {
  const date = describeDate(Temporal.PlainDate.from(booking.booking_date)).label;
  const payee = booking.counterparty || booking.description;

  return [booking.account_name, date, signedMoney(booking.amount_minor, booking.currency), payee].filter(Boolean).join(" · ");
}

/** The stored target: the linked booking, or the manual account of a counterpart Ufer created there. */
function storedTarget(options: TransferOptions | undefined): Target {
  const counterpart = options?.counterpart;

  if (!counterpart) {
    return noTarget;
  }

  if (counterpart.created) {
    return {
      kind: "account",
      accountId: counterpart.account_id
    };
  }

  return {
    kind: "booking",
    booking: counterpart
  };
}

/** Suggested counterparts: the linked booking first, then unlinked bookings with the opposite amount. A counterpart Ufer created is chosen through its account instead. */
function suggestionsOf(options: TransferOptions | undefined) {
  if (!options) {
    return [];
  }

  const linked = options.counterpart && !options.counterpart.created ? [options.counterpart] : [];

  return [...linked, ...options.candidates];
}

function selectValue(target: Target) {
  if (target.kind === "booking") {
    return `booking:${target.booking.id}`;
  }

  return target.kind === "account" ? `account:${target.accountId}` : "";
}

function transferEdit(target: Target): TransactionEdit["transfer"] {
  if (target.kind === "booking") {
    return {
      counterpart_id: target.booking.id
    };
  }

  return target.kind === "account" ? {
    account_id: target.accountId
  } : null;
}

/** Edits a transaction's type and, for a transfer, where it goes; one Save stores both. */
export function TransactionEditDialog({
  transaction,
  close
}: Props) {
  const subject = transaction.counterparty || transaction.description || "Transaction";

  return (
    <Dialog eyebrow="TRANSACTION" title="Edit transaction" onClose={close}>
      <p className={ui["form-description"]}>
        {subject} · {transaction.account_name} · {signedMoney(transaction.amount_minor, transaction.currency)}
      </p>
      <TransactionEditForm transaction={transaction} close={close} />
    </Dialog>
  );
}

function TransactionEditForm({
  transaction,
  close
}: Props) {
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useSaveTransaction(transaction.id), close);
  const [type, setType] = useState<TransactionType>(transaction.type);
  const [chosenTarget, setTarget] = useState<Target>();
  const transfer = type === "transfer";
  const options = useTransferOptions(transaction.id, transfer);
  const target = chosenTarget ?? storedTarget(options.data);
  const available = transactionTypes.filter(option => transaction.manual_account || !manualAccountTypes.includes(option) || option === transaction.type);
  // Without loaded options, saving a transfer could drop a link the form cannot show.
  const targetUnknown = transfer && options.status !== "success";

  return (
    <form
      className={ui["form"]}
      onSubmit={event => submit(event, () => transfer ? {
        type,
        transfer: transferEdit(target)
      } : {
        type
      })}
    >
      <label>
        Type
        <Select
          name="type"
          value={type}
          onChange={event => {
            const value = event.target.value;

            if (isTransactionType(value)) {
              setType(value);
            }
          }}
        >
          {available.map(option => <option key={option} value={option}>{transactionTypeLabels[option]}</option>)}
        </Select>
      </label>
      <p className={ui["form-hint"]}>
        Income and expenses count toward cash flow and spending; transfers, opening balances and adjustments do not. A refund is an expense with a positive amount and reduces spending.
        {!transfer && transaction.counterpart && <LeaveTransferHint transaction={transaction} />}
      </p>
      {transfer && (
        <TransferFields
          transaction={transaction}
          options={options}
          target={target}
          onTarget={setTarget}
        />
      )}
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || targetUnknown}>
        Save <Check size={16} />
      </button>
    </form>
  );
}

function LeaveTransferHint({ transaction }: {
  transaction: Transaction
}) {
  const account = transaction.counterpart?.account_name;

  if (transaction.created_counterpart) {
    return ` Saving another type removes this booking, and the booking on ${account} becomes income or expense.`;
  }

  return ` Saving another type ends the link with ${account}, whose booking becomes income or expense.`;
}

/** A booking Ufer created on a manual account for another booking's transfer: it keeps that link or is removed; where the transfer goes is edited on the source booking. */
function CreatedCounterpartFields({
  source,
  target,
  onTarget
}: {
  source: TransferBooking;
  target: Target;
  onTarget: (target: Target) => void;
}) {
  const remove = target.kind === "none";

  return (
    <div className={styles["created"]}>
      <p className={ui["form-hint"]}>Ufer created this booking for the transfer of {bookingLabel(source)}. Change where the transfer goes on that booking.</p>
      <label className={styles["remove-option"]}>
        <input
          type="checkbox"
          name="remove"
          checked={remove}
          onChange={event => onTarget(event.target.checked ? noTarget : {
            kind: "booking",
            booking: source
          })}
        />
        Remove this booking
      </label>
      <p className={ui["form-hint"]} role="status">{remove ? `Save removes this booking; the booking on ${source.account_name} stays a transfer without a counterpart.` : `Save keeps this booking linked with ${source.account_name}.`}</p>
    </div>
  );
}

function targetSummary(transaction: Transaction, target: Target, accounts: TransferOptions["accounts"]) {
  const direction = transaction.amount_minor < 0 ? "to" : "from";

  if (target.kind === "booking") {
    return `Save links this booking with ${bookingLabel(target.booking)}.`;
  }

  if (target.kind === "account") {
    const account = accounts.find(item => item.id === target.accountId);

    return `Save books the counterpart on ${account?.name ?? "the manual account"}.`;
  }

  return `Without a target account this is a transfer ${direction} an account not tracked in Ufer.`;
}

function TransferFields({
  transaction,
  options,
  target,
  onTarget
}: {
  transaction: Transaction;
  options: ReturnType<typeof useTransferOptions>;
  target: Target;
  onTarget: (target: Target) => void;
}) {
  const suggestionsId = useId();
  const targetId = useId();

  if (options.status === "pending") {
    return <p className={ui["form-hint"]} role="status">Loading suggested counterparts …</p>;
  }

  if (options.status === "error") {
    return <FormError failure={toFailure(options.error)} />;
  }

  const source = options.data.counterpart;

  if (transaction.created_counterpart && source) {
    return <CreatedCounterpartFields source={source} target={target} onTarget={onTarget} />;
  }

  const suggestions = suggestionsOf(options.data);
  const accounts = options.data.accounts;

  return (
    <>
      {suggestions.length > 0 && (
        <fieldset className={styles["suggestions"]} aria-describedby={`${suggestionsId}-hint`}>
          <legend>Bookings on other accounts</legend>
          <p id={`${suggestionsId}-hint`} className={styles["suggestions-hint"]}>The opposite amount within two weeks; choosing one makes it the counterpart.</p>
          {suggestions.map(booking => (
            <label key={booking.id} className={styles["suggestion"]}>
              <input
                type="radio"
                name="counterpart"
                value={booking.id}
                checked={target.kind === "booking" && target.booking.id === booking.id}
                onChange={() => onTarget({
                  kind: "booking",
                  booking
                })}
              />
              <span>{bookingLabel(booking)}</span>
            </label>
          ))}
        </fieldset>
      )}
      <label htmlFor={targetId}>
        Target account
        <Select
          id={targetId}
          name="target"
          value={selectValue(target)}
          onChange={event => {
            const value = event.target.value;

            onTarget(value.startsWith("account:") ? {
              kind: "account",
              accountId: value.slice("account:".length)
            } : noTarget);
          }}
        >
          <option value="">None (account not tracked in Ufer)</option>
          {target.kind === "booking" && <option value={selectValue(target)}>{`${target.booking.account_name} (selected booking)`}</option>}
          {accounts.map(account => <option key={account.id} value={`account:${account.id}`}>{account.name}</option>)}
        </Select>
      </label>
      <p className={ui["form-hint"]} role="status">{targetSummary(transaction, target, accounts)}</p>
    </>
  );
}
