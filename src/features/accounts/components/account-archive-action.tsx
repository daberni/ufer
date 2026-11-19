"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useState } from "react";
import { clsx } from "clsx";
import { Archive, ArchiveRestore } from "lucide-react";
import { toFailure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { money } from "@/lib/money";
import { today } from "@/lib/time";
import { useArchiveAccount, useRestoreAccount } from "@/features/accounts/mutations";
import { activeAccounts, useAccounts } from "@/features/accounts/queries";
import type { Account } from "@/features/accounts/types";

/** Archiving needs a balance of 0; a remaining balance opens a dialog that closes a manual account or explains why a bank account cannot be closed. */
export function AccountArchiveAction({ account }: {
  account: Account
}) {
  return account.archived_at === null ? <ArchiveButton account={account} /> : <RestoreButton account={account} />;
}

function RestoreButton({ account }: {
  account: Account
}) {
  const restore = useRestoreAccount(account.id);

  return (
    <>
      <button className={ui["button"]} disabled={restore.isPending} onClick={() => restore.mutate()}>
        <ArchiveRestore size={15} />
        Restore account
      </button>
      <FormError failure={restore.error ? toFailure(restore.error) : null} />
    </>
  );
}

function ArchiveButton({ account }: {
  account: Account
}) {
  const archive = useArchiveAccount(account.id);
  const [closing, setClosing] = useState(false);
  // A manual account without bookings has a balance of 0; only a bank balance can be unknown.
  const settled = account.balance_minor === 0 || (account.provider === "manual" && account.balance_minor === null);

  return (
    <>
      <button className={ui["button"]} disabled={archive.isPending} onClick={() => settled ? archive.mutate({}) : setClosing(true)}>
        <Archive size={15} />
        Archive account
      </button>
      <FormError failure={archive.error && !closing ? toFailure(archive.error) : null} />
      {closing && <CloseAccountDialog account={account} close={() => setClosing(false)} />}
    </>
  );
}

function CloseAccountDialog({
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
  if (account.provider !== "manual" && account.balance_minor === null) {
    return <UnknownBalanceNotice account={account} close={close} />;
  }

  return account.provider === "manual" ? <CloseAccountForm account={account} close={close} /> : <BankBalanceNotice account={account} close={close} />;
}

function UnknownBalanceNotice({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  return (
    <div className={ui["form"]}>
      <p className={ui["form-description"]}>{account.name}</p>
      <p>No balance known yet. An account can only be archived with a balance of 0.</p>
      <button type="button" className={clsx(ui["button"], ui["full-width"])} onClick={close}>Cancel</button>
    </div>
  );
}

function BankBalanceNotice({
  account,
  close
}: {
  account: Account;
  close: () => void
}) {
  return (
    <div className={ui["form"]}>
      <p className={ui["form-description"]}>
        {account.name} · {money(account.balance_minor ?? 0, account.currency)}
      </p>
      <p>An account can only be archived with a balance of 0. This account's balance comes from the bank, so Ufer cannot book it away. Archive it once the bank reports a balance of 0.</p>
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
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useArchiveAccount(account.id), close);
  const transferAccounts = activeAccounts(useAccounts().data ?? []).filter(other => other.provider === "manual" && other.currency === account.currency && other.id !== account.id);
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
        {account.name} · {money(remaining, account.currency)}
      </p>
      <p>An account can only be archived with a balance of 0. Ufer books the remaining {money(remaining, account.currency)} away, then archives the account.</p>
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
