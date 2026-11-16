"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Check } from "lucide-react";
import type { Account } from "@/features/dashboard/types";
import { useDialogSubmit, type DialogFormProps } from "@/features/dashboard/use-dialog-submit";
import { useSaveValuation } from "@/features/accounts/mutations";
import { FormError } from "@/components/ui/form-error";

type Props = DialogFormProps & {
  selectedAccount: Account;
};

export function ValuationForm({
  close,
  selectedAccount
}: Props) {
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useSaveValuation(selectedAccount.id), close);

  return (
    <form
      onSubmit={event => submit(event, data => Object.fromEntries(data))}
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
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        Save balance <Check size={16} />
      </button>
    </form>
  );
}
