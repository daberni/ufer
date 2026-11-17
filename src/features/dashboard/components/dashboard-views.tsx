"use client";

import { OverviewView } from "@/features/dashboard/components/overview-view";
import { PeriodControls } from "@/features/dashboard/components/period-controls";
import { TransactionsPanel } from "@/features/transactions/components/transactions-panel";
import { SyncRunEmpty, SyncRunScope } from "@/features/transactions/components/sync-run-scope";
import { AccountsView } from "@/features/accounts/components/accounts-view";
import { RulesView } from "@/features/categorization/components/rules-view";
import { ConnectionsView } from "@/features/banking/components/connections-view";
import { AccountDetails, AccountNotFound, type BackLink } from "@/features/accounts/components/account-details";
import { AccountCashFlowSummary } from "@/features/reports/components/account-cash-flow";
import { replacePage, setSyncRun, useAccountTransactionsHref, useViewHref, useViewQuery } from "@/client/use-app-url";
import { useAppStore } from "@/client/app-store";
import { mapArea, useAreaResult, type Area } from "@/components/ui/use-area-result";
import { Empty } from "@/components/ui/empty-state";
import { useAccountCashFlow, useCashFlow } from "@/features/reports/queries";
import { accountGroups, useAccounts, useBalanceHistory, useNetWorth, useNetWorthHistory } from "@/features/accounts/queries";
import { navigation } from "@/features/dashboard/navigation";
import { useCategories, useRules } from "@/features/categorization/queries";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";
import { useConnections, useSyncRuns } from "@/features/banking/queries";
import { useTransactionListView } from "@/features/transactions/use-transaction-list-view";
import type { TransactionPage } from "@/features/transactions/types";
import type { ViewQuery } from "@/client/app-location";
import type { Account } from "@/features/accounts/types";
import type { AccountCashFlow } from "@/features/reports/types";
import type { Category } from "@/features/categorization/types";

/*
 * A view lays out all of its areas at once. Each area shows a skeleton until its first results arrive; later filter changes keep it in place and mark only the affected areas.
 */

export function OverviewPage() {
  const query = useViewQuery();
  const accounts = useAreaResult(useAccounts());
  const categories = useAreaResult(useCategories());
  const syncRuns = useAreaResult(useSyncRuns());
  const netWorth = useAreaResult(useNetWorth(query.currency));
  const netWorthHistory = useAreaResult(useNetWorthHistory(query.period, query.currency));
  const cashFlow = useAreaResult(useCashFlow(query.period, query.currency));
  const list = useTransactionListView(query, replacePage);
  const groups = mapArea(accounts, data => accountGroups(data, query.currency));
  const currencyAccounts = mapArea(groups, data => data.currencyAccounts);

  return (
    <>
      <PeriodControls currencies={mapArea(groups, data => data.currencies)} latestSync={mapArea(syncRuns, runs => runs[0])} view="overview" />
      <OverviewView
        cashFlow={cashFlow}
        currencyAccounts={currencyAccounts}
        netWorth={netWorth}
        netWorthHistory={netWorthHistory}
      />
      <TransactionsPanel
        categories={categories}
        list={list}
        page={list.page}
        view="overview"
      />
    </>
  );
}

export function TransactionsPage() {
  const query = useViewQuery();
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

// The URL holds the account; the list of accounts says whether it exists in this banking environment.
function selectedAccount(accounts: Area<Account[]>, id: string): Area<Account> | null {
  if (accounts.status === "pending") {
    return accounts;
  }

  const account = accounts.data.find(item => item.id === id);

  return account ? {
    data: account,
    status: accounts.status
  } : null;
}

export function AccountPage() {
  const query = useViewQuery();
  const viewHref = useViewHref();
  const listView = useAppStore(state => state.accountList);
  const accounts = useAreaResult(useAccounts());
  const connections = useAreaResult(useConnections());
  const categories = useAreaResult(useCategories());
  const history = useAreaResult(useBalanceHistory(query.account));
  const cashFlow = useAreaResult(useAccountCashFlow(query.account, query.period));
  const account = selectedAccount(accounts, query.account);
  const back: BackLink = {
    href: viewHref(listView),
    label: navigation.find(item => item.id === listView)!.label
  };

  if (!account) {
    return <AccountNotFound back={back} />;
  }

  return (
    <>
      <AccountDetails
        account={account}
        back={back}
        connections={connections}
        history={history}
      />
      {account.status === "pending" ? (
        <AccountActivity
          account={null}
          cashFlow={cashFlow}
          categories={categories}
          list={{
            status: "pending",
            failure: null
          }}
          page={query.page}
        />
      ) : (
        <LoadedAccountActivity
          account={account.data}
          cashFlow={cashFlow}
          categories={categories}
          query={query}
        />
      )}
    </>
  );
}

type AccountActivityProps = {
  cashFlow: Area<AccountCashFlow>;
  categories: Area<Category[]>;
};

// The list is filtered by the account's own currency, which is known once the account has loaded.
function LoadedAccountActivity({
  account,
  query,
  ...areas
}: AccountActivityProps & {
  account: Account;
  query: ViewQuery;
}) {
  const list = useTransactionListView({
    ...query,
    currency: account.currency
  }, replacePage);

  return (
    <AccountActivity
      account={account}
      list={list}
      page={list.page}
      {...areas}
    />
  );
}

function AccountActivity({
  account,
  cashFlow,
  categories,
  list,
  page
}: AccountActivityProps & {
  account: Account | null;
  list: Area<TransactionPage>;
  page: number;
}) {
  const accountTransactionsHref = useAccountTransactionsHref();
  const transactionCount = mapArea<TransactionPage, number>(list, data => data.transactionCount);

  return (
    <>
      <PeriodControls transactionCount={transactionCount} view="account" />
      <AccountCashFlowSummary cashFlow={cashFlow} currency={account?.currency ?? "EUR"} />
      <TransactionsPanel
        categories={categories}
        emptyState={<Empty title="No transactions in this period" illustration={null}>Choose another month or all months to see earlier transactions of this account.</Empty>}
        filterHref={account ? accountTransactionsHref(account) : "/transactions"}
        list={list}
        page={page}
        view="account"
      />
    </>
  );
}
