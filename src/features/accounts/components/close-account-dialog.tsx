"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import { Archive } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { money } from "@/lib/money";
import { today } from "@/lib/time";
import { useArchiveAccount } from "@/features/accounts/mutations";
import { activeAccounts, bookableManualAccounts, useAccounts } from "@/features/accounts/queries";
import type { Account } from "@/features/accounts/types";
import { useLocale } from "@/client/locale-provider";

/** Archiving a remaining balance: closes a manual account onto another account or an adjustment, or explains why a bank account cannot be closed. */
export function CloseAccountDialog({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  const t = useTranslations("accounts");

  return (
    <Dialog eyebrow={t("dialogEyebrow")} title={t("archive.title")} onClose={close}>
      <ArchiveDialogContent account={account} close={close} />
    </Dialog>
  );
}

function ArchiveDialogContent({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  return account.provider === "manual" ? <CloseAccountForm account={account} close={close} /> : <BankBalanceNotice account={account} close={close} />;
}

function BankBalanceNotice({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  const t = useTranslations("accounts.archive");
  const locale = useLocale();

  return (
    <div className={ui["form"]}>
      <p className={ui["form-description"]}>
        {account.name} · {money(account.balance_minor ?? 0, account.currency, locale)}
      </p>
      <p>{t("bankNotice")}</p>
      <button type="button" className={clsx(ui["button"], ui["full-width"])} onClick={close}>{t("cancel")}</button>
    </div>
  );
}

function CloseAccountForm({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  const t = useTranslations("accounts.archive");
  const locale = useLocale();
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useArchiveAccount(account.id), close);
  const transferAccounts = bookableManualAccounts(activeAccounts(useAccounts().data ?? [])).filter(other => other.currency === account.currency && other.id !== account.id);
  const latestDate = today().toString();
  // A manual account's balance date is its latest booking; the closing cannot precede it.
  const remaining = account.balance_minor ?? 0;

  return (
    <form
      className={ui["form"]}
      onSubmit={event => submit(event, data => ({
        closing: {
          date: String(data.get("date")),
          balance_minor: remaining,
          transfer_account_id: String(data.get("transfer_account_id")) || null
        }
      }))}
    >
      <p className={ui["form-description"]}>
        {account.name} · {money(remaining, account.currency, locale)}
      </p>
      <p>{t("manualNotice", {
        amount: money(remaining, account.currency, locale)
      })}</p>
      <label>
        {t("bookAs")}
        <Select name="transfer_account_id" defaultValue="">
          <option value="">{t("adjustment")}</option>
          {transferAccounts.map(other => (
            <option key={other.id} value={other.id}>{t("transferTo", {
              name: other.name
            })}</option>
          ))}
        </Select>
      </label>
      <label>
        {t("closingDate")}
        <input
          name="date"
          type="date"
          required
          defaultValue={latestDate}
          min={account.balance_date ?? undefined}
          max={latestDate}
        />
      </label>
      <FormError failure={error} />
      <div className={ui["form-actions"]}>
        <button
          type="button"
          className={ui["button"]}
          disabled={pending}
          onClick={close}
        >{t("cancel")}</button>
        <button className={clsx(ui["button"], ui["primary"])} disabled={pending}>
          <Archive size={15} />
          {t("submit")}
        </button>
      </div>
    </form>
  );
}
