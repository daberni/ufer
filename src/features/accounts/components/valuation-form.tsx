"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("accounts");

  return (
    <Dialog eyebrow={t("dialogEyebrow")} title={t("valuation.title")} onClose={close}>
      <ValuationForm close={close} selectedAccount={selectedAccount} />
    </Dialog>
  );
}

function ValuationForm({
  close,
  selectedAccount
}: Props) {
  const t = useTranslations("accounts.valuation");
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
        {t("balance")}
        <input
          name="balance"
          required
          inputMode="decimal"
          placeholder="0.00"
        />
      </label>
      <label>
        {t("date")}
        <input
          name="date"
          type="date"
          required
          defaultValue={latestDate}
          max={latestDate}
        />
      </label>
      <p className={ui["form-hint"]}>{t("hint")}</p>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        {t("submit")} <Check size={16} />
      </button>
    </form>
  );
}
