"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
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
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Archive account" onClose={close}>
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
  const locale = useLocale();

  return (
    <div className={ui["form"]}>
      <p className={ui["form-description"]}>
        {account.name} · {money(account.balance_minor ?? 0, account.currency, locale)}
      </p>
      <p>An account can only be archived with a balance of 0. This account's balance follows its bank bookings, so Ufer cannot book it away. Archive it once its bookings bring the balance to 0.</p>
      <button type="button" className={clsx(ui["button"], ui["full-width"])} onClick={close}>Cancel</button>
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
      <p>An account can only be archived with a balance of 0. Ufer books the remaining {money(remaining, account.currency, locale)} away, then archives the account.</p>
      <label>
        Book the balance as
        <Select name="transfer_account_id" defaultValue="">
          <option value="">Adjustment, no other account</option>
          {transferAccounts.map(other => (
            <option key={other.id} value={other.id}>Transfer to {other.name}</option>
          ))}
        </Select>
      </label>
      <label>
        Closing date
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
        >Cancel</button>
        <button className={clsx(ui["button"], ui["primary"])} disabled={pending}>
          <Archive size={15} />
          Close and archive
        </button>
      </div>
    </form>
  );
}
