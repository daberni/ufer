"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Check } from "lucide-react";
import type { Account } from "@/features/accounts/types";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useSaveValuation } from "@/features/accounts/mutations";
import { FormError } from "@/components/ui/form-error";
import { today } from "@/lib/time";
import { Dialog } from "@/components/ui/dialog";

type Props = DialogFormProps & {
  selectedAccount: Account;
};

export function ValuationDialog({
  close,
  selectedAccount
}: Props) {
  return (
    <Dialog eyebrow="Your finances" title="Update balance" onClose={close}>
      <ValuationForm close={close} selectedAccount={selectedAccount} />
    </Dialog>
  );
}

function ValuationForm({
  close,
  selectedAccount
}: Props) {
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useSaveValuation(selectedAccount.id), close);
  const latestDate = today().toString();

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
        Balance date
        <input
          name="date"
          type="date"
          required
          defaultValue={latestDate}
          max={latestDate}
        />
      </label>
      <p className={ui["form-hint"]}>The balance is derived from the account's transactions. Saving books the difference to the balance on that date as an adjustment, for example a revaluation.</p>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        Save balance <Check size={16} />
      </button>
    </form>
  );
}
