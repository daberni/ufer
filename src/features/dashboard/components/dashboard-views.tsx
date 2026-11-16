"use client";

import { OverviewView } from "@/features/dashboard/components/overview-view";
import { PeriodControls } from "@/features/dashboard/components/period-controls";
import { ViewLoading } from "@/features/dashboard/components/view-loading";
import { TransactionsPanel } from "@/features/transactions/components/transactions-panel";
import { SyncRunEmpty, SyncRunScope } from "@/features/transactions/components/sync-run-scope";
import { AccountsView } from "@/features/accounts/components/accounts-view";
import { RulesView } from "@/features/categorization/components/rules-view";
import { ConnectionsView } from "@/features/banking/components/connections-view";
import { replacePage, setSyncRun, useDashboardQuery } from "@/features/dashboard/use-dashboard-url";
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
  const query = useDashboardQuery();
  const accounts = useAccounts();
  const categories = useCategories();
  const syncRuns = useSyncRuns();
  const netWorth = useAreaResult(useNetWorth(query.currency));
  const cashFlow = useAreaResult(useCashFlow(query.period, query.currency));
  const list = useTransactionListView(query, replacePage);

  if (!accounts.data || !categories.data || !syncRuns.data || !netWorth.data || !cashFlow.data || !list.data) {
    return <ViewLoading failed={firstLoadFailed(accounts, categories, syncRuns, netWorth, cashFlow, list)} />;
  }

  const groups = accountGroups(accounts.data, query.currency);

  return (
    <>
      <PeriodControls currencies={groups.currencies} latestSync={syncRuns.data[0]} view="overview" />
      <OverviewView
        cashFlow={{
          data: cashFlow.data,
          status: cashFlow.status
        }}
        currencyAccounts={groups.currencyAccounts}
        netWorth={{
          data: netWorth.data,
          status: netWorth.status
        }}
      />
      <TransactionsPanel
        categories={categories.data}
        filterAccounts={groups.currencyAccounts}
        list={{
          data: list.data,
          status: list.status
        }}
        page={list.page}
        view="overview"
      />
    </>
  );
}

export function TransactionsPage() {
  const query = useDashboardQuery();
  const accounts = useAccounts();
  const categories = useCategories();
  const list = useTransactionListView(query, replacePage);

  if (!accounts.data || !categories.data || !list.data) {
    return <ViewLoading failed={firstLoadFailed(accounts, categories, list)} />;
  }

  const groups = accountGroups(accounts.data, query.currency);
  const transactionCount = {
    data: list.data.transactionCount,
    status: list.status
  };

  // A placeholder from earlier filters says nothing about the selected run; only the run's own response can report it missing.
  const selectedRun = list.data.syncRun?.id === query.syncRun ? list.data.syncRun : null;
  const runFound = selectedRun !== null || !list.current;
  const runEmptyState = <SyncRunEmpty filtered={Boolean(query.search || query.account || query.category)} found={runFound} run={selectedRun} />;

  return (
    <>
      {query.syncRun ? (
        <SyncRunScope
          clear={() => setSyncRun("")}
          found={runFound}
          run={selectedRun}
          transactionCount={transactionCount}
        />
      ) : (
        <PeriodControls currencies={groups.currencies} transactionCount={transactionCount} view="transactions" />
      )}
      <TransactionsPanel
        categories={categories.data}
        emptyState={query.syncRun ? runEmptyState : undefined}
        filterAccounts={query.syncRun ? accounts.data : groups.currencyAccounts}
        list={{
          data: list.data,
          status: list.status
        }}
        page={list.page}
        view="transactions"
      />
    </>
  );
}

export function AccountsPage() {
  const accounts = useAccounts();

  if (!accounts.data) {
    return <ViewLoading failed={accounts.isError} />;
  }

  return (
    <AccountsView accounts={accounts.data} />
  );
}

export function RulesPage() {
  const rules = useRules();
  const categories = useCategories();

  if (!rules.data || !categories.data) {
    return <ViewLoading failed={firstLoadFailed(rules, categories)} />;
  }

  return (
    <RulesView categories={categories.data} rules={rules.data} />
  );
}

export function ConnectionsPage() {
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
      syncRuns={syncRuns.data}
    />
  );
}
