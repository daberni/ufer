"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./account-removal-dialogs.module.css";

import { useState } from "react";
import { clsx } from "clsx";
import { Trash2 } from "lucide-react";
import { toFailure } from "@/client/api";
import { useChangeView } from "@/client/use-app-url";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { useDeleteAccount } from "@/features/accounts/mutations";
import type { Account } from "@/features/accounts/types";

/** Deleting applies only to accounts without a bank connection and is confirmed with the account's exact name. */
export function DeleteAccountDialog({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Delete account" onClose={close}>
      <DeleteForm account={account} close={close} />
    </Dialog>
  );
}

function DeleteForm({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  const changeView = useChangeView();
  const [mismatch, setMismatch] = useState(false);
  const remove = useDeleteAccount(account.id, () => {
    close();
    changeView("accounts");
  });
  const pending = remove.isPending;
  const requestFailure = remove.error ? toFailure(remove.error) : null;
  const failure = mismatch ? {
    message: "Enter the account's exact name to confirm the deletion."
  } : requestFailure;

  return (
    <form
      className={ui["form"]}
      onSubmit={event => {
        event.preventDefault();
        const name = String(new FormData(event.currentTarget).get("name"));

        setMismatch(name !== account.name);

        if (name !== account.name) {
          return;
        }

        remove.mutate({
          name
        });
      }}
    >
      <p className={ui["form-description"]}>{account.name}</p>
      <p className={clsx(ui["notice"], ui["error"])}>Deleting cannot be undone. To keep the history in reports, archive the account instead.</p>
      <ul className={styles["effects"]}>
        <li>All bookings of this account, their splits and its balance history are deleted. Net worth and cash flow no longer include them.</li>
        <li>Transfers linked to bookings on other accounts stay there with their amounts, as transfers without a counterpart.</li>
        <li>Rules that named this account as transfer target keep the transfer type without a counterpart account.</li>
      </ul>
      <label>
        Type the account name to confirm
        <input
          name="name"
          autoComplete="off"
          required
        />
      </label>
      <FormError failure={failure} />
      <div className={ui["form-actions"]}>
        <button
          type="button"
          className={ui["button"]}
          disabled={pending}
          onClick={close}
        >Cancel</button>
        <button className={ui["danger-button"]} disabled={pending}>
          <Trash2 size={15} />
          Delete permanently
        </button>
      </div>
    </form>
  );
}
