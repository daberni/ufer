"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./csv-import-form.module.css";
import { ArrowDownToLine } from "lucide-react";
import { api } from "@/client/api";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import type { DialogFormProps } from "@/features/dashboard/use-dialog-submit";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";

type Props = Pick<DashboardController, "busy" | "importMode" | "setImportMode" | "state"> & DialogFormProps;

export function CsvImportForm({
  busy,
  error,
  importMode,
  setImportMode,
  state,
  submit
}: Props) {
  if (!state) {
    return null;
  }

  return (
    <form
      onSubmit={event => submit(event, async data => {
        const file = data.get("file") as File;

        if (file.size > 1_000_000) {
          throw new Error("The file cannot exceed 1 MB.");
        }

        await api(`imports/${importMode}`, {
          account_id: data.get("account_id"),
          csv: await file.text()
        });
      })}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>Import balances or booked transactions into a manual account. Files must use the format below; map bank exports to these columns first.</p>
      <label>
        Import
        <Select value={importMode} onChange={event => setImportMode(event.target.value)}>
          <option value="balances">Investment / account balances</option>
          <option value="transactions">Booked transactions</option>
        </Select>
      </label>
      <label>
        Target account
        <Select name="account_id" required>
          <option value="">Select account</option>
          {state?.accounts.filter(account => account.provider === "manual").map(account => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.currency})
            </option>
          ))}
        </Select>
      </label>
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
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={busy || !state?.accounts.some(account => account.provider === "manual")}>
        Import CSV <ArrowDownToLine size={16} />
      </button>
    </form>
  );
}
