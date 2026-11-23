"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./create-account-form.module.css";

import { clsx } from "clsx";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/ui/select";
import { AccountTypeChoice } from "./account-type-choice";
import { balancePlaceholder } from "./account-type-options";
import { useTranslations } from "next-intl";
import type { AccountKind, StoredAccountKind } from "../account-kinds";
import { useCreateBrokerageAccount } from "@/features/securities/mutations";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useCreateAccount } from "@/features/accounts/mutations";
import { FormError } from "@/components/ui/form-error";
import type { Failure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import { today } from "@/lib/time";

export function CreateAccountDialog({ close }: DialogFormProps) {
  const t = useTranslations("accounts");

  return (
    <Dialog eyebrow={t("dialogEyebrow")} title={t("create.title")} onClose={close}>
      <CreateAccountForm close={close} />
    </Dialog>
  );
}

function CreateAccountForm({ close }: DialogFormProps) {
  const t = useTranslations("accounts.create");
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
      <p className={ui["form-description"]}>{t("description")}</p>
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
  const t = useTranslations("accounts");

  return (
    <>
      <div className={styles["balance-grid"]}>
        <label>
          {t("create.name")}
          <input
            name="name"
            required
            maxLength={100}
            placeholder={t("types.brokerage.namePlaceholder")}
          />
        </label>
        <label>
          {t("create.currency")}
          <Select name="currency">
            <option>EUR</option>
            <option>USD</option>
            <option>CHF</option>
            <option>GBP</option>
          </Select>
        </label>
      </div>
      <p className={ui["form-hint"]}>{t("types.brokerage.hint")}</p>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        {t("create.addBrokerage")} <Plus size={16} />
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
  const t = useTranslations("accounts");
  const latestDate = today().toString();

  return (
    <>
      <label>
        {t("create.name")}
        <input
          name="name"
          required
          maxLength={100}
          placeholder={t(`types.${kind}.namePlaceholder`)}
        />
      </label>
      <div className={styles["balance-grid"]}>
        <label>
          {t(`types.${kind}.balanceLabel`)}
          <input
            name="balance"
            required
            inputMode="decimal"
            pattern="[+-]?[0-9]+([.][0-9]+)?"
            placeholder={balancePlaceholder(kind)}
          />
        </label>
        <label>
          {t("create.currency")}
          <Select name="currency">
            <option>EUR</option>
            <option>USD</option>
            <option>CHF</option>
            <option>GBP</option>
          </Select>
        </label>
        <label>
          {t("create.balanceDate")}
          <input
            name="date"
            type="date"
            max={latestDate}
          />
        </label>
      </div>
      <p className={ui["form-hint"]}>{t("create.hint", {
        hint: t(`types.${kind}.hint`)
      })}</p>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        {t("create.add", {
          kind
        })} <Plus size={16} />
      </button>
    </>
  );
}
