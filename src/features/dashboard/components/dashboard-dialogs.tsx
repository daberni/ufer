"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./dashboard-dialogs.module.css";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { BankConnectionForm } from "@/features/banking/components/bank-connection-form";
import { CreateAccountForm } from "@/features/accounts/components/create-account-form";
import { ValuationForm } from "@/features/accounts/components/valuation-form";
import { CreateRuleForm } from "@/features/categorization/components/create-rule-form";
import { CategoryForm } from "@/features/categorization/components/category-form";
import { CsvImportForm } from "@/features/imports/components/csv-import-form";
import { modalTitles } from "@/features/dashboard/presentation";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "bankCountry" | "bankName" | "bankSearch" | "banks" | "banksLoading" | "busy" | "error" | "importMode" | "modal" | "selectedAccount" | "selectedCategory" | "setBankCountry" | "setBankName" | "setBankSearch" | "setImportMode" | "setModal" | "setNotice" | "state" | "submit">;

export function DashboardDialogs({
  bankCountry,
  bankName,
  bankSearch,
  banks,
  banksLoading,
  busy,
  error,
  importMode,
  modal,
  selectedAccount,
  selectedCategory,
  setBankCountry,
  setBankName,
  setBankSearch,
  setImportMode,
  setModal,
  setNotice,
  state,
  submit
}: Props) {
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
        {error && (
          <p className={clsx(ui["notice"], ui["error"])} role="alert">
            {error}
          </p>
        )}
        {modal === "bank" && (
          <BankConnectionForm
            bankCountry={bankCountry}
            bankName={bankName}
            bankSearch={bankSearch}
            banks={banks}
            banksLoading={banksLoading}
            busy={busy}
            setBankCountry={setBankCountry}
            setBankName={setBankName}
            setBankSearch={setBankSearch}
            state={state}
            submit={submit}
          />
        )}
        {modal === "account" && <CreateAccountForm busy={busy} submit={submit} />}
        {modal === "balance" && selectedAccount && <ValuationForm busy={busy} selectedAccount={selectedAccount} submit={submit} />}
        {modal === "rule" && <CreateRuleForm busy={busy} state={state} submit={submit} />}
        {modal === "category" && <CategoryForm busy={busy} submit={submit} />}
        {modal === "editCategory" && selectedCategory && <CategoryForm busy={busy} category={selectedCategory} submit={submit} />}
        {modal === "import" && (
          <CsvImportForm
            busy={busy}
            importMode={importMode}
            setImportMode={setImportMode}
            setNotice={setNotice}
            state={state}
            submit={submit}
          />
        )}
      </div>
    </dialog>
  );
}
