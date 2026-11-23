"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import { useAccountKindLabel } from "./use-account-kind-label";
import { Check } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { useEditAccount } from "@/features/accounts/mutations";
import type { Account } from "@/features/accounts/types";
import ui from "../../../components/ui/primitives.module.css";
import { AccountTypeChoice } from "./account-type-choice";
import type { AccountKind } from "../account-kinds";

/** Renames an account and, for an active manual account, changes its type; switching accounts closes it. */
export function EditAccountDialog({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  const t = useTranslations("accounts");

  return (
    <Dialog eyebrow={t("dialogEyebrow")} title={t("edit.title")} onClose={close}>
      <EditAccountForm account={account} close={close} />
    </Dialog>
  );
}

function EditAccountForm({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  const t = useTranslations("accounts.edit");
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useEditAccount(account.id), close);
  const [kind, setKind] = useState(account.kind as AccountKind);
  // A bank-synced account keeps its bank's type, and an archived account is read-only until it is restored.
  const typeEditable = account.provider === "manual" && account.kind !== "brokerage" && account.archived_at === null;

  return (
    <form className={ui["form"]} onSubmit={event => submit(event, data => Object.fromEntries(data))}>
      <label>
        {t("name")}
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={account.name}
          autoFocus
        />
      </label>
      {account.provider_name && account.provider_name !== account.name && (
        <p className={ui["form-hint"]}>{t("bankName", {
          name: account.provider_name
        })}</p>
      )}
      {typeEditable ? (
        <AccountTypeChoice
          selected={kind}
          onSelect={choice => choice !== "brokerage" && setKind(choice)}
          legend={t("type")}
          ledgerOnly
        />
      ) : <AccountTypeNote account={account} />}
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        {t("save")} <Check size={16} />
      </button>
    </form>
  );
}

// Which note explains why the type cannot be changed.
function accountTypeNote(account: Account) {
  if (account.kind === "brokerage") {
    return "brokerageNote";
  }

  return account.provider === "manual" ? "archivedNote" : "bankNote";
}

function AccountTypeNote({ account }: {
  account: Account
}) {
  const t = useTranslations("accounts.edit");
  const kindLabel = useAccountKindLabel();

  return (
    <p className={ui["form-hint"]}>
      {t.rich(accountTypeNote(account), {
        type: kindLabel(account.kind),
        strong: chunks => <strong>{chunks}</strong>
      })}
    </p>
  );
}
