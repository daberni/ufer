"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useState } from "react";
import { clsx } from "clsx";
import { Pencil, Plus } from "lucide-react";
import { ManualTransactionDialog } from "@/features/transactions/components/manual-transaction-dialog";
import { ValuationDialog } from "./valuation-form";
import type { Account } from "@/features/accounts/types";

/** The selected manual account's actions in the page heading; changing accounts remounts the toolbar and closes its dialogs. */
export function AccountDetailActions({
  account,
  manualAccounts
}: {
  account: Account;
  manualAccounts: Account[];
}) {
  const [dialog, setDialog] = useState<"transaction" | "balance" | null>(null);
  const close = () => setDialog(null);

  if (account.provider !== "manual") {
    return null;
  }

  return (
    <div className={ui["button-group"]}>
      <button className={clsx(ui["button"], ui["primary"])} onClick={() => setDialog("transaction")}>
        <Plus size={15} />
        Add transaction
      </button>
      <button className={ui["button"]} onClick={() => setDialog("balance")}>
        <Pencil size={15} />
        Update balance
      </button>
      {dialog === "transaction" && <ManualTransactionDialog accounts={manualAccounts} accountId={account.id} close={close} />}
      {dialog === "balance" && <ValuationDialog selectedAccount={account} close={close} />}
    </div>
  );
}
