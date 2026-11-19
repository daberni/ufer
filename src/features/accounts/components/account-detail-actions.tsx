"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./account-detail-actions.module.css";

import { useState } from "react";
import { clsx } from "clsx";
import { Plus } from "lucide-react";
import { ManualTransactionDialog } from "@/features/transactions/components/manual-transaction-dialog";
import type { Account } from "@/features/accounts/types";

/** The selected manual account's actions in the page heading; its balance is updated beside the balance. Changing accounts remounts the toolbar and closes its dialogs. */
export function AccountDetailActions({
  account,
  manualAccounts
}: {
  account: Account;
  manualAccounts: Account[];
}) {
  const [entryOpen, setEntryOpen] = useState(false);

  if (account.provider !== "manual" || account.archived_at !== null) {
    return null;
  }

  return (
    <div className={clsx(ui["button-group"], styles["actions"])}>
      <button className={clsx(ui["button"], ui["primary"], styles["button"])} onClick={() => setEntryOpen(true)}>
        <Plus size={15} />
        Add transaction
      </button>
      {entryOpen && <ManualTransactionDialog accounts={manualAccounts} accountId={account.id} close={() => setEntryOpen(false)} />}
    </div>
  );
}
