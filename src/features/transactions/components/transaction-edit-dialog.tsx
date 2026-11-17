"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useState } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { Check, Trash2 } from "lucide-react";
import styles from "./transaction-type.module.css";
import { toFailure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { describeDate } from "@/lib/date-format";
import { decimalAmount, money } from "@/lib/money";
import { isTransactionType, manualAccountTypes, transactionTypeLabels, transactionTypes, type TransactionType } from "@/features/transactions/transaction-types";
import { useDeleteTransaction, useSaveTransaction, type EntryEdit, type TransactionEdit } from "@/features/transactions/mutations";
import { useTransferOptions } from "@/features/transactions/queries";
import type { Transaction, TransferBooking, TransferOptions } from "@/features/transactions/types";
import { EntryFields, suggestedType } from "./entry-fields";

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

/** Whether the linked booking is chosen through its manual account: a counterpart Ufer created there, or the other side of a pair entered in Ufer. */
function linkedThroughAccount(transaction: Transaction, counterpart: TransferBooking) {
  return counterpart.created || (transaction.entered && counterpart.entered);
}

/** The stored target: the linked booking, or the manual account of a counterpart chosen through its account. */
function storedTarget(transaction: Transaction, options: TransferOptions | undefined): Target {
  const counterpart = options?.counterpart;

  if (!counterpart) {
    return noTarget;
  }

  if (linkedThroughAccount(transaction, counterpart)) {
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

/** Suggested counterparts: the linked booking first, then unlinked bookings with the opposite amount. A counterpart chosen through its account is not repeated here. */
function suggestionsOf(transaction: Transaction, options: TransferOptions | undefined) {
  if (!options) {
    return [];
  }

  const linked = options.counterpart && !linkedThroughAccount(transaction, options.counterpart) ? [options.counterpart] : [];

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

/** Edits a transaction's type and, for a transfer, where it goes; a transaction entered in Ufer also edits its date, amount, payee and description and can be deleted. One Save stores everything. */
export function TransactionEditDialog({
  transaction,
  close
}: Props) {
  const [deleting, setDeleting] = useState(false);
  const subject = transaction.counterparty || transaction.description || transactionTypeLabels[transaction.type];

  return (
    <Dialog eyebrow="TRANSACTION" title={deleting ? "Delete transaction" : "Edit transaction"} onClose={close}>
      <p className={ui["form-description"]}>
        {subject} · {transaction.account_name} · {signedMoney(transaction.amount_minor, transaction.currency)}
      </p>
      {deleting ? <DeleteConfirmation transaction={transaction} close={close} cancel={() => setDeleting(false)} /> : <TransactionEditForm transaction={transaction} close={close} onDelete={() => setDeleting(true)} />}
    </Dialog>
  );
}

/** What deleting a transaction entered in Ufer also changes. */
function deletionEffect(transaction: Transaction) {
  const other = transaction.counterpart?.account_name;

  if (!other) {
    return "The transaction is removed from the account and its balance.";
  }

  if (transaction.follows_import) {
    return `The transaction is removed; the linked booking on ${other} stays as a transfer without a counterpart.`;
  }

  return `Both sides of this transfer are removed, including the booking on ${other}.`;
}

function DeleteConfirmation({
  transaction,
  close,
  cancel
}: {
  transaction: Transaction;
  close: () => void;
  cancel: () => void;
}) {
  const remove = useDeleteTransaction(transaction.id);

  return (
    <form
      className={ui["form"]}
      onSubmit={event => {
        event.preventDefault();
        remove.mutate(undefined, {
          onSuccess: close
        });
      }}
    >
      <p className={ui["form-hint"]}>{deletionEffect(transaction)} This cannot be undone.</p>
      <FormError failure={remove.error ? toFailure(remove.error) : null} />
      <div className={ui["form-actions"]}>
        <button
          type="button"
          className={ui["button"]}
          disabled={remove.isPending}
          onClick={cancel}
        >
          Cancel
        </button>
        <button className={styles["danger"]} disabled={remove.isPending}>
          <Trash2 size={15} />
          Delete
        </button>
      </div>
    </form>
  );
}

function entryDefaults(transaction: Transaction) {
  return {
    booking_date: transaction.booking_date,
    amount: decimalAmount(transaction.amount_minor, transaction.currency),
    counterparty: transaction.counterparty,
    description: transaction.description
  };
}

function TransactionEditForm({
  transaction,
  close,
  onDelete
}: Props & {
  onDelete: () => void;
}) {
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useSaveTransaction(transaction.id), close);
  const [type, setType] = useState<TransactionType>(transaction.type);
  const [typeChosen, setTypeChosen] = useState(false);
  const [chosenTarget, setTarget] = useState<Target>();
  const transfer = type === "transfer";
  const options = useTransferOptions(transaction.id, transfer);
  const target = chosenTarget ?? storedTarget(transaction, options.data);
  const available = transactionTypes.filter(option => transaction.manual_account || !manualAccountTypes.includes(option) || option === transaction.type);
  // Without loaded options, saving a transfer could drop a link the form cannot show.
  const targetUnknown = transfer && options.status !== "success";

  return (
    <form
      className={ui["form"]}
      onSubmit={event => submit(event, data => {
        const edit: TransactionEdit = transfer ? {
          type,
          transfer: transferEdit(target)
        } : {
          type
        };

        return transaction.entered ? entryEdit(edit, data) : edit;
      })}
    >
      {transaction.entered && (
        <EntryFields
          defaults={entryDefaults(transaction)}
          payee={!(transfer && target.kind === "account")}
          followedAccount={transaction.follows_import ? transaction.counterpart?.account_name : undefined}
          onAmount={amount => {
            const suggested = suggestedType(amount);

            if (!typeChosen && suggested && (type === "income" || type === "expense")) {
              setType(suggested);
            }
          }}
        />
      )}
      <label>
        Type
        <Select
          name="type"
          value={type}
          onChange={event => {
            const value = event.target.value;

            if (isTransactionType(value)) {
              setType(value);
              setTypeChosen(true);
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
      {transaction.entered && (
        <button
          type="button"
          className={clsx(ui["button"], ui["full-width"], styles["delete"])}
          disabled={pending}
          onClick={onDelete}
        >
          <Trash2 size={15} />
          Delete transaction
        </button>
      )}
    </form>
  );
}

function entryEdit(edit: TransactionEdit, data: FormData): EntryEdit {
  return {
    ...edit,
    booking_date: String(data.get("booking_date")),
    amount: String(data.get("amount")),
    counterparty: String(data.get("counterparty") ?? ""),
    description: String(data.get("description") ?? "")
  };
}

function LeaveTransferHint({ transaction }: {
  transaction: Transaction
}) {
  const account = transaction.counterpart?.account_name;

  if (transaction.entered && !transaction.follows_import) {
    return ` Saving another type removes the other side on ${account}.`;
  }

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

    return `Save books the other side on ${account?.name ?? "the manual account"}.`;
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

  // Only a counterpart created for an imported booking follows it; one side of a pair entered in Ufer edits the pair like any other booking.
  if (transaction.created_counterpart && !transaction.entered && source) {
    return <CreatedCounterpartFields source={source} target={target} onTarget={onTarget} />;
  }

  const suggestions = suggestionsOf(transaction, options.data);
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
