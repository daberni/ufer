"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./account-removal-dialogs.module.css";

import { useState } from "react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("accounts");

  return (
    <Dialog eyebrow={t("dialogEyebrow")} title={t("delete.title")} onClose={close}>
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
  const t = useTranslations("accounts.delete");
  const changeView = useChangeView();
  const [mismatch, setMismatch] = useState(false);
  const remove = useDeleteAccount(account.id, () => {
    close();
    changeView("accounts");
  });
  const pending = remove.isPending;
  const requestFailure = remove.error ? toFailure(remove.error) : null;
  const failure = mismatch ? {
    message: t("mismatch")
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
      <p className={clsx(ui["notice"], ui["error"])}>{t("warning")}</p>
      <ul className={styles["effects"]}>
        <li>{t("effectBookings")}</li>
        <li>{t("effectTransfers")}</li>
        <li>{t("effectRules")}</li>
      </ul>
      <label>
        {t("confirmLabel")}
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
        >{t("cancel")}</button>
        <button className={ui["danger-button"]} disabled={pending}>
          <Trash2 size={15} />
          {t("submit")}
        </button>
      </div>
    </form>
  );
}
