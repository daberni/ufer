"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./account-detail-actions.module.css";

import { useState } from "react";
import { clsx } from "clsx";
import { Plus } from "lucide-react";
import { ManualTransactionDialog } from "@/features/transactions/components/manual-transaction-dialog";
import type { Account } from "@/features/accounts/types";
import { AccountMenu } from "./account-menu";

/**
 * The selected account's actions in the page heading: its "…" menu and, for an active manual account, "Add transaction", which phones offer inside the menu.
 * Its balance is updated beside the balance. Changing accounts remounts the actions and closes their dialogs.
 */
export function AccountDetailActions({
  account,
  manualAccounts
}: {
  account: Account;
  manualAccounts: Account[];
}) {
  const [dialog, setDialog] = useState(false);
  const close = () => setDialog(false);
  const addTransaction = () => setDialog(true);
  const acceptsEntries = account.provider === "manual" && account.archived_at === null;

  return (
    <>
      <AccountMenu account={account} addTransaction={acceptsEntries ? addTransaction : undefined} />
      {acceptsEntries && (
        <button className={clsx(ui["button"], ui["primary"], styles["add"])} onClick={addTransaction}>
          <Plus size={15} />
          Add transaction
        </button>
      )}
      {dialog && <ManualTransactionDialog accounts={manualAccounts} accountId={account.id} close={close} />}
    </>
  );
}
