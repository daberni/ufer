"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./account-detail-actions.module.css";

import { useState } from "react";
import { clsx } from "clsx";
import { ArrowDownToLine, Plus } from "lucide-react";
import { ManualTransactionDialog } from "@/features/transactions/components/manual-transaction-dialog";
import { BalanceImportDialog } from "@/features/imports/components/balance-import-dialog";
import type { Account } from "@/features/accounts/types";

/** The selected manual account's actions in the page heading; its balance is updated beside the balance. Changing accounts remounts the toolbar and closes its dialogs. */
export function AccountDetailActions({
  account,
  manualAccounts
}: {
  account: Account;
  manualAccounts: Account[];
}) {
  const [dialog, setDialog] = useState<"transaction" | "import" | null>(null);
  const close = () => setDialog(null);

  if (account.provider !== "manual" || account.archived_at !== null) {
    return null;
  }

  return (
    <div className={clsx(ui["button-group"], styles["actions"])}>
      <button className={clsx(ui["button"], ui["primary"], styles["button"])} onClick={() => setDialog("transaction")}>
        <Plus size={15} />
        Add transaction
      </button>
      <button className={clsx(ui["button"], styles["button"])} onClick={() => setDialog("import")}>
        <ArrowDownToLine size={15} />
        Import balances
      </button>
      {dialog === "transaction" && <ManualTransactionDialog accounts={manualAccounts} accountId={account.id} close={close} />}
      {dialog === "import" && <BalanceImportDialog account={account} close={close} />}
    </div>
  );
}
