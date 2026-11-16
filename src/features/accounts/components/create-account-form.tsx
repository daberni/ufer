"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Plus } from "lucide-react";
import { useState } from "react";
import { kinds } from "@/features/dashboard/presentation";
import { Select } from "@/components/ui/select";
import { AccountTypeChoice } from "./account-type-choice";
import { accountTypeCopy } from "./account-type-options";
import type { AccountKind } from "../account-kinds";
import { useDialogSubmit, type DialogFormProps } from "@/features/dashboard/use-dialog-submit";
import { useCreateAccount } from "@/features/accounts/mutations";
import { FormError } from "@/components/ui/form-error";
import { Dialog } from "@/components/ui/dialog";

export function CreateAccountDialog({ close }: DialogFormProps) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Add account" onClose={close}>
      <CreateAccountForm close={close} />
    </Dialog>
  );
}

function CreateAccountForm({ close }: DialogFormProps) {
  const [kind, setKind] = useState<AccountKind | null>(null);
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useCreateAccount(), close);

  return (
    <form
      onSubmit={event => submit(event, data => Object.fromEntries(data))}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>Track an account, investment, property or debt by entering its balance yourself. Bank accounts with online access can also be added through Connect bank.</p>
      <AccountTypeChoice selected={kind} onSelect={setKind} />
      {kind && <AccountDetailsFields pending={pending} error={error} kind={kind} />}
    </form>
  );
}

type DetailsProps = {
  error: string;
  kind: AccountKind;
  pending: boolean;
};

function AccountDetailsFields({
  error,
  kind,
  pending
}: DetailsProps) {
  const copy = accountTypeCopy[kind];

  return (
    <>
      <label>
        Name
        <input
          name="name"
          required
          maxLength={100}
          placeholder={copy.namePlaceholder}
        />
      </label>
      <label>
        {copy.institutionLabel}
        <input
          name="institution"
          required
          maxLength={100}
          placeholder={copy.institutionPlaceholder}
        />
      </label>
      <div className={ui["form-grid"]}>
        <label>
          {copy.balanceLabel}
          <input
            name="balance"
            required
            inputMode="decimal"
            pattern="[+-]?[0-9]+([.][0-9]+)?"
            placeholder={copy.balancePlaceholder}
          />
        </label>
        <label>
          Currency
          <Select name="currency">
            <option>EUR</option>
            <option>USD</option>
            <option>CHF</option>
            <option>GBP</option>
          </Select>
        </label>
      </div>
      <p className={ui["form-hint"]}>{copy.hint}</p>
      <FormError message={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        Add {kinds[kind].toLowerCase()} <Plus size={16} />
      </button>
    </>
  );
}
