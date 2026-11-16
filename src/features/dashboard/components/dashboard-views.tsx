"use client";

import { OverviewView } from "@/features/dashboard/components/overview-view";
import { PeriodControls } from "@/features/dashboard/components/period-controls";
import { ViewLoading } from "@/features/dashboard/components/view-loading";
import { TransactionsPanel } from "@/features/transactions/components/transactions-panel";
import { SyncRunEmpty, SyncRunScope } from "@/features/transactions/components/sync-run-scope";
import { AccountsView } from "@/features/accounts/components/accounts-view";
import { RulesView } from "@/features/categorization/components/rules-view";
import { ConnectionsView } from "@/features/banking/components/connections-view";
import { useDashboardController } from "@/features/dashboard/dashboard-context";
import { useAreaResult } from "@/features/dashboard/use-area-result";
import { useCashFlow } from "@/features/dashboard/queries";
import { accountGroups, useAccounts, useNetWorth } from "@/features/accounts/queries";
import { useCategories, useRules } from "@/features/categorization/queries";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";
import { useConnections, useSyncRuns } from "@/features/banking/queries";
import { useTransactionListView } from "@/features/transactions/use-transaction-list-view";

/*
 * A view renders once its first results have arrived. Later filter changes keep the view in place and mark only the affected areas.
 */

type Loadable = {
  data: unknown;
  isError?: boolean;
  status?: string;
};

// Without any results there is nothing to keep in place; the load error banner reports the failure instead of a spinner.
function firstLoadFailed(...results: Loadable[]) {
  return results.some(result => result.data === undefined && (result.isError || result.status === "unavailable"));
}

export function OverviewPage() {
  const dashboard = useDashboardController();
  const accounts = useAccounts();
  const categories = useCategories();
  const syncRuns = useSyncRuns();
  const netWorth = useAreaResult(useNetWorth(dashboard.currency));
  const cashFlow = useAreaResult(useCashFlow(dashboard.period, dashboard.currency));
  const list = useTransactionListView(dashboard.query, dashboard.replacePage);

  if (!accounts.data || !categories.data || !syncRuns.data || !netWorth.data || !cashFlow.data || !list.data) {
    return <ViewLoading failed={firstLoadFailed(accounts, categories, syncRuns, netWorth, cashFlow, list)} />;
  }

  const groups = accountGroups(accounts.data, dashboard.currency);

  return (
    <>
      <PeriodControls
        currencies={groups.currencies}
        currency={dashboard.currency}
        latestSync={syncRuns.data[0]}
        moveMonth={dashboard.moveMonth}
        period={dashboard.period}
        selectPeriod={dashboard.selectPeriod}
        setCurrency={dashboard.setCurrency}
        view="overview"
      />
      <OverviewView
        cashFlow={{
          data: cashFlow.data,
          status: cashFlow.status
        }}
        changeView={dashboard.changeView}
        currencyAccounts={groups.currencyAccounts}
        netWorth={{
          data: netWorth.data,
          status: netWorth.status
        }}
        openBank={dashboard.openBank}
        setModal={dashboard.setModal}
        setSelectedAccount={dashboard.setSelectedAccount}
      />
      <TransactionsPanel
        accountFilter={dashboard.accountFilter}
        categories={categories.data}
        categoryFilter={dashboard.categoryFilter}
        changeView={dashboard.changeView}
        filterAccounts={groups.currencyAccounts}
        list={{
          data: list.data,
          status: list.status
        }}
        page={list.page}
        search={dashboard.search}
        setAccountFilter={dashboard.setAccountFilter}
        setCategoryFilter={dashboard.setCategoryFilter}
        setImportMode={dashboard.setImportMode}
        setModal={dashboard.setModal}
        setPage={dashboard.setPage}
        setSearch={dashboard.setSearch}
        view="overview"
      />
    </>
  );
}

export function TransactionsPage() {
  const dashboard = useDashboardController();
  const accounts = useAccounts();
  const categories = useCategories();
  const list = useTransactionListView(dashboard.query, dashboard.replacePage);

  if (!accounts.data || !categories.data || !list.data) {
    return <ViewLoading failed={firstLoadFailed(accounts, categories, list)} />;
  }

  const groups = accountGroups(accounts.data, dashboard.currency);
  const transactionCount = {
    data: list.data.transactionCount,
    status: list.status
  };

  // A placeholder from earlier filters says nothing about the selected run; only the run's own response can report it missing.
  const selectedRun = list.data.syncRun?.id === dashboard.syncRun ? list.data.syncRun : null;
  const runFound = selectedRun !== null || !list.current;
  const runEmptyState = <SyncRunEmpty filtered={Boolean(dashboard.search || dashboard.accountFilter || dashboard.categoryFilter)} found={runFound} run={selectedRun} />;

  return (
    <>
      {dashboard.syncRun ? (
        <SyncRunScope
          clear={() => dashboard.setSyncRun("")}
          found={runFound}
          run={selectedRun}
          transactionCount={transactionCount}
        />
      ) : (
        <PeriodControls
          currencies={groups.currencies}
          currency={dashboard.currency}
          moveMonth={dashboard.moveMonth}
          period={dashboard.period}
          selectPeriod={dashboard.selectPeriod}
          setCurrency={dashboard.setCurrency}
          transactionCount={transactionCount}
          view="transactions"
        />
      )}
      <TransactionsPanel
        accountFilter={dashboard.accountFilter}
        categories={categories.data}
        categoryFilter={dashboard.categoryFilter}
        changeView={dashboard.changeView}
        emptyState={dashboard.syncRun ? runEmptyState : undefined}
        filterAccounts={dashboard.syncRun ? accounts.data : groups.currencyAccounts}
        list={{
          data: list.data,
          status: list.status
        }}
        page={list.page}
        search={dashboard.search}
        setAccountFilter={dashboard.setAccountFilter}
        setCategoryFilter={dashboard.setCategoryFilter}
        setImportMode={dashboard.setImportMode}
        setModal={dashboard.setModal}
        setPage={dashboard.setPage}
        setSearch={dashboard.setSearch}
        view="transactions"
      />
    </>
  );
}

export function AccountsPage() {
  const dashboard = useDashboardController();
  const accounts = useAccounts();

  if (!accounts.data) {
    return <ViewLoading failed={accounts.isError} />;
  }

  return (
    <AccountsView
      accounts={accounts.data}
      openBank={dashboard.openBank}
      setModal={dashboard.setModal}
      setSelectedAccount={dashboard.setSelectedAccount}
    />
  );
}

export function RulesPage() {
  const dashboard = useDashboardController();
  const rules = useRules();
  const categories = useCategories();

  if (!rules.data || !categories.data) {
    return <ViewLoading failed={firstLoadFailed(rules, categories)} />;
  }

  return (
    <RulesView
      categories={categories.data}
      reportFeedback={dashboard.reportFeedback}
      rules={rules.data}
      setModal={dashboard.setModal}
      setSelectedCategory={dashboard.setSelectedCategory}
    />
  );
}

export function ConnectionsPage() {
  const dashboard = useDashboardController();
  const banking = useBankingConfiguration();
  const connections = useConnections();
  const syncRuns = useSyncRuns();

  if (!connections.data || !syncRuns.data) {
    return <ViewLoading failed={firstLoadFailed(connections, syncRuns)} />;
  }

  return (
    <ConnectionsView
      banking={banking}
      connections={connections.data}
      openBank={dashboard.openBank}
      openConnectionRemoval={dashboard.openConnectionRemoval}
      syncRunHref={dashboard.syncRunHref}
      syncRuns={syncRuns.data}
    />
  );
}
