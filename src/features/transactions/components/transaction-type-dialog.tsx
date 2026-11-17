"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useState } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { Check, Link2, Unlink } from "lucide-react";
import styles from "./transaction-type.module.css";
import { toFailure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { describeDate } from "@/lib/date-format";
import { money } from "@/lib/money";
import { isTransactionType, manualAccountTypes, transactionTypeLabels, transactionTypes } from "@/features/transactions/transaction-types";
import { useLinkTransfer, useSetTransactionType, useUnlinkTransfer, type TransferTarget } from "@/features/transactions/mutations";
import { useTransferOptions } from "@/features/transactions/queries";
import type { Transaction, TransferBooking } from "@/features/transactions/types";

type Props = {
  transaction: Transaction;
  close: () => void;
};

function signedMoney(amount: number, currency: string) {
  return `${amount > 0 ? "+" : ""}${money(amount, currency)}`;
}

function bookingLabel(booking: TransferBooking) {
  const date = describeDate(Temporal.PlainDate.from(booking.booking_date)).label;
  const payee = booking.counterparty || booking.description;

  return [booking.account_name, date, signedMoney(booking.amount_minor, booking.currency), payee].filter(Boolean).join(" · ");
}

/** Changes a transaction's type and, for a transfer, which booking on another own account is its counterpart. */
export function TransactionTypeDialog({
  transaction,
  close
}: Props) {
  const subject = transaction.counterparty || transaction.description || "Transaction";

  return (
    <Dialog eyebrow="TRANSACTION" title="Type and transfer" onClose={close}>
      <p className={ui["form-description"]}>
        {subject} · {transaction.account_name} · {signedMoney(transaction.amount_minor, transaction.currency)}
      </p>
      <TypeForm transaction={transaction} close={close} />
      {transaction.type === "transfer" && <TransferLink transaction={transaction} close={close} />}
    </Dialog>
  );
}

function TypeForm({
  transaction,
  close
}: Props) {
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useSetTransactionType(transaction.id), close);
  const available = transactionTypes.filter(type => transaction.manual_account || !manualAccountTypes.includes(type) || type === transaction.type);

  return (
    <form
      className={ui["form"]}
      onSubmit={event => submit(event, data => {
        const type = String(data.get("type"));

        return isTransactionType(type) ? type : transaction.type;
      })}
    >
      <label>
        Type
        <Select name="type" defaultValue={transaction.type}>
          {available.map(type => <option key={type} value={type}>{transactionTypeLabels[type]}</option>)}
        </Select>
      </label>
      <p className={ui["form-hint"]}>
        Income and expenses count toward cash flow and spending; transfers, opening balances and adjustments do not. A refund is an expense with a positive amount and reduces spending.
        {transaction.counterpart && ` Another type ends the link with ${transaction.counterpart.account_name}, whose booking becomes income or expense.`}
      </p>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        Save type <Check size={16} />
      </button>
    </form>
  );
}

function TransferLink({
  transaction,
  close
}: Props) {
  const options = useTransferOptions(transaction.id);

  return (
    <section className={styles["transfer"]} aria-labelledby={`transfer-${transaction.id}`}>
      <h3 id={`transfer-${transaction.id}`} className={styles["transfer-heading"]}>Counterpart</h3>
      {options.status === "pending" && <p className={ui["form-hint"]} role="status">Loading the counterpart …</p>}
      {options.status === "error" && <FormError failure={toFailure(options.error)} />}
      {options.status === "success" && options.data.counterpart && <LinkedCounterpart transaction={transaction} counterpart={options.data.counterpart} close={close} />}
      {options.status === "success" && !options.data.counterpart && (
        <LinkForm
          transaction={transaction}
          close={close}
          candidates={options.data.candidates}
          accounts={options.data.accounts}
        />
      )}
    </section>
  );
}

function LinkedCounterpart({
  transaction,
  counterpart,
  close
}: Props & {
  counterpart: TransferBooking
}) {
  const unlink = useUnlinkTransfer(transaction.id);

  return (
    <>
      <p className={styles["counterpart"]}>{bookingLabel(counterpart)}</p>
      <p className={ui["form-hint"]}>
        Both bookings form one transfer and never count as income or spending. Unlinking keeps both as transfers without a counterpart; a booking Ufer created on a manual account is removed.
      </p>
      <FormError failure={unlink.error ? toFailure(unlink.error) : null} />
      <button
        type="button"
        className={clsx(ui["button"], ui["full-width"], styles["action"])}
        disabled={unlink.isPending}
        onClick={() => unlink.mutate(undefined, {
          onSuccess: close
        })}
      >
        Unlink <Unlink size={16} />
      </button>
    </>
  );
}

// Option values name their kind, because bookings and manual accounts share one select.
function linkTarget(value: string): TransferTarget {
  const id = value.slice(value.indexOf(":") + 1);

  if (value.startsWith("account:")) {
    return {
      account_id: id
    };
  }

  return {
    counterpart_id: id
  };
}

function LinkForm({
  transaction,
  close,
  candidates,
  accounts
}: Props & {
  candidates: TransferBooking[];
  accounts: {
    id: string;
    name: string
  }[];
}) {
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useLinkTransfer(transaction.id), close);
  const [target, setTarget] = useState("");
  const direction = transaction.amount_minor < 0 ? "to" : "from";

  if (!candidates.length && !accounts.length) {
    return (
      <p className={ui["form-hint"]}>
        No booking with the opposite amount within two weeks and no manual account in {transaction.currency}. This stays a transfer {direction} an account not tracked in Ufer.
      </p>
    );
  }

  return (
    <form className={ui["form"]} onSubmit={event => submit(event, () => linkTarget(target))}>
      <p className={ui["form-hint"]}>Without a counterpart this is a transfer {direction} an account not tracked in Ufer.</p>
      <label>
        Link with
        <Select name="target" value={target} onChange={event => setTarget(event.target.value)}>
          <option value="" disabled>Choose a booking or manual account</option>
          {candidates.length > 0 && (
            <optgroup label="Bookings on other accounts">
              {candidates.map(candidate => <option key={candidate.id} value={`booking:${candidate.id}`}>{bookingLabel(candidate)}</option>)}
            </optgroup>
          )}
          {accounts.length > 0 && (
            <optgroup label="Create the booking on a manual account">
              {accounts.map(account => <option key={account.id} value={`account:${account.id}`}>{`New booking on ${account.name}`}</option>)}
            </optgroup>
          )}
        </Select>
      </label>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["full-width"], styles["action"])} disabled={pending || !target}>
        Link counterpart <Link2 size={16} />
      </button>
    </form>
  );
}
