"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { bankConnectionsSectionId } from "@/features/banking/connections-location";
import { OverviewView } from "@/features/dashboard/components/overview-view";
import { PeriodControls } from "@/features/dashboard/components/period-controls";
import { TransactionsPanel } from "@/features/transactions/components/transactions-panel";
import { SyncRunEmpty, SyncRunScope } from "@/features/transactions/components/sync-run-scope";
import { AccountsView } from "@/features/accounts/components/accounts-view";
import { RulesView } from "@/features/categorization/components/rules-view";
import { ConnectionsSection } from "@/features/banking/components/connections-view";
import { AccountDetails, AccountNotFound, BackNavigation, type BackLink } from "@/features/accounts/components/account-details";
import { FileImportPage } from "@/features/imports/components/file-import-page";
import { AccountCashFlowSummary } from "@/features/reports/components/account-cash-flow";
import { BrokeragePanel } from "@/features/securities/components/brokerage-panel";
import { BrokerageOverview } from "@/features/securities/components/brokerage-overview";
import { HoldingDetail } from "@/features/securities/components/holding-detail";
import { HoldingsTableSkeleton } from "@/features/securities/components/brokerage-panel";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { withArchivedAccountsOpen } from "@/client/app-location";
import { replacePage, setSyncRun, useAccountHref, useAccountTransactionsHref, useViewHref, useViewQuery } from "@/client/use-app-url";
import { useAppStore } from "@/client/app-store";
import { mapArea, useAreaResult, type Area } from "@/components/ui/use-area-result";
import { Empty } from "@/components/ui/empty-state";
import { useAccountCashFlow, useCashFlow, useNetWorthHistory } from "@/features/reports/queries";
import { acceptsFileImport, accountGroups, activeAccounts, useAccounts, useBalanceHistory, useNetWorth } from "@/features/accounts/queries";
import { useCategories, useRules } from "@/features/categorization/queries";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";
import { useConnections, useSyncRuns } from "@/features/banking/queries";
import { useTransactionListView } from "@/features/transactions/use-transaction-list-view";
import type { TransactionPage } from "@/features/transactions/types";
import { recentTransactionsQuery, type ViewQuery } from "@/client/app-location";
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
  const netWorth = useAreaResult(useNetWorth(query.currency));
  const netWorthHistory = useAreaResult(useNetWorthHistory(query.currency));
  const cashFlow = useAreaResult(useCashFlow(query.period, query.currency));
  const list = useTransactionListView(recentTransactionsQuery(query), replacePage);
  const groups = mapArea(accounts, data => accountGroups(data, query.currency));
  const currencyAccounts = mapArea(groups, data => data.currencyAccounts);
  const hasReportedAccounts = groups.status === "pending" || groups.data.reportedAccounts.length > 0;

  return (
    <>
      <OverviewView
        cashFlow={cashFlow}
        currencies={mapArea(groups, data => data.currencies)}
        currencyAccounts={currencyAccounts}
        hasReportedAccounts={hasReportedAccounts}
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
  const runEmptyState = <SyncRunEmpty filtered={Boolean(query.search || query.account || query.category || query.type)} found={runFound} run={selectedRun} />;

  return (
    <TransactionsPanel
      categories={categories}
      emptyState={query.syncRun ? runEmptyState : undefined}
      filterAccounts={query.syncRun ? mapArea(accounts, activeAccounts) : mapArea(groups, data => data.currencyAccounts)}
      list={list}
      page={list.page}
      periodControls={query.syncRun ? null : <PeriodControls currencies={mapArea(groups, data => data.currencies)} view="transactions" />}
      scope={query.syncRun && (
        <SyncRunScope
          clear={() => setSyncRun("")}
          found={runFound}
          run={selectedRun}
          transactionCount={transactionCount}
        />
      )}
      view="transactions"
    />
  );
}

export function AccountsPage() {
  const accounts = useAreaResult(useAccounts());
  const banking = useBankingConfiguration();
  const connections = useAreaResult(useConnections());
  const syncRuns = useAreaResult(useSyncRuns());
  const accountsSettled = accounts.status !== "pending" || accounts.failure !== null;

  // Sign-in and the first account load can finish after the browser tried to scroll to the fragment.
  useEffect(() => {
    if (accountsSettled && window.location.hash === `#${bankConnectionsSectionId}`) {
      document.getElementById(bankConnectionsSectionId)?.scrollIntoView();
    }
  }, [accountsSettled]);

  return (
    <>
      <AccountsView accounts={accounts} />
      <ConnectionsSection banking={banking} connections={connections} syncRuns={syncRuns} />
    </>
  );
}

export function BrokeragePage() {
  return <BrokerageOverview />;
}

export function RulesPage() {
  const rules = useAreaResult(useRules());
  const categories = useAreaResult(useCategories());

  return (
    <RulesView categories={categories} rules={rules} />
  );
}

// The URL holds the account; the list of accounts says whether it exists.
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

export function ImportPage() {
  return <FileImportPage />;
}

export function AccountPage() {
  const t = useTranslations("shell.navigation");
  const query = useViewQuery();
  const viewHref = useViewHref();
  const listView = useAppStore(state => state.accountList);
  const accounts = useAreaResult(useAccounts());
  const connections = useAreaResult(useConnections());
  const categories = useAreaResult(useCategories());
  const history = useAreaResult(useBalanceHistory(query.account));
  const cashFlow = useAreaResult(useAccountCashFlow(query.account, query.period));
  const account = selectedAccount(accounts, query.account);
  const archivedOpen = useAppStore(state => state.archivedAccountsOpen);
  const listHref = viewHref(listView);
  const back: BackLink = {
    href: listView === "accounts" && archivedOpen ? withArchivedAccountsOpen(listHref) : listHref,
    label: t(`${listView}.label`)
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
      <AccountContent
        account={account}
        cashFlow={cashFlow}
        categories={categories}
        query={query}
      />
    </>
  );
}

/** A brokerage holding below its account, which it returns to. */
export function HoldingPage() {
  const query = useViewQuery();
  const accountHref = useAccountHref();
  const viewHref = useViewHref();
  const t = useTranslations("shell.navigation");
  const details = useTranslations("accounts.details");
  const accounts = useAreaResult(useAccounts());
  const account = selectedAccount(accounts, query.account);

  if (!account || account.status !== "pending" && account.data.kind !== "brokerage") {
    return (
      <AccountNotFound
        back={{
          href: viewHref("brokerage"),
          label: t("brokerage.label")
        }}
      />
    );
  }

  if (account.status === "pending") {
    return (
      <AreaPlaceholder area={account} failureTitle={details("failure")}>
        <section className={ui["panel"]}>
          <HoldingsTableSkeleton rows={1} />
        </section>
      </AreaPlaceholder>
    );
  }

  return (
    <>
      <BackNavigation
        back={{
          href: accountHref(account.data.id),
          label: account.data.name
        }}
      />
      <HoldingDetail account={account.data} />
    </>
  );
}

type AccountActivityProps = {
  cashFlow: Area<AccountCashFlow>;
  categories: Area<Category[]>;
};

/** Below the summary: a brokerage account's holdings and trades, any other account's cash flow and transactions. */
function AccountContent({
  account,
  query,
  ...areas
}: AccountActivityProps & {
  account: Area<Account>;
  query: ViewQuery;
}) {
  if (account.status === "pending") {
    return (
      <AccountActivity
        account={null}
        list={{
          status: "pending",
          failure: null
        }}
        page={query.page}
        {...areas}
      />
    );
  }

  if (account.data.kind === "brokerage") {
    return <BrokeragePanel account={account.data} />;
  }

  return <LoadedAccountActivity account={account.data} query={query} {...areas} />;
}

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
  const t = useTranslations("overview.account");
  const accountTransactionsHref = useAccountTransactionsHref();
  const transactionCount = mapArea<TransactionPage, number>(list, data => data.transactionCount);

  return (
    <>
      <PeriodControls transactionCount={transactionCount} view="account" />
      <AccountCashFlowSummary cashFlow={cashFlow} currency={account?.currency ?? "EUR"} />
      <TransactionsPanel
        categories={categories}
        emptyState={<Empty title={t("emptyTitle")} illustration={null}>{t("emptyBody")}</Empty>}
        filterHref={account ? accountTransactionsHref(account) : "/transactions"}
        importAccountId={account && acceptsFileImport(account) ? account.id : null}
        list={list}
        page={page}
        view="account"
      />
    </>
  );
}
