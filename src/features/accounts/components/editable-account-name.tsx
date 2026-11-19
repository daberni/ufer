"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Check, Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { useRenameAccount } from "@/features/accounts/mutations";
import type { Account } from "@/features/accounts/types";
import ui from "../../../components/ui/primitives.module.css";
import styles from "./editable-account-name.module.css";

/** The account's page heading is also its rename action; switching accounts closes the dialog. */
export function EditableAccountName({ account }: {
  account: Account
}) {
  const [editing, setEditing] = useState(false);
  const close = () => setEditing(false);

  return (
    <>
      <button className={styles["name"]} aria-label={`Rename account: ${account.name}`} onClick={() => setEditing(true)}>
        <span>{account.name}</span>
        <Pencil className={styles["hint"]} size={18} aria-hidden="true" />
      </button>
      {editing && <RenameAccountDialog account={account} close={close} />}
    </>
  );
}

function RenameAccountDialog({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Rename account" onClose={close}>
      <RenameAccountForm account={account} close={close} />
    </Dialog>
  );
}

function RenameAccountForm({
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
  } = useDialogSubmit(useRenameAccount(account.id), close);

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
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        Save name <Check size={16} />
      </button>
    </form>
  );
}
