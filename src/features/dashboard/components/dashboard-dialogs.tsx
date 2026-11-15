"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./dashboard-dialogs.module.css";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { BankConnectionForm } from "@/features/banking/components/bank-connection-form";
import { RemoveConnectionForm } from "@/features/banking/components/remove-connection-form";
import { CreateAccountForm } from "@/features/accounts/components/create-account-form";
import { ValuationForm } from "@/features/accounts/components/valuation-form";
import { CreateRuleForm } from "@/features/categorization/components/create-rule-form";
import { CategoryForm } from "@/features/categorization/components/category-form";
import { CsvImportForm } from "@/features/imports/components/csv-import-form";
import { modalTitles } from "@/features/dashboard/presentation";
import type { Account } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "bankCountry" | "bankName" | "bankSearch" | "banks" | "banksError" | "banksLoading" | "importMode" | "modal" | "reportFeedback" | "selectedAccount" | "selectedCategory" | "selectedConnection" | "setBankCountry" | "setBankName" | "setBankSearch" | "setImportMode" | "setModal"> & {
  accounts: Account[];
  environment: string;
};

export function DashboardDialogs({
  accounts,
  bankCountry,
  bankName,
  bankSearch,
  banks,
  banksError,
  banksLoading,
  environment,
  importMode,
  modal,
  reportFeedback,
  selectedAccount,
  selectedCategory,
  selectedConnection,
  setBankCountry,
  setBankName,
  setBankSearch,
  setImportMode,
  setModal
}: Props) {
  const close = () => setModal(null);
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
            <h2 id="modal-title">{modal ? modalTitles[modal] : "Your finances"}</h2>
          </div>
          <button className={ui["icon-button"]} aria-label="Close dialog" onClick={close}>
            <X size={20} />
          </button>
        </div>
        {modal === "bank" && (
          <BankConnectionForm
            bankCountry={bankCountry}
            bankName={bankName}
            bankSearch={bankSearch}
            banks={banks}
            banksError={banksError}
            banksLoading={banksLoading}
            close={close}
            environment={environment}
            setBankCountry={setBankCountry}
            setBankName={setBankName}
            setBankSearch={setBankSearch}
          />
        )}
        {modal === "removeConnection" && selectedConnection && (
          <RemoveConnectionForm
            accounts={accounts}
            close={close}
            reportFeedback={reportFeedback}
            selectedConnection={selectedConnection}
          />
        )}
        {modal === "account" && <CreateAccountForm close={close} />}
        {modal === "balance" && selectedAccount && <ValuationForm close={close} selectedAccount={selectedAccount} />}
        {modal === "rule" && <CreateRuleForm close={close} />}
        {modal === "category" && <CategoryForm close={close} />}
        {modal === "editCategory" && selectedCategory && <CategoryForm category={selectedCategory} close={close} />}
        {modal === "import" && (
          <CsvImportForm
            accounts={accounts}
            close={close}
            importMode={importMode}
            setImportMode={setImportMode}
          />
        )}
      </div>
    </dialog>
  );
}
