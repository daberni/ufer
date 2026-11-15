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
import { useDialogSubmit } from "@/features/dashboard/use-dialog-submit";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "bankCountry" | "bankName" | "bankSearch" | "banks" | "banksError" | "banksLoading" | "busy" | "importMode" | "modal" | "perform" | "reportFeedback" | "selectedAccount" | "selectedCategory" | "selectedConnection" | "setBankCountry" | "setBankName" | "setBankSearch" | "setImportMode" | "setModal" | "state">;

export function DashboardDialogs({
  bankCountry,
  bankName,
  bankSearch,
  banks,
  banksError,
  banksLoading,
  busy,
  importMode,
  modal,
  perform,
  reportFeedback,
  selectedAccount,
  selectedCategory,
  selectedConnection,
  setBankCountry,
  setBankName,
  setBankSearch,
  setImportMode,
  setModal,
  state
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const {
    error,
    submit
  } = useDialogSubmit(perform, () => setModal(null));

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
      onCancel={() => setModal(null)}
      onClick={event => {
        if (event.target === event.currentTarget) {
          setModal(null);
        }
      }}
    >
      <div className={styles["modal-content"]}>
        <div className={styles["modal-heading"]}>
          <div>
            <span className={styles["eyebrow"]}>YOUR FINANCES</span>
            <h2 id="modal-title">{modal ? modalTitles[modal] : "Your finances"}</h2>
          </div>
          <button className={ui["icon-button"]} aria-label="Close dialog" onClick={() => setModal(null)}>
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
            busy={busy}
            error={error}
            setBankCountry={setBankCountry}
            setBankName={setBankName}
            setBankSearch={setBankSearch}
            state={state}
            submit={submit}
          />
        )}
        {modal === "removeConnection" && (
          <RemoveConnectionForm
            busy={busy}
            error={error}
            reportFeedback={reportFeedback}
            selectedConnection={selectedConnection}
            setModal={setModal}
            state={state}
            submit={submit}
          />
        )}
        {modal === "account" && <CreateAccountForm busy={busy} error={error} submit={submit} />}
        {modal === "balance" && selectedAccount && (
          <ValuationForm
            busy={busy}
            error={error}
            selectedAccount={selectedAccount}
            submit={submit}
          />
        )}
        {modal === "rule" && (
          <CreateRuleForm
            busy={busy}
            error={error}
            state={state}
            submit={submit}
          />
        )}
        {modal === "category" && <CategoryForm busy={busy} error={error} submit={submit} />}
        {modal === "editCategory" && selectedCategory && (
          <CategoryForm
            busy={busy}
            category={selectedCategory}
            error={error}
            submit={submit}
          />
        )}
        {modal === "import" && (
          <CsvImportForm
            busy={busy}
            error={error}
            importMode={importMode}
            setImportMode={setImportMode}
            state={state}
            submit={submit}
          />
        )}
      </div>
    </dialog>
  );
}
