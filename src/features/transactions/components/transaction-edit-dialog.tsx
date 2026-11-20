"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { Check, Eye, EyeOff, Split, Trash2 } from "lucide-react";
import styles from "./transaction-type.module.css";
import { toFailure, type Failure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { CategoryPicker } from "@/features/categorization/components/category-picker";
import { useCategories } from "@/features/categorization/queries";
import { describeDate } from "@/lib/date-format";
import { decimalAmount, minorUnits, money } from "@/lib/money";
import { isTransactionType, manualAccountTypes, transactionTypeLabels, transactionTypes, type TransactionType } from "@/features/transactions/transaction-types";
import { useDeleteTransaction, useHideTransaction, useRemoveSplit, useSaveSplit, useSaveTransaction, type EntryEdit, type TransactionEdit } from "@/features/transactions/mutations";
import { useTransferOptions } from "@/features/transactions/queries";
import { useTransactionCategory } from "@/features/transactions/use-transaction-category";
import type { Transaction, TransferBooking, TransferOptions } from "@/features/transactions/types";
import { EntryFields, suggestedType } from "./entry-fields";
import { draftEdits, draftState, initialDraft } from "@/features/transactions/split-draft";
import { SplitEditor } from "./transaction-split";
import { PayeeInput } from "./payee-input";

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

type Step = "edit" | "delete" | "hide";

const stepTitles: Record<Step, string> = {
  edit: "Edit transaction",
  delete: "Delete transaction",
  hide: "Hide transaction"
};

/**
 * Edits a transaction's type, category and, for a transfer, where it goes. A transaction entered in Ufer also edits its date, amount, payee and description and can be deleted; an imported one overrides its payee and description and can be hidden. One Save stores everything.
 */
export function TransactionEditDialog({
  transaction,
  close
}: Props) {
  const [step, setStep] = useState<Step>("edit");

  return (
    <Dialog
      eyebrow="TRANSACTION"
      title={stepTitles[step]}
      wide={step === "edit"}
      onClose={close}
    >
      {step !== "edit" && <TransactionFacts transaction={transaction} />}
      {step === "delete" && <DeleteConfirmation transaction={transaction} close={close} cancel={() => setStep("edit")} />}
      {step === "hide" && <HideConfirmation transaction={transaction} close={close} cancel={() => setStep("edit")} />}
      {step === "edit" && (
        <TransactionEditForm
          transaction={transaction}
          close={close}
          onDelete={() => setStep("delete")}
          onHide={() => setStep("hide")}
        />
      )}
    </Dialog>
  );
}

/** The amount, prominently, with payee, date and account; the edit form places the type beside the amount, since it describes the amount. */
function TransactionFacts({
  transaction,
  children
}: {
  transaction: Transaction;
  children?: ReactNode;
}) {
  const subject = transaction.counterparty || transaction.description || transactionTypeLabels[transaction.type];
  const date = describeDate(Temporal.PlainDate.from(transaction.booking_date)).label;

  return (
    <div className={styles["facts"]}>
      <div className={styles["facts-line"]}>
        <span className={clsx(styles["facts-amount"], transaction.amount_minor > 0 && styles["incoming"])}>{signedMoney(transaction.amount_minor, transaction.currency)}</span>
        {children}
      </div>
      <span className={styles["facts-meta"]}>{[subject, date, transaction.account_name].join(" · ")}</span>
    </div>
  );
}

/** What hiding an imported booking changes, including the transfer link it ends. */
function hidingEffect(transaction: Transaction) {
  const effect = "Excluded from balances and reports until shown again.";
  const other = transaction.counterpart?.account_name;

  if (!other) {
    return effect;
  }

  return `${effect} Ends the link with ${other}.`;
}

function HideConfirmation({
  transaction,
  close,
  cancel
}: {
  transaction: Transaction;
  close: () => void;
  cancel: () => void;
}) {
  const hide = useHideTransaction(transaction.id);

  return (
    <form
      className={ui["form"]}
      onSubmit={event => {
        event.preventDefault();
        hide.mutate(true, {
          onSuccess: close
        });
      }}
    >
      <p className={ui["form-hint"]}>{hidingEffect(transaction)}</p>
      <FormError failure={hide.error ? toFailure(hide.error) : null} />
      <div className={ui["form-actions"]}>
        <button
          type="button"
          className={ui["button"]}
          disabled={hide.isPending}
          onClick={cancel}
        >
          Cancel
        </button>
        <button className={clsx(ui["button"], ui["primary"])} disabled={hide.isPending}>
          <EyeOff size={15} />
          Hide
        </button>
      </div>
    </form>
  );
}

/** Shows a hidden imported booking again; it counts toward balances and reports from then on. */
function ShowAgain({
  transaction,
  close
}: {
  transaction: Transaction;
  close: () => void;
}) {
  const show = useHideTransaction(transaction.id);

  return (
    <div className={styles["hidden-note"]}>
      <p className={ui["form-hint"]}>Hidden from balances and reports.</p>
      <FormError failure={show.error ? toFailure(show.error) : null} />
      <button
        type="button"
        className={clsx(ui["button"], ui["full-width"])}
        disabled={show.isPending}
        onClick={() => show.mutate(false, {
          onSuccess: close
        })}
      >
        <Eye size={15} />
        Show transaction
      </button>
    </div>
  );
}

/** What deleting a transaction entered in Ufer also changes. */
function deletionEffect(transaction: Transaction) {
  const other = transaction.counterpart?.account_name;

  if (!other) {
    return "This cannot be undone.";
  }

  if (transaction.follows_import) {
    return `The booking on ${other} stays. This cannot be undone.`;
  }

  return `Also deletes the booking on ${other}. This cannot be undone.`;
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
      <p className={ui["form-hint"]}>{deletionEffect(transaction)}</p>
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

/** An entered amount in signed minor units, or null while it is empty, zero or not a valid amount. */
function parsedAmount(amount: string, currency: string) {
  try {
    const value = minorUnits(amount, currency);

    return value === 0 ? null : value;
  } catch {
    return null;
  }
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
  onDelete,
  onHide
}: Props & {
  onDelete: () => void;
  onHide: () => void;
}) {
  const save = useSaveTransaction(transaction.id);
  const saveSplit = useSaveSplit(transaction.id);
  const removeSplit = useRemoveSplit(transaction.id);
  const categories = useCategories();
  const categoryFieldId = useId();
  const assignment = useTransactionCategory(transaction);
  // A row change still being saved is the category the dialog starts from, so saving does not revert it.
  const [initialCategory] = useState(assignment.categoryId);
  const [category, setCategory] = useState(initialCategory);
  const [followFailure, setFollowFailure] = useState<Failure | null>(null);
  const pending = save.isPending || saveSplit.isPending || removeSplit.isPending || assignment.status?.kind === "saving";
  const error = save.error ? toFailure(save.error) : followFailure;
  const [splitOpen, setSplitOpen] = useState(transaction.split !== null);
  // Which control takes focus after the person opens or closes the split section, since the control they used disappears.
  const [splitFocus, setSplitFocus] = useState<"editor" | "trigger" | null>(null);
  // The amount being saved: a booking entered in Ufer can change it in this dialog, and its split must add up to the new amount.
  const [liveAmount, setLiveAmount] = useState(transaction.amount_minor);
  const splitBasis = {
    ...transaction,
    amount_minor: liveAmount
  };
  const [draft, setDraft] = useState(() => initialDraft(transaction, initialCategory));
  const split = draftState(draft, splitBasis);
  const splitBlocked = splitOpen && (split.status === "invalid" || split.status === "under" || split.status === "over");
  const [type, setType] = useState<TransactionType>(transaction.type);
  const [typeChosen, setTypeChosen] = useState(false);
  const [chosenTarget, setTarget] = useState<Target>();
  const transfer = type === "transfer";
  // A hidden booking is not linked; it can be a transfer to an untracked account until it is shown again.
  const linkable = transfer && !transaction.hidden;
  // Imported from a bank or file: not entered in Ufer and not a counterpart Ufer created, which the server treats as entered.
  const imported = !transaction.entered && !transaction.created_counterpart;
  const options = useTransferOptions(transaction.id, linkable);
  const target = chosenTarget ?? storedTarget(transaction, options.data);
  // A split booking stays income or expense, since only those count by category; the stored type stays listed.
  const typeAllowed = (option: TransactionType) => !splitOpen || option === "income" || option === "expense";
  const canSplit = type === "income" || type === "expense";
  const available = transactionTypes.filter(option => option === transaction.type || (typeAllowed(option) && (transaction.manual_account || !manualAccountTypes.includes(option))));
  // Without loaded options, saving a transfer could drop a link the form cannot show.
  const targetUnknown = linkable && options.status !== "success";

  // Awaited promises rather than per-call callbacks, so later steps still run when the details' refresh removes the row and this dialog. A failed step keeps the dialog open, and saving again repeats the idempotent writes.
  // Each step runs only after the previous one succeeded. A stored split is removed before a type it does not allow is saved, since the server refuses that type for a split booking; otherwise it is removed after the details, so a rejected edit leaves the split in place.
  async function saveAll(details: TransactionEdit | EntryEdit) {
    const keepsSplit = splitOpen && split.status === "ready";
    const removesSplit = transaction.split !== null && !keepsSplit;
    const removesFirst = removesSplit && type !== "income" && type !== "expense";

    if (removesFirst && !await attempt(() => removeSplit.mutateAsync())) {
      return;
    }

    try {
      await save.mutateAsync(details);
    } catch {
      // The details mutation's error is shown from its state.
      return;
    }

    if (await attempt(() => saveCategories(keepsSplit, removesSplit && !removesFirst))) {
      close();
    }
  }

  async function attempt(step: () => Promise<unknown>) {
    try {
      await step();

      return true;
    } catch (failure) {
      setFollowFailure(toFailure(failure));

      return false;
    }
  }

  // A split with a single counted part is a plain category; parts with an amount of 0 are ignored. Categories are compared with the stored ones, not the ones the dialog started from: a row change that was pending at opening and then failed is assigned again.
  async function saveCategories(keepsSplit: boolean, removesSplit: boolean) {
    if (keepsSplit) {
      await saveSplit.mutateAsync(draftEdits(draft, splitBasis));

      return;
    }

    const counted = draft.parts.find((_, index) => split.amounts[index] !== 0);
    const chosen = splitOpen ? counted?.categoryId ?? null : category;

    if (removesSplit) {
      await removeSplit.mutateAsync();
    }

    if (chosen !== transaction.category_id || (transaction.split && splitOpen)) {
      await assignment.assign(chosen);
    }
  }


  return (
    <form
      className={ui["form"]}
      onSubmit={event => {
        event.preventDefault();

        const edit: TransactionEdit = linkable ? {
          type,
          transfer: transferEdit(target)
        } : {
          type
        };
        const details = detailsEdit(edit, new FormData(event.currentTarget), transaction, imported);

        if (splitBlocked) {
          return;
        }

        setFollowFailure(null);
        void saveAll(details);
      }}
    >
      <TransactionFacts transaction={transaction}>
        <Select
          className={styles["type-control"]}
          aria-label="Type"
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
      </TransactionFacts>
      <div className={styles["fields"]}>
        {transaction.hidden && <ShowAgain transaction={transaction} close={close} />}
        {imported && <ImportedTextFields transaction={transaction} />}
        {transaction.entered && (
          <EntryFields
            defaults={entryDefaults(transaction)}
            payee={!(transfer && (target.kind === "account" || targetUnknown))}
            followedAccount={transaction.follows_import ? transaction.counterpart?.account_name : undefined}
            onAmount={amount => {
              const parsed = parsedAmount(amount, transaction.currency);

              if (parsed !== null) {
                setLiveAmount(parsed);
              }

              const suggested = suggestedType(amount);

              if (!typeChosen && suggested && (type === "income" || type === "expense")) {
                setType(suggested);
              }
            }}
          />
        )}
        {!transfer && transaction.counterpart && <p className={ui["form-hint"]}>{leaveTransferHint(transaction)}</p>}
        {linkable && (
          <TransferFields
            transaction={transaction}
            options={options}
            target={target}
            onTarget={setTarget}
          />
        )}
        {!splitOpen && (
          <div className={styles["cell"]}>
            <label htmlFor={categoryFieldId}>Category</label>
            <CategoryPicker
              id={categoryFieldId}
              categories={categories.data ?? []}
              value={category}
              includeUncategorized
              onChange={setCategory}
            />
            {category !== null && category === initialCategory && category === transaction.category_id && transaction.category_source === "rule" && <span>Assigned by a rule.</span>}
            {canSplit && (
              <button
                ref={element => {
                  if (element && splitFocus === "trigger") {
                    element.focus();
                  }
                }}
                type="button"
                className={ui["text-button"]}
                disabled={pending}
                onClick={() => {
                  setDraft(initialDraft(splitBasis, category));
                  setSplitOpen(true);
                  setSplitFocus("editor");
                }}
              >
                <Split size={14} aria-hidden="true" />
                Split into categories
              </button>
            )}
          </div>
        )}
        {splitOpen && (
          <SplitEditor
            transaction={splitBasis}
            categories={categories.data ?? []}
            draft={draft}
            state={split}
            disabled={pending}
            focusFirst={splitFocus === "editor"}
            onDraft={setDraft}
            onClose={() => {
              setSplitOpen(false);
              setSplitFocus("trigger");
            }}
          />
        )}
      </div>
      <FormError failure={error} />
      <div className={styles["actions"]}>
        <button className={clsx(ui["button"], ui["primary"])} disabled={pending || targetUnknown || splitBlocked}>
          Save <Check size={16} />
        </button>
        {transaction.entered && (
          <button
            type="button"
            className={clsx(ui["button"], styles["delete"])}
            disabled={pending}
            onClick={onDelete}
          >
            <Trash2 size={15} />
            Delete transaction
          </button>
        )}
        {imported && !transaction.hidden && (
          <button
            type="button"
            className={ui["button"]}
            disabled={pending}
            onClick={onHide}
          >
            <EyeOff size={15} />
            Hide transaction
          </button>
        )}
      </div>
    </form>
  );
}

function detailsEdit(edit: TransactionEdit, data: FormData, transaction: Transaction, imported: boolean): TransactionEdit | EntryEdit {
  if (transaction.entered) {
    return entryEdit(edit, data);
  }

  return imported ? textEdit(edit, data, transaction) : edit;
}

/** Adds an imported booking's payee and description to the edit only when they changed, so saving a type never turns the source's text into an override. */
function textEdit(edit: TransactionEdit, data: FormData, transaction: Transaction): TransactionEdit {
  const counterparty = String(data.get("counterparty") ?? "").trim();
  const description = String(data.get("description") ?? "").trim();

  return {
    ...edit,
    ...(counterparty === transaction.counterparty.trim() ? {} : {
      counterparty
    }),
    ...(description === transaction.description.trim() ? {} : {
      description
    })
  };
}

/** Payee and description of an imported booking. A changed text overrides the source's and survives later syncs; restoring the source's text follows the source again. */
function ImportedTextFields({ transaction }: {
  transaction: Transaction
}) {
  return (
    <>
      <OverridableText initial={transaction.counterparty} source={transaction.source_counterparty}>
        {field => (
          <PayeeInput
            label="Payee"
            name="counterparty"
            maxLength={500}
            defaultValue={field.defaultValue}
            inputRef={field.inputRef}
            aria-describedby={field.describedBy}
            onValueChange={field.onValueChange}
          />
        )}
      </OverridableText>
      <OverridableText initial={transaction.description} source={transaction.source_description}>
        {field => (
          <label>
            Description
            <input
              ref={field.inputRef}
              name="description"
              maxLength={2000}
              defaultValue={field.defaultValue}
              aria-describedby={field.describedBy}
              onChange={event => field.onValueChange(event.target.value)}
            />
          </label>
        )}
      </OverridableText>
    </>
  );
}

/** What an overridable field's input needs to report its text and show the source's text beside it. */
type OverridableField = {
  defaultValue: string;
  inputRef: RefObject<HTMLInputElement | null>;
  describedBy: string | undefined;
  onValueChange: (value: string) => void;
};

function OverridableText({
  initial,
  source,
  children
}: {
  initial: string;
  source: string;
  children: (field: OverridableField) => ReactNode;
}) {
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [overridden, setOverridden] = useState(initial.trim() !== source.trim());

  return (
    <div className={styles["overridable"]}>
      {children({
        defaultValue: initial,
        inputRef: input,
        describedBy: overridden ? hintId : undefined,
        onValueChange: value => setOverridden(value.trim() !== source.trim())
      })}
      {overridden && (
        <p id={hintId} className={styles["source-text"]}>
          <span>Original: {source || "empty"}</span>
          <button
            type="button"
            className={styles["restore"]}
            onClick={() => {
              if (input.current) {
                input.current.value = source;
              }

              setOverridden(false);
            }}
          >
            Restore
          </button>
        </p>
      )}
    </div>
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

/** What saving a type other than transfer does to the linked booking. */
function leaveTransferHint(transaction: Transaction) {
  const account = transaction.counterpart?.account_name;

  if (transaction.entered && !transaction.follows_import) {
    return `Also deletes the booking on ${account}.`;
  }

  if (transaction.created_counterpart) {
    return "Deletes this booking.";
  }

  return `Ends the link with ${account}.`;
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
      <p className={ui["form-hint"]}>Created for the transfer of {bookingLabel(source)}.</p>
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
      <p className={ui["form-hint"]} role="status">{remove ? "Save removes this booking." : `Linked with ${source.account_name}.`}</p>
    </div>
  );
}

function targetSummary(transaction: Transaction, target: Target, accounts: TransferOptions["accounts"]) {
  const direction = transaction.amount_minor < 0 ? "to" : "from";

  if (target.kind === "booking") {
    return `Linked with ${bookingLabel(target.booking)}.`;
  }

  if (target.kind === "account") {
    const account = accounts.find(item => item.id === target.accountId);

    return `Books the other side on ${account?.name ?? "the manual account"}.`;
  }

  return `Transfer ${direction} an untracked account.`;
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
    return <p className={ui["form-hint"]} role="status">Loading suggestions …</p>;
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
    <div className={styles["pair"]}>
      <div className={styles["cell"]}>
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
      </div>
      {suggestions.length > 0 && (
        <fieldset className={styles["suggestions"]} aria-describedby={`${suggestionsId}-hint`}>
          <legend>Bookings on other accounts</legend>
          <p id={`${suggestionsId}-hint`} className={styles["suggestions-hint"]}>Opposite amount within two weeks.</p>
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
    </div>
  );
}
