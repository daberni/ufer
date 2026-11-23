"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useState } from "react";
import { clsx } from "clsx";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { automaticCategory, CategoryPicker, type CategoryAssignmentValue } from "@/features/categorization/components/category-picker";
import { useCategories } from "@/features/categorization/queries";
import { entryTransactionTypes, isTransactionType, type TransactionType } from "@/lib/transaction-types";
import { useEnterTransaction, type NewEntry } from "@/features/transactions/mutations";
import type { Account } from "@/features/accounts/types";
import { EntryFields, suggestedType } from "./entry-fields";
import { useTranslations } from "next-intl";

type Props = {
  /** The manual accounts a transaction can be entered on or transferred to. */
  accounts: Account[];
  /** Enters the transaction on this account; without it, the form offers a choice. */
  accountId?: string;
  close: () => void;
};

/** Enters a transaction on a manual account; a transfer to another manual account books its other side there as well. */
export function ManualTransactionDialog({
  accounts,
  accountId,
  close
}: Props) {
  const t = useTranslations("transactions.manual");

  return (
    <Dialog eyebrow={t("eyebrow")} title={t("title")} onClose={close}>
      <ManualTransactionForm accounts={accounts} accountId={accountId} close={close} />
    </Dialog>
  );
}

function ManualTransactionForm({
  accounts,
  accountId,
  close
}: Props) {
  const t = useTranslations("transactions");
  const [chosenAccountId, setAccountId] = useState(accountId ?? accounts[0]?.id ?? "");
  const [type, setType] = useState<TransactionType>("expense");
  const [typeChosen, setTypeChosen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [category, setCategory] = useState<CategoryAssignmentValue>(automaticCategory);
  const categories = useCategories();
  const typeId = useId();
  const categoryFieldId = useId();
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useEnterTransaction(), close);
  const account = accounts.find(item => item.id === chosenAccountId);
  const targets = accounts.filter(item => item.id !== chosenAccountId && item.currency === account?.currency);
  const transfer = type === "transfer";
  const target = transfer ? targets.find(item => item.id === targetId) : undefined;

  function entry(data: FormData): NewEntry {
    const fields = {
      date: String(data.get("date")),
      amount: String(data.get("amount")),
      counterparty: String(data.get("counterparty") ?? ""),
      description: String(data.get("description") ?? ""),
      category_id: category === automaticCategory ? undefined : category,
      type
    };

    if (!transfer) {
      return fields;
    }

    return {
      ...fields,
      transfer: target ? {
        account_id: target.id
      } : null
    };
  }

  return (
    <form
      className={ui["form"]}
      onSubmit={event => submit(event, data => ({
        accountId: chosenAccountId,
        entry: entry(data)
      }))}
    >
      {accountId && account ? (
        <p className={ui["form-description"]}>{account.name} · {account.currency}</p>
      ) : (
        <label>
          {t("manual.account")}
          <Select value={chosenAccountId} onChange={event => setAccountId(event.target.value)}>
            {accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </label>
      )}
      <EntryFields
        payee={!target}
        onAmount={amount => {
          const suggested = suggestedType(amount);

          if (!typeChosen && suggested) {
            setType(suggested);
          }
        }}
      />
      <div className={ui["field"]}>
        <label htmlFor={categoryFieldId}>{t("manual.category")}</label>
        <CategoryPicker
          id={categoryFieldId}
          categories={categories.data ?? []}
          value={category}
          includeAutomatic
          includeUncategorized
          onChange={setCategory}
        />
      </div>
      <p className={ui["form-hint"]}>{t("manual.automaticHint")}</p>
      <label htmlFor={typeId}>
        {t("manual.type")}
        <Select
          id={typeId}
          value={type}
          onChange={event => {
            const value = event.target.value;

            if (isTransactionType(value)) {
              setType(value);
              setTypeChosen(true);
            }
          }}
        >
          {entryTransactionTypes.map(option => <option key={option} value={option}>{t(`types.${option}`)}</option>)}
        </Select>
      </label>
      {transfer && (
        <>
          <label>
            {t("manual.otherAccount")}
            <Select value={target?.id ?? ""} onChange={event => setTargetId(event.target.value)}>
              <option value="">{t("manual.noOtherAccount")}</option>
              {targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
          <p className={ui["form-hint"]} role="status">{target ? t("manual.linkedHint", {
            account: target.name
          }) : t("manual.untrackedHint")}</p>
        </>
      )}
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !account}>
        {t("manual.title")} <Plus size={16} />
      </button>
    </form>
  );
}
