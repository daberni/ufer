"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useState } from "react";
import styles from "./csv-import-form.module.css";
import { ArrowDownToLine } from "lucide-react";
import { useDialogSubmit, type DialogFormProps } from "@/features/dashboard/use-dialog-submit";
import { useCsvImport, type ImportMode } from "@/features/imports/mutations";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { useAccounts } from "@/features/accounts/queries";
import { InlineFailure } from "@/features/dashboard/components/area-placeholder";
import { useAreaResult } from "@/features/dashboard/use-area-result";

type Props = DialogFormProps & {
  initialMode: ImportMode;
};

export function CsvImportDialog({
  close,
  initialMode
}: Props) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Import CSV" onClose={close}>
      <CsvImportForm close={close} initialMode={initialMode} />
    </Dialog>
  );
}

function CsvImportForm({
  close,
  initialMode
}: Props) {
  const [importMode, setImportMode] = useState(initialMode);
  const accounts = useAreaResult(useAccounts());
  const accountsPending = accounts.status === "pending";
  const accountsFailure = accountsPending ? accounts.failure : null;
  const manualAccounts = accounts.data?.filter(account => account.provider === "manual") ?? [];
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useCsvImport(), close);

  return (
    <form
      onSubmit={event => submit(event, data => ({
        mode: importMode,
        accountId: String(data.get("account_id")),
        file: data.get("file") as File
      }))}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>Import balances or booked transactions into a manual account. Files must use the format below; map bank exports to these columns first.</p>
      <label>
        Import
        <Select value={importMode} onChange={event => setImportMode(event.target.value as ImportMode)}>
          <option value="balances">Investment / account balances</option>
          <option value="transactions">Booked transactions</option>
        </Select>
      </label>
      <label>
        Target account
        <Select name="account_id" required disabled={accountsPending}>
          <option value="">{targetPlaceholder(accounts.status, accountsFailure !== null)}</option>
          {manualAccounts.map(account => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.currency})
            </option>
          ))}
        </Select>
      </label>
      {accountsFailure && <InlineFailure failure={accountsFailure} subject="Your accounts" />}
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
        <pre>{importMode === "balances" ? "date;balance;currency\n2026-11-15;12500.00;EUR" : "id;date;amount;currency;counterparty;description\nentry-001;2026-11-15;-12.50;EUR;Supermarket;Purchase"}</pre>
      </div>
      <p className={ui["form-hint"]}>{importMode === "balances" ? "Multiple valuation dates are supported. The latest balance is used." : "IDs must be stable and unique within an account. Reimporting updates existing transactions. Update the account balance separately."}</p>
      <FormError message={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !manualAccounts.length}>
        Import CSV <ArrowDownToLine size={16} />
      </button>
    </form>
  );
}

function targetPlaceholder(status: string, failed: boolean) {
  if (failed) {
    return "Accounts unavailable";
  }

  return status === "pending" ? "Loading accounts …" : "Select account";
}
