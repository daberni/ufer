"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./account-removal-dialogs.module.css";

import { useState } from "react";
import { clsx } from "clsx";
import { PenLine, Trash2 } from "lucide-react";
import { toFailure } from "@/client/api";
import { useChangeView } from "@/client/use-app-url";
import { useLocale } from "@/client/locale-provider";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { money } from "@/lib/money";
import { useConvertToManualAccount, useDeleteAccount } from "@/features/accounts/mutations";
import type { Account } from "@/features/accounts/types";

/** Converting applies only to a bank account without a connection; its bookings and history stay. */
export function ConvertAccountDialog({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Convert to manual account" onClose={close}>
      <ConvertForm account={account} close={close} />
    </Dialog>
  );
}

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

function ConvertForm({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  const locale = useLocale();
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useConvertToManualAccount(account.id), close);
  const balance = `The balance of ${money(account.balance_minor ?? 0, account.currency, locale)} stays: it is the sum of the account's bookings, and nothing is booked.`;

  return (
    <form className={ui["form"]} onSubmit={event => submit(event, () => undefined)}>
      <p className={ui["form-description"]}>{account.name}</p>
      <ul className={styles["effects"]}>
        <li>{balance}</li>
        <li>Imported bookings and the balance history stay. You can then update the balance, enter bookings and change the account type.</li>
        <li>The account is no longer tied to its bank: connecting the bank again adds a new account.</li>
      </ul>
      <FormError failure={error} />
      <div className={ui["form-actions"]}>
        <button
          type="button"
          className={ui["button"]}
          disabled={pending}
          onClick={close}
        >Cancel</button>
        <button className={clsx(ui["button"], ui["primary"])} disabled={pending}>
          <PenLine size={15} />
          Convert
        </button>
      </div>
    </form>
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
        <button className={styles["danger"]} disabled={pending}>
          <Trash2 size={15} />
          Delete permanently
        </button>
      </div>
    </form>
  );
}
