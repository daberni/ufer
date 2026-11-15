"use client";

import ui from "../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./dashboard.module.css";
import { ArrowRight, Check, CircleHelp, Link2, RefreshCw, X } from "lucide-react";
import { BrandIcon } from "@/components/branding/brand-icon";
import { OverviewView } from "@/features/dashboard/components/overview-view";
import { TransactionsPanel } from "@/features/transactions/components/transactions-panel";
import { AccountsView } from "@/features/accounts/components/accounts-view";
import { RulesView } from "@/features/categorization/components/rules-view";
import { ConnectionsView } from "@/features/banking/components/connections-view";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { PageHeading } from "@/features/dashboard/components/page-heading";
import { PeriodControls } from "@/features/dashboard/components/period-controls";
import { DashboardDialogs } from "@/features/dashboard/components/dashboard-dialogs";
import { LoginForm } from "@/features/auth/components/login-form";
import { useDashboard } from "./use-dashboard";

export default function Dashboard() {
  const dashboard = useDashboard();

  if (dashboard.locked) {
    return (
      <LoginForm
        busy={dashboard.busy}
        error={dashboard.error}
        perform={dashboard.perform}
        setLocked={dashboard.setLocked}
      />
    );
  }

  return (
    <div className={styles["app-shell"]}>
      <AppSidebar
        changeView={dashboard.changeView}
        expiring={dashboard.expiring}
        state={dashboard.state}
        view={dashboard.view}
      />
      <div className={styles["main-shell"]}>
        <AppHeader
          nav={dashboard.nav}
          perform={dashboard.perform}
          setLocked={dashboard.setLocked}
          state={dashboard.state}
        />
        <main className={styles["content"]}>
          <PageHeading
            bankAccounts={dashboard.bankAccounts}
            busy={dashboard.busy}
            nav={dashboard.nav}
            perform={dashboard.perform}
            setError={dashboard.setError}
            setNotice={dashboard.setNotice}
            view={dashboard.view}
          />
          <div aria-live="polite">
            {dashboard.notice && (
              <div className={ui["notice"]}>
                <Check size={17} />
                {dashboard.notice}
                <button className={ui["icon-button"]} aria-label="Dismiss notice" onClick={() => dashboard.setNotice("")}>
                  <X size={15} />
                </button>
              </div>
            )}
            {dashboard.error && (
              <div className={clsx(ui["notice"], ui["error"])} role="alert">
                <CircleHelp size={18} />
                {dashboard.error}
                <button className={ui["icon-button"]} aria-label="Dismiss error" onClick={() => dashboard.setError("")}>
                  <X size={15} />
                </button>
              </div>
            )}
          </div>
          {dashboard.state?.environment === "SANDBOX" && (
            <div className={styles["sandbox-note"]}>
              <span className={styles["status-dot"]} />
              Sandbox mode: linked banks provide test data. Real accounts require a separate production application.
            </div>
          )}
          {dashboard.expiring.length > 0 && (
            <div className={clsx(ui["notice"], ui["warning"])}>
              <Link2 size={17} />
              {dashboard.expiring.length} bank authorization(s) are expiring or have expired.
              <button className={ui["text-button"]} onClick={() => dashboard.changeView("connections")}>
                Review authorizations <ArrowRight size={14} />
              </button>
            </div>
          )}
          {!dashboard.state ? (
            <div className={styles["loading-state"]}>
              <RefreshCw size={22} className={ui["spinning"]} />{" "}
              Loading dashboard …
            </div>
          ) : (
            <>
              {(dashboard.view === "overview" || dashboard.view === "transactions") && (
                <PeriodControls
                  currencies={dashboard.currencies}
                  currency={dashboard.currency}
                  month={dashboard.month}
                  moveMonth={dashboard.moveMonth}
                  setCurrency={dashboard.setCurrency}
                  setMonth={dashboard.setMonth}
                  setPage={dashboard.setPage}
                  state={dashboard.state}
                  view={dashboard.view}
                />
              )}
              {dashboard.view === "overview" && (
                <OverviewView
                  changeView={dashboard.changeView}
                  currency={dashboard.currency}
                  month={dashboard.month}
                  openBank={dashboard.openBank}
                  selectedCurrencyAccounts={dashboard.selectedCurrencyAccounts}
                  setModal={dashboard.setModal}
                  setSelectedAccount={dashboard.setSelectedAccount}
                  state={dashboard.state}
                  summary={dashboard.summary}
                  totalExpenses={dashboard.totalExpenses}
                  trend={dashboard.trend}
                  trendMax={dashboard.trendMax}
                />
              )}
              {(dashboard.view === "overview" || dashboard.view === "transactions") && (
                <TransactionsPanel
                  accountFilter={dashboard.accountFilter}
                  allMonths={dashboard.allMonths}
                  busy={dashboard.busy}
                  categoryFilter={dashboard.categoryFilter}
                  changeView={dashboard.changeView}
                  page={dashboard.page}
                  perform={dashboard.perform}
                  search={dashboard.search}
                  selectedCurrencyAccounts={dashboard.selectedCurrencyAccounts}
                  setAccountFilter={dashboard.setAccountFilter}
                  setAllMonths={dashboard.setAllMonths}
                  setCategoryFilter={dashboard.setCategoryFilter}
                  setImportMode={dashboard.setImportMode}
                  setModal={dashboard.setModal}
                  setPage={dashboard.setPage}
                  setSearch={dashboard.setSearch}
                  state={dashboard.state}
                  view={dashboard.view}
                  visibleTransactions={dashboard.visibleTransactions}
                />
              )}
              {dashboard.view === "accounts" && (
                <AccountsView
                  openBank={dashboard.openBank}
                  setModal={dashboard.setModal}
                  setSelectedAccount={dashboard.setSelectedAccount}
                  state={dashboard.state}
                />
              )}
              {dashboard.view === "rules" && (
                <RulesView
                  busy={dashboard.busy}
                  perform={dashboard.perform}
                  setModal={dashboard.setModal}
                  state={dashboard.state}
                />
              )}
              {dashboard.view === "connections" && <ConnectionsView busy={dashboard.busy} openBank={dashboard.openBank} state={dashboard.state} />}
            </>
          )}
          <footer className={styles["page-footer"]}>
            <span>
              <BrandIcon size={16} /> Ufer
            </span>
            <span>A clearer view of your money.</span>
          </footer>
        </main>
      </div>
      {dashboard.modal && (
        <DashboardDialogs
          bankCountry={dashboard.bankCountry}
          bankName={dashboard.bankName}
          bankSearch={dashboard.bankSearch}
          banks={dashboard.banks}
          banksLoading={dashboard.banksLoading}
          busy={dashboard.busy}
          error={dashboard.error}
          importMode={dashboard.importMode}
          modal={dashboard.modal}
          selectedAccount={dashboard.selectedAccount}
          setBankCountry={dashboard.setBankCountry}
          setBankName={dashboard.setBankName}
          setBankSearch={dashboard.setBankSearch}
          setImportMode={dashboard.setImportMode}
          setModal={dashboard.setModal}
          setNotice={dashboard.setNotice}
          state={dashboard.state}
          submit={dashboard.submit}
        />
      )}
    </div>
  );
}
