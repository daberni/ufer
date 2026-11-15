"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Check } from "lucide-react";
import { api } from "@/client/api";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import type { DialogFormProps } from "@/features/dashboard/use-dialog-submit";
import { FormError } from "@/components/ui/form-error";

type Props = Pick<DashboardController, "busy" | "selectedAccount"> & DialogFormProps;

export function ValuationForm({
  busy,
  error,
  selectedAccount,
  submit
}: Props) {
  if (!selectedAccount) {
    return null;
  }

  return (
    <form
      onSubmit={event => submit(event, async data => {
        await api(`accounts/${selectedAccount.id}/balance`, Object.fromEntries(data));
      })}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>
        {selectedAccount.name} · {selectedAccount.currency}
      </p>
      <label>
        New balance
        <input
          name="balance"
          required
          inputMode="decimal"
          placeholder="0.00"
        />
      </label>
      <label>
        Valuation date
        <input
          name="date"
          type="date"
          required
          defaultValue={new Date().toISOString().slice(0, 10)}
          max={new Date().toISOString().slice(0, 10)}
        />
      </label>
      <FormError message={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={busy}>
        Save balance <Check size={16} />
      </button>
    </form>
  );
}
