"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./balance-import-dialog.module.css";
import { ArrowDownToLine } from "lucide-react";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useBalanceImport } from "@/features/imports/mutations";
import { FormError } from "@/components/ui/form-error";
import { Dialog } from "@/components/ui/dialog";
import type { Account } from "@/features/accounts/types";

type Props = DialogFormProps & {
  account: Account;
};

/** Imports a balance series into one manual account; each balance is booked as an opening balance or an adjustment. */
export function BalanceImportDialog({
  close,
  account
}: Props) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Import balances" onClose={close}>
      <BalanceImportForm close={close} account={account} />
    </Dialog>
  );
}

function BalanceImportForm({
  close,
  account
}: Props) {
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useBalanceImport(), close);

  return (
    <form
      onSubmit={event => submit(event, data => ({
        accountId: account.id,
        file: data.get("file") as File
      }))}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>{account.name} · {account.currency}</p>
      <label>
        CSV file
        <input
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
        />
      </label>
      <div className={styles["csv-example"]}>
        <span>Expected format · comma or semicolon</span>
        <pre>{`date;balance;currency\n2026-11-15;12500.00;${account.currency}`}</pre>
      </div>
      <p className={ui["form-hint"]}>Each balance becomes the account balance at the end of its date; the difference is booked as an adjustment.</p>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        Import balances <ArrowDownToLine size={16} />
      </button>
    </form>
  );
}
