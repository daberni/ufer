"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { ChartNoAxesCombined, Check, Eye, EyeOff, Split, Trash2 } from "lucide-react";
import styles from "./transaction-type.module.css";
import { toFailure, type Failure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { CategoryPicker } from "@/features/categorization/components/category-picker";
import { useCategories } from "@/features/categorization/queries";
import { describeDate } from "@/lib/date-format";
import { decimalAmount, minorUnits, signedMoney } from "@/lib/money";
import { derivedTransactionType, entryTransactionTypes, isTransactionType, manualAccountTypes, transactionTypeLabels, type TransactionType } from "@/lib/transaction-types";
import { useDeleteTransaction, useHideTransaction, useSaveTransaction, type EntryEdit, type TransactionEdit } from "@/features/transactions/mutations";
import { useTransferOptions } from "@/features/transactions/queries";
import { useTransactionCategory } from "@/features/transactions/use-transaction-category";
import { bookkeepingFrozen, type Transaction, type TransferBooking, type TransferOptions } from "@/features/transactions/types";
import { EntryFields, suggestedType } from "./entry-fields";
import { draftEdits, draftState, initialDraft } from "@/features/transactions/split-draft";
import { SplitEditor } from "./transaction-split";
import { PayeeInput } from "./payee-input";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/client/query-keys";
import { activeAccounts } from "@/features/accounts/queries";
import type { Account } from "@/features/accounts/types";
import { TradeForm } from "@/features/securities/components/trade-dialog";
import { BookingTradePanel } from "@/features/securities/components/booking-trade";
import { useLocale } from "@/client/locale-provider";

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

function bookingLabel(booking: TransferBooking, locale: string) {
  const date = describeDate(Temporal.PlainDate.from(booking.date), locale).label;
  const payee = booking.counterparty || booking.description;

  return [booking.account_name, date, signedMoney(booking.amount_minor, booking.currency, locale), payee].filter(Boolean).join(" · ");
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

type Step = "edit" | "delete" | "hide" | "trade";

const stepTitles: Record<Step, string> = {
  edit: "Edit transaction",
  delete: "Delete transaction",
  hide: "Hide transaction",
  trade: "Record trade"
};

/**
 * Edits a transaction's type, category and, for a transfer, where it goes. A transaction entered in Ufer also edits its date, amount, payee and description and can be deleted; an imported one overrides its payee and description and can be hidden. One Save stores everything.
 */
export function TransactionEditDialog({
  transaction,
  close
}: Props) {
  const [step, setStep] = useState<Step>("edit");
  // The dashboard always holds the account list, so the dialog reads it without starting a request of its own.
  const brokerageAccounts = activeAccounts(useQueryClient().getQueryData<Account[]>(queryKeys.accounts()) ?? []).filter(account => account.kind === "brokerage" && account.currency === transaction.currency);
  // An imported income or expense can be the cash side of a buy or sale on a brokerage account in its currency.
  const tradeable = !transaction.entered && !transaction.manual_account && !transaction.hidden && !transaction.account_archived && transaction.split === null && (transaction.type === "income" || transaction.type === "expense") && brokerageAccounts.length > 0;

  // The cash side of a security trade is changed through its trade (ADR 012), so its dialog shows the trade instead of the booking form.
  if (transaction.trade) {
    return (
      <Dialog eyebrow="TRANSACTION" title={transaction.trade.side === "buy" ? "Buy" : "Sale"} onClose={close}>
        <BookingTradePanel transaction={transaction} trade={transaction.trade} close={close} />
      </Dialog>
    );
  }

  return (
    <Dialog
      eyebrow="TRANSACTION"
      title={stepTitles[step]}
      wide={step === "edit"}
      onClose={close}
    >
      {step !== "edit" && step !== "trade" && <TransactionFacts transaction={transaction} />}
      {step === "trade" && (
        <TradeForm
          brokerageAccounts={brokerageAccounts}
          settlementAccounts={[]}
          booking={{
            id: transaction.id,
            date: transaction.date,
            amount_minor: transaction.amount_minor,
            currency: transaction.currency,
            text: [transaction.counterparty, transaction.description].filter(Boolean).join(" · "),
            account_name: transaction.account_name
          }}
          close={close}
        />
      )}
      {step === "delete" && <DeleteConfirmation transaction={transaction} close={close} cancel={() => setStep("edit")} />}
      {step === "hide" && <HideConfirmation transaction={transaction} close={close} cancel={() => setStep("edit")} />}
      {step === "edit" && (
        <TransactionEditForm
          transaction={transaction}
          close={close}
          onDelete={() => setStep("delete")}
          onHide={() => setStep("hide")}
          onTrade={tradeable ? () => setStep("trade") : undefined}
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
  const locale = useLocale();
  const subject = transaction.counterparty || transaction.description || transactionTypeLabels[transaction.type];
  const date = describeDate(Temporal.PlainDate.from(transaction.date), locale).label;

  return (
    <div className={styles["facts"]}>
      <div className={styles["facts-line"]}>
        <span className={clsx(styles["facts-amount"], transaction.amount_minor > 0 && styles["incoming"])}>{signedMoney(transaction.amount_minor, transaction.currency, locale)}</span>
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
        <button className={ui["danger-button"]} disabled={remove.isPending}>
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
    date: transaction.date,
    amount: decimalAmount(transaction.amount_minor, transaction.currency),
    counterparty: transaction.counterparty,
    description: transaction.description
  };
}

function TransactionEditForm({
  transaction,
  close,
  onDelete,
  onHide,
  onTrade
}: Props & {
  onDelete: () => void;
  onHide: () => void;
  /** Records the booking as the cash side of a trade; offered for imported income and expenses while a brokerage account in its currency exists. */
  onTrade?: () => void;
}) {
  const save = useSaveTransaction(transaction.id);
  const categories = useCategories();
  const categoryFieldId = useId();
  const assignment = useTransactionCategory(transaction);
  // A row change still being saved is the category the dialog starts from, so saving does not revert it.
  const [initialCategory] = useState(assignment.categoryId);
  const [category, setCategory] = useState(initialCategory);
  const [followFailure, setFollowFailure] = useState<Failure | null>(null);
  // Held from Save until every step settles, so no second save can start between the details and the category.
  const [saving, setSaving] = useState(false);
  const pending = saving || save.isPending || assignment.status?.kind === "saving";
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
  // Archiving freezes balances: categories, payee and description stay editable, and imported bookings can still be linked with existing ones.
  const frozen = bookkeepingFrozen(transaction);
  // Imported from a bank or file: not entered in Ufer and not a counterpart Ufer created, which the server treats as entered.
  const imported = !transaction.entered && !transaction.created_counterpart;
  const relinkable = !frozen || (imported && !transaction.counterpart?.entered);
  // A hidden booking is not linked; it can be a transfer to an untracked account until it is shown again.
  const linkable = transfer && !transaction.hidden && relinkable;
  const editsEntry = transaction.entered && !frozen;
  // On an archived account only a bank booking without a link can be hidden: a manual account's balance sums its shown bookings, and hiding ends a link.
  const hideable = imported && !frozen;
  const options = useTransferOptions(transaction.id, linkable);
  const target = chosenTarget ?? storedTarget(transaction, options.data);
  // A split booking stays income or expense, since only those count by category; the stored type stays listed.
  const typeAllowed = (option: TransactionType) => !splitOpen || option === "income" || option === "expense";
  const canSplit = type === "income" || type === "expense";
  // A bank-linked account's opening balance or adjustment keeps its type.
  const balanceRow = !transaction.manual_account && manualAccountTypes.includes(transaction.type);
  const editableTypes = balanceRow ? [transaction.type] : entryTransactionTypes.filter(option => option === transaction.type || (typeAllowed(option) && (transaction.manual_account || !manualAccountTypes.includes(option))));
  const available = frozen ? frozenTypes(transaction, relinkable) : editableTypes;
  // A frozen booking becomes a transfer only by linking an existing booking.
  const linkMissing = frozen && transfer && transaction.type !== "transfer" && target.kind !== "booking";
  // Without loaded options, saving a transfer could drop a link the form cannot show.
  const targetUnknown = linkable && options.status !== "success";

  // Awaited promises rather than per-call callbacks, so the category step still runs when the details' refresh removes the row and this dialog. A failed step keeps the dialog open, and saving again repeats the idempotent writes.
  // The details and the split are one server write, so a changed amount and its parts are stored together or not at all; a plain category follows once they are stored.
  async function saveAll(details: TransactionEdit | EntryEdit) {
    const keepsSplit = splitOpen && split.status === "ready";
    const removesSplit = transaction.split !== null && !keepsSplit;
    let splitEdit: Pick<TransactionEdit, "split" | "remove_split"> = {};

    if (keepsSplit) {
      splitEdit = {
        split: {
          parts: draftEdits(draft, splitBasis)
        }
      };
    } else if (removesSplit) {
      splitEdit = {
        remove_split: true
      };
    }

    try {
      await save.mutateAsync({
        ...details,
        ...splitEdit
      });
    } catch {
      // The details mutation's error is shown from its state.
      return;
    }

    if (keepsSplit) {
      close();

      return;
    }

    try {
      await saveCategory();
      close();
    } catch (failure) {
      setFollowFailure(toFailure(failure));
    }
  }

  // A split with a single counted part is a plain category; parts with an amount of 0 are ignored. Categories are compared with the stored ones, not the ones the dialog started from: a row change that was pending at opening and then failed is assigned again.
  async function saveCategory() {
    const counted = draft.parts.find((_, index) => split.amounts[index] !== 0);
    const chosen = splitOpen ? counted?.categoryId ?? null : category;

    if (chosen !== transaction.category_id || (transaction.split && splitOpen)) {
      await assignment.assign(chosen);
    }
  }


  return (
    <form
      className={ui["form"]}
      onSubmit={event => {
        event.preventDefault();

        // A frozen booking sends its link only when it changes, since keeping it is not a link change.
        const keepsLink = frozen && type === transaction.type && selectValue(target) === selectValue(storedTarget(transaction, options.data));
        const edit: TransactionEdit = linkable && !keepsLink ? {
          type,
          transfer: transferEdit(target)
        } : {
          type
        };
        const details = detailsEdit(edit, new FormData(event.currentTarget), transaction, imported, editsEntry);

        if (splitBlocked || pending) {
          return;
        }

        setFollowFailure(null);
        setSaving(true);
        void saveAll(details).finally(() => setSaving(false));
      }}
    >
      {/* Every control waits while the save runs, since the request carries the values as they were when Save was pressed. */}
      <fieldset className={styles["busy"]} disabled={pending}>
        <TransactionFacts transaction={transaction}>
          <Select
            className={styles["type-control"]}
            aria-label="Type"
            name="type"
            value={type}
            disabled={available.length < 2}
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
          {type === transaction.type && transaction.type_source === "auto" && transaction.type_rule_id !== null && <p className={ui["form-hint"]}>Type set by a rule.</p>}
          {frozen && <p className={ui["form-hint"]}>{frozenHint(transaction)}</p>}
          {transaction.hidden && hideable && <ShowAgain transaction={transaction} close={close} />}
          {imported && <ImportedTextFields transaction={transaction} />}
          {editsEntry && (
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
              frozen={frozen}
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
          <button className={clsx(ui["button"], ui["primary"])} disabled={pending || targetUnknown || splitBlocked || linkMissing}>
            Save <Check size={16} />
          </button>
          {editsEntry && (
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
          {hideable && !transaction.hidden && (
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
          {onTrade && (
            <button
              type="button"
              className={ui["button"]}
              disabled={pending}
              onClick={onTrade}
            >
              <ChartNoAxesCombined size={15} />
              Record as trade
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

/** The types a frozen booking can take: its own, and for an imported booking a link with an existing booking or the end of its link. */
function frozenTypes(transaction: Transaction, relinkable: boolean): TransactionType[] {
  if (!relinkable) {
    return [transaction.type];
  }

  if (transaction.type !== "transfer") {
    return [transaction.type, "transfer"];
  }

  const derived = derivedTransactionType(transaction.amount_minor);

  return transaction.counterpart && derived !== "transfer" ? ["transfer", derived] : ["transfer"];
}

/** Why the balance is fixed: the booking's own account or its counterpart's is archived. */
function frozenHint(transaction: Transaction) {
  const archived = transaction.account_archived ? transaction.account_name : transaction.counterpart?.account_name ?? "the linked account";

  return `${archived} is archived, so this booking keeps its amount, date and balance effect. Its category, split, payee and description can still change, and an imported booking can be linked with an existing booking or unlinked.`;
}

function detailsEdit(edit: TransactionEdit, data: FormData, transaction: Transaction, imported: boolean, editsEntry: boolean): TransactionEdit | EntryEdit {
  if (editsEntry) {
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
    date: String(data.get("date")),
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
  const locale = useLocale();
  const remove = target.kind === "none";

  return (
    <div className={styles["created"]}>
      <p className={ui["form-hint"]}>Created for the transfer of {bookingLabel(source, locale)}.</p>
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

/** The manual accounts offered for a counterpart: those a new one may be created on, plus the account of a counterpart chosen through its account. */
function counterpartAccounts(transaction: Transaction, options: TransferOptions, frozen: boolean) {
  const accounts = frozen ? [] : options.accounts;
  const stored = options.counterpart;

  if (!stored || !linkedThroughAccount(transaction, stored) || accounts.some(account => account.id === stored.account_id)) {
    return accounts;
  }

  return [{
    id: stored.account_id,
    name: stored.account_name
  }, ...accounts];
}

/** The account the counterpart select shows: the chosen one, else the stored one, else the first. */
function shownAccount(target: Target, stored: Target, accounts: TransferOptions["accounts"]) {
  if (target.kind === "account") {
    return target.accountId;
  }

  if (stored.kind === "account") {
    return stored.accountId;
  }

  return accounts[0]?.id ?? "";
}

function BookingChoice({ booking }: {
  booking: TransferBooking
}) {
  const locale = useLocale();
  const date = describeDate(Temporal.PlainDate.from(booking.date), locale).label;
  const details = [date, booking.counterparty, booking.description].filter(Boolean).join(" · ");

  return (
    <span className={styles["choice-body"]}>
      <span className={styles["choice-head"]}>
        <span className={styles["choice-title"]}>{booking.account_name}</span>
        <span className={styles["choice-amount"]}>{signedMoney(booking.amount_minor, booking.currency, locale)}</span>
      </span>
      <span className={styles["choice-text"]}>{details}</span>
    </span>
  );
}

/** One stacked radio group: matching bookings on other accounts, a counterpart on each manual account, or no counterpart. */
function TransferFields({
  transaction,
  options,
  target,
  onTarget,
  frozen
}: {
  transaction: Transaction;
  options: ReturnType<typeof useTransferOptions>;
  target: Target;
  onTarget: (target: Target) => void;
  /** Whether either account is archived, so no counterpart may be created on a manual account. */
  frozen: boolean;
}) {
  const hintId = useId();
  const accountChoiceId = useId();

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
  const stored = storedTarget(transaction, options.data);
  const accounts = counterpartAccounts(transaction, options.data, frozen);
  const direction = transaction.amount_minor < 0 ? "to" : "from";
  const accountId = shownAccount(target, stored, accounts);

  return (
    <fieldset className={styles["choices"]} aria-describedby={suggestions.length > 0 ? hintId : undefined}>
      <legend>Counterpart</legend>
      {suggestions.length > 0 && <p id={hintId} className={styles["choices-hint"]}>Bookings with the opposite amount within two weeks, or a new counterpart.</p>}
      {suggestions.map(booking => (
        <label key={booking.id} className={styles["choice"]}>
          <input
            type="radio"
            name="counterpart"
            value={`booking:${booking.id}`}
            checked={target.kind === "booking" && target.booking.id === booking.id}
            onChange={() => onTarget({
              kind: "booking",
              booking
            })}
          />
          <BookingChoice booking={booking} />
        </label>
      ))}
      {accounts.length > 0 && (
        <div className={styles["choice"]}>
          <input
            id={accountChoiceId}
            type="radio"
            name="counterpart"
            value="account"
            checked={target.kind === "account"}
            onChange={() => onTarget({
              kind: "account",
              accountId: accountId
            })}
          />
          <span className={styles["choice-body"]}>
            <label htmlFor={accountChoiceId} className={styles["choice-title"]}>{stored.kind === "account" ? "Counterpart on" : "Create a counterpart on"}</label>
            <Select
              aria-label="Manual account"
              value={accountId}
              onChange={event => onTarget({
                kind: "account",
                accountId: event.target.value
              })}
            >
              {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
            </Select>
          </span>
        </div>
      )}
      <label className={styles["choice"]}>
        <input
          type="radio"
          name="counterpart"
          value=""
          checked={target.kind === "none"}
          onChange={() => onTarget(noTarget)}
        />
        <span className={styles["choice-body"]}>
          <span className={styles["choice-title"]}>No counterpart</span>
          <span className={styles["choice-meta"]}>{`Transfer ${direction} an account not tracked in Ufer.`}</span>
        </span>
      </label>
    </fieldset>
  );
}
