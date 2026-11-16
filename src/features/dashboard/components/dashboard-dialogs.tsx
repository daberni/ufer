"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./dashboard-dialogs.module.css";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { BankConnectionForm } from "@/features/banking/components/bank-connection-form";
import { RemoveConnectionForm } from "@/features/banking/components/remove-connection-form";
import { CreateAccountForm } from "@/features/accounts/components/create-account-form";
import { ValuationForm } from "@/features/accounts/components/valuation-form";
import { CreateRuleForm } from "@/features/categorization/components/create-rule-form";
import { CategoryForm } from "@/features/categorization/components/category-form";
import { CsvImportForm } from "@/features/imports/components/csv-import-form";
import { modalTitles } from "@/features/dashboard/presentation";
import { onView, useDashboardStore, type DashboardDialog } from "@/features/dashboard/dashboard-store";
import type { Account } from "@/features/dashboard/types";

type Props = {
  accounts: Account[];
  environment: string;
};

/** The dialog opened on the current view, if any; each opening mounts a fresh dialog and form. */
export function DashboardDialogs(props: Props) {
  const pathname = usePathname();
  const bound = useDashboardStore(state => state.dialog);
  const dialog = onView(bound, pathname);

  if (!dialog) {
    return null;
  }

  return <OpenDialog key={dialog.kind} dialog={dialog} {...props} />;
}

function OpenDialog({
  accounts,
  dialog,
  environment
}: Props & {
  dialog: DashboardDialog;
}) {
  const close = useDashboardStore(state => state.closeDialog);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialogRef.current;

    element?.showModal();

    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="modal-title"
      className={styles["modal"]}
      onCancel={close}
      onClick={event => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div className={styles["modal-content"]}>
        <div className={styles["modal-heading"]}>
          <div>
            <span className={styles["eyebrow"]}>YOUR FINANCES</span>
            <h2 id="modal-title">{modalTitles[dialog.kind]}</h2>
          </div>
          <button className={ui["icon-button"]} aria-label="Close dialog" onClick={close}>
            <X size={20} />
          </button>
        </div>
        <DialogForm
          accounts={accounts}
          close={close}
          dialog={dialog}
          environment={environment}
        />
      </div>
    </dialog>
  );
}

function DialogForm({
  accounts,
  close,
  dialog,
  environment
}: Props & {
  close: () => void;
  dialog: DashboardDialog;
}) {
  switch (dialog.kind) {
    case "bank":
      return <BankConnectionForm close={close} connection={dialog.connection} environment={environment} />;
    case "removeConnection":
      return <RemoveConnectionForm accounts={accounts} close={close} selectedConnection={dialog.connection} />;
    case "account":
      return <CreateAccountForm close={close} />;
    case "balance":
      return <ValuationForm close={close} selectedAccount={dialog.account} />;
    case "rule":
      return <CreateRuleForm close={close} />;
    case "category":
      return <CategoryForm close={close} />;
    case "editCategory":
      return <CategoryForm category={dialog.category} close={close} />;
    case "import":
      return <CsvImportForm accounts={accounts} close={close} initialMode={dialog.mode} />;
  }
}
