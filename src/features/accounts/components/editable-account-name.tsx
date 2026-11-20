"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Check, Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { kinds } from "@/features/accounts/account-presentation";
import { useEditAccount } from "@/features/accounts/mutations";
import type { Account } from "@/features/accounts/types";
import ui from "../../../components/ui/primitives.module.css";
import styles from "./editable-account-name.module.css";
import { AccountTypeChoice } from "./account-type-choice";
import type { AccountKind } from "../account-kinds";

/** The account's page heading is also its edit action; switching accounts closes the dialog. */
export function EditableAccountName({ account }: {
  account: Account
}) {
  const [editing, setEditing] = useState(false);
  const close = () => setEditing(false);

  return (
    <>
      <button className={styles["name"]} aria-label={`Edit account: ${account.name}`} onClick={() => setEditing(true)}>
        <span>{account.name}</span>
        <Pencil className={styles["hint"]} size={18} aria-hidden="true" />
      </button>
      {editing && <EditAccountDialog account={account} close={close} />}
    </>
  );
}

function EditAccountDialog({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Edit account" onClose={close}>
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
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useEditAccount(account.id), close);
  const [kind, setKind] = useState(account.kind as AccountKind);
  // A bank-synced account keeps its bank's type, and an archived account is read-only until it is restored.
  const typeEditable = account.provider === "manual" && account.archived_at === null;

  return (
    <form className={ui["form"]} onSubmit={event => submit(event, data => Object.fromEntries(data))}>
      <label>
        Account name
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={account.name}
          autoFocus
        />
      </label>
      {typeEditable ? <AccountTypeChoice selected={kind} onSelect={setKind} legend="Account type" /> : <AccountTypeNote account={account} />}
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        Save <Check size={16} />
      </button>
    </form>
  );
}

function AccountTypeNote({ account }: {
  account: Account
}) {
  const reason = account.provider === "manual" ? "Restore the account to change its type." : "A bank-synced account keeps the type from its bank connection.";

  return (
    <p className={ui["form-hint"]}>
      Account type: <strong>{kinds[account.kind] ?? account.kind}</strong>. {reason}
    </p>
  );
}
