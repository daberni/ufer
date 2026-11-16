"use client";

import { OverviewView } from "@/features/dashboard/components/overview-view";
import { PeriodControls } from "@/features/dashboard/components/period-controls";
import { TransactionsPanel } from "@/features/transactions/components/transactions-panel";
import { SyncRunEmpty, SyncRunScope } from "@/features/transactions/components/sync-run-scope";
import { AccountsView } from "@/features/accounts/components/accounts-view";
import { RulesView } from "@/features/categorization/components/rules-view";
import { ConnectionsView } from "@/features/banking/components/connections-view";
import { replacePage, setSyncRun, useDashboardQuery } from "@/client/use-dashboard-url";
import { mapArea, useAreaResult } from "@/components/ui/use-area-result";
import { useCashFlow } from "@/features/reports/queries";
import { accountGroups, useAccounts, useNetWorth } from "@/features/accounts/queries";
import { useCategories, useRules } from "@/features/categorization/queries";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";
import { useConnections, useSyncRuns } from "@/features/banking/queries";
import { useTransactionListView } from "@/features/transactions/use-transaction-list-view";
import type { TransactionPage } from "@/features/transactions/types";

/*
 * A view lays out all of its areas at once. Each area shows a skeleton until its first results arrive; later filter changes keep it in place and mark only the affected areas.
 */

export function OverviewPage() {
  const query = useDashboardQuery();
  const accounts = useAreaResult(useAccounts());
  const categories = useAreaResult(useCategories());
  const syncRuns = useAreaResult(useSyncRuns());
  const netWorth = useAreaResult(useNetWorth(query.currency));
  const cashFlow = useAreaResult(useCashFlow(query.period, query.currency));
  const list = useTransactionListView(query, replacePage);
  const groups = mapArea(accounts, data => accountGroups(data, query.currency));
  const currencyAccounts = mapArea(groups, data => data.currencyAccounts);

  return (
    <>
      <PeriodControls currencies={mapArea(groups, data => data.currencies)} latestSync={mapArea(syncRuns, runs => runs[0])} view="overview" />
      <OverviewView cashFlow={cashFlow} currencyAccounts={currencyAccounts} netWorth={netWorth} />
      <TransactionsPanel
        categories={categories}
        filterAccounts={currencyAccounts}
        list={list}
        page={list.page}
        view="overview"
      />
    </>
  );
}

export function TransactionsPage() {
  const query = useDashboardQuery();
  const accounts = useAreaResult(useAccounts());
  const categories = useAreaResult(useCategories());
  const list = useTransactionListView(query, replacePage);
  const groups = mapArea(accounts, data => accountGroups(data, query.currency));
  const transactionCount = mapArea<TransactionPage, number>(list, data => data.transactionCount);

  // A placeholder from earlier filters says nothing about the selected run; only the run's own response can report it missing.
  const listedRun = list.data?.syncRun ?? null;
  const selectedRun = listedRun?.id === query.syncRun ? listedRun : null;
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
        <PeriodControls currencies={mapArea(groups, data => data.currencies)} transactionCount={transactionCount} view="transactions" />
      )}
      <TransactionsPanel
        categories={categories}
        emptyState={query.syncRun ? runEmptyState : undefined}
        filterAccounts={query.syncRun ? accounts : mapArea(groups, data => data.currencyAccounts)}
        list={list}
        page={list.page}
        view="transactions"
      />
    </>
  );
}

export function AccountsPage() {
  const accounts = useAreaResult(useAccounts());

  return (
    <AccountsView accounts={accounts} />
  );
}

export function RulesPage() {
  const rules = useAreaResult(useRules());
  const categories = useAreaResult(useCategories());

  return (
    <RulesView categories={categories} rules={rules} />
  );
}

export function ConnectionsPage() {
  const banking = useBankingConfiguration();
  const connections = useAreaResult(useConnections());
  const syncRuns = useAreaResult(useSyncRuns());

  return (
    <ConnectionsView
      banking={banking}
      connections={connections}
      syncRuns={syncRuns}
    />
  );
}
