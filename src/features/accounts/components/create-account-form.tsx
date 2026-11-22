"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./create-account-form.module.css";

import { clsx } from "clsx";
import { Plus } from "lucide-react";
import { useState } from "react";
import { kinds } from "@/features/accounts/account-presentation";
import { Select } from "@/components/ui/select";
import { AccountTypeChoice } from "./account-type-choice";
import { accountTypeCopy } from "./account-type-options";
import type { AccountKind, StoredAccountKind } from "../account-kinds";
import { useCreateBrokerageAccount } from "@/features/securities/mutations";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useCreateAccount } from "@/features/accounts/mutations";
import { FormError } from "@/components/ui/form-error";
import type { Failure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import { today } from "@/lib/time";

export function CreateAccountDialog({ close }: DialogFormProps) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Add account" onClose={close}>
      <CreateAccountForm close={close} />
    </Dialog>
  );
}

function CreateAccountForm({ close }: DialogFormProps) {
  const [kind, setKind] = useState<StoredAccountKind | null>(null);
  const ledger = useDialogSubmit(useCreateAccount(), close);
  const brokerage = useDialogSubmit(useCreateBrokerageAccount(), close);
  const active = kind === "brokerage" ? brokerage : ledger;
  // While either creation runs, the type stays fixed and nothing else is submitted, so switching types cannot create two accounts.
  const pending = ledger.pending || brokerage.pending;

  return (
    <form
      onSubmit={event => {
        if (pending) {
          event.preventDefault();

          return;
        }

        if (kind === "brokerage") {
          brokerage.submit(event, data => Object.fromEntries(data));
        } else {
          ledger.submit(event, accountBody);
        }
      }}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>Track an account, investment, property or debt by entering its balance yourself. Bank accounts with online access can also be added through Connect bank.</p>
      <AccountTypeChoice selected={kind} onSelect={choice => !pending && setKind(choice)} />
      {kind === "brokerage" && <BrokerageFields pending={pending} error={active.error} />}
      {kind && kind !== "brokerage" && <AccountDetailsFields pending={pending} error={active.error} kind={kind} />}
    </form>
  );
}

/** A brokerage account starts empty: its value comes from the trades recorded on it. */
function BrokerageFields({
  error,
  pending
}: {
  error: Failure | null;
  pending: boolean;
}) {
  const copy = accountTypeCopy.brokerage;

  return (
    <>
      <div className={styles["balance-grid"]}>
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
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        Add brokerage account <Plus size={16} />
      </button>
    </>
  );
}

// An empty balance date is omitted so the server records the balance as of today.
function accountBody(data: FormData) {
  const body = Object.fromEntries(data);

  if (body.date === "") {
    delete body.date;
  }

  return body;
}

type DetailsProps = {
  error: Failure | null;
  kind: AccountKind;
  pending: boolean;
};

function AccountDetailsFields({
  error,
  kind,
  pending
}: DetailsProps) {
  const copy = accountTypeCopy[kind];
  const latestDate = today().toString();

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
      <div className={styles["balance-grid"]}>
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
        <label>
          Balance date (optional)
          <input
            name="date"
            type="date"
            max={latestDate}
          />
        </label>
      </div>
      <p className={ui["form-hint"]}>{copy.hint} Leave the balance date empty to record the balance as of today.</p>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        Add {kinds[kind].toLowerCase()} <Plus size={16} />
      </button>
    </>
  );
}
