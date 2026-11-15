"use client";

import { OverviewView } from "@/features/dashboard/components/overview-view";
import { PeriodControls } from "@/features/dashboard/components/period-controls";
import { TransactionsPanel } from "@/features/transactions/components/transactions-panel";
import { AccountsView } from "@/features/accounts/components/accounts-view";
import { RulesView } from "@/features/categorization/components/rules-view";
import { ConnectionsView } from "@/features/banking/components/connections-view";
import { useDashboardController } from "@/features/dashboard/dashboard-context";

function DashboardPeriodControls() {
  const dashboard = useDashboardController();

  return (
    <PeriodControls
      currencies={dashboard.currencies}
      currency={dashboard.currency}
      moveMonth={dashboard.moveMonth}
      period={dashboard.period}
      selectPeriod={dashboard.selectPeriod}
      setCurrency={dashboard.setCurrency}
      state={dashboard.state}
      view={dashboard.view}
    />
  );
}

function DashboardTransactionsPanel() {
  const dashboard = useDashboardController();

  return (
    <TransactionsPanel
      accountFilter={dashboard.accountFilter}
      busy={dashboard.busy}
      categoryFilter={dashboard.categoryFilter}
      changeView={dashboard.changeView}
      page={dashboard.page}
      perform={dashboard.perform}
      reportFeedback={dashboard.reportFeedback}
      search={dashboard.search}
      selectedCurrencyAccounts={dashboard.selectedCurrencyAccounts}
      setAccountFilter={dashboard.setAccountFilter}
      setCategoryFilter={dashboard.setCategoryFilter}
      setImportMode={dashboard.setImportMode}
      setModal={dashboard.setModal}
      setPage={dashboard.setPage}
      setSearch={dashboard.setSearch}
      state={dashboard.state}
      view={dashboard.view}
      visibleTransactions={dashboard.visibleTransactions}
    />
  );
}

export function OverviewPage() {
  const dashboard = useDashboardController();

  return (
    <>
      <DashboardPeriodControls />
      <OverviewView
        changeView={dashboard.changeView}
        currency={dashboard.currency}
        openBank={dashboard.openBank}
        selectedCurrencyAccounts={dashboard.selectedCurrencyAccounts}
        setModal={dashboard.setModal}
        setSelectedAccount={dashboard.setSelectedAccount}
        state={dashboard.state}
        totalExpenses={dashboard.totalExpenses}
        trend={dashboard.trend}
        trendMax={dashboard.trendMax}
      />
      <DashboardTransactionsPanel />
    </>
  );
}

export function TransactionsPage() {
  return (
    <>
      <DashboardPeriodControls />
      <DashboardTransactionsPanel />
    </>
  );
}

export function AccountsPage() {
  const dashboard = useDashboardController();

  return (
    <AccountsView
      openBank={dashboard.openBank}
      setModal={dashboard.setModal}
      setSelectedAccount={dashboard.setSelectedAccount}
      state={dashboard.state}
    />
  );
}

export function RulesPage() {
  const dashboard = useDashboardController();

  return (
    <RulesView
      busy={dashboard.busy}
      perform={dashboard.perform}
      reportFeedback={dashboard.reportFeedback}
      setModal={dashboard.setModal}
      setSelectedCategory={dashboard.setSelectedCategory}
      state={dashboard.state}
    />
  );
}

export function ConnectionsPage() {
  const dashboard = useDashboardController();

  return (
    <ConnectionsView
      busy={dashboard.busy}
      openBank={dashboard.openBank}
      openConnectionRemoval={dashboard.openConnectionRemoval}
      state={dashboard.state}
    />
  );
}
