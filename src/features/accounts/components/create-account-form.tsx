"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Plus } from "lucide-react";
import { useState } from "react";
import { kinds } from "@/features/dashboard/presentation";
import { api } from "@/client/api";
import { Select } from "@/components/ui/select";
import { AccountTypeChoice } from "./account-type-choice";
import { accountTypeCopy } from "./account-type-options";
import type { AccountKind } from "../account-kinds";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import type { DialogFormProps } from "@/features/dashboard/use-dialog-submit";
import { FormError } from "@/components/ui/form-error";

type Props = Pick<DashboardController, "busy"> & DialogFormProps;

export function CreateAccountForm({
  busy,
  error,
  submit
}: Props) {
  const [kind, setKind] = useState<AccountKind | null>(null);

  return (
    <form
      onSubmit={event => submit(event, async data => {
        await api("accounts", Object.fromEntries(data));
      })}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>Track an account, investment, property or debt by entering its balance yourself. Bank accounts with online access can also be added through Connect bank.</p>
      <AccountTypeChoice selected={kind} onSelect={setKind} />
      {kind && <AccountDetailsFields busy={busy} error={error} kind={kind} />}
    </form>
  );
}

type DetailsProps = Pick<Props, "busy" | "error"> & {
  kind: AccountKind;
};

function AccountDetailsFields({
  busy,
  error,
  kind
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
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={busy}>
        Add {kinds[kind].toLowerCase()} <Plus size={16} />
      </button>
    </>
  );
}
