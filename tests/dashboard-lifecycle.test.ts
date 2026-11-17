import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { usePathname } from "next/navigation";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { api } from "../src/client/api";
import { invalidate } from "../src/client/invalidate";
import { queryKeys } from "../src/client/query-keys";
import { useActionFeedback } from "../src/components/ui/use-action-feedback";
import { AppStoreProvider, onView, useAppStore } from "../src/client/app-store";
import { useDashboardNavigation } from "../src/features/dashboard/use-dashboard-navigation";
import { replacePage, useViewQuery, useView } from "../src/client/use-app-url";
import { signInMeta, useSessionLock } from "../src/client/use-session-lock";
import { useLoadError } from "../src/features/dashboard/use-load-error";
import { loadingDelay, useAreaResult } from "../src/components/ui/use-area-result";
import { useCashFlow } from "../src/features/reports/queries";
import { useAccounts, useNetWorth } from "../src/features/accounts/queries";
import { useTransactionListView } from "../src/features/transactions/use-transaction-list-view";
import { useTransactionCategory } from "../src/features/transactions/use-transaction-category";
import { useConnectBank } from "../src/features/banking/mutations";
import type { Transaction } from "../src/features/transactions/types";
import { currentMonthPeriod, monthPeriod, serializePeriod, type Period } from "../src/lib/period";
import type { ViewQuery } from "../src/client/app-location";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";

function viewQuery(changes: Partial<ViewQuery> = {}): ViewQuery {
  return {
    period: currentMonthPeriod(),
    currency: "EUR",
    search: "",
    account: "",
    category: "",
    syncRun: "",
    page: 1,
    ...changes
  };
}

function queryWrapper(queryClient: QueryClient) {
  return function wrapper({ children }: {
    children: ReactNode
  }) {
    return withQueryClient(queryClient, createElement(AppStoreProvider, {
      locked: false
    }, children));
  };
}

function previousMonth(period: Period) {
  assert.equal(period.kind, "month");

  return monthPeriod(period.month.subtract({
    months: 1
  }));
}

function transactionPage(transactionCount: number, page = 1) {
  return Response.json({
    period: {
      kind: "all"
    },
    page,
    transactionCount,
    transactions: []
  });
}

function cashFlow(currency: string) {
  return Response.json({
    period: {
      kind: "all"
    },
    currency,
    income: 0,
    expenses: 0,
    breakdown: [],
    trend: []
  });
}

function netWorth(currency: string) {
  return Response.json({
    currency,
    netWorth: 0,
    liquidity: 0,
    investments: 0,
    property: 0,
    liabilities: 0,
    unvalued: 0
  });
}

// The areas a filter change can affect: net worth follows the currency, cash flow the currency and period, the list every filter.
function useDashboardResults(query: ViewQuery) {
  return {
    netWorth: useAreaResult(useNetWorth(query.currency)),
    cashFlow: useAreaResult(useCashFlow(query.period, query.currency)),
    list: useTransactionListView(query, () => {}),
    loadError: useLoadError()
  };
}

function statuses(results: ReturnType<typeof useDashboardResults>) {
  return {
    netWorth: results.netWorth.status,
    cashFlow: results.cashFlow.status,
    transactions: results.list.status
  };
}

async function renderResults(context: Parameters<typeof browser>[0]) {
  const environment = browser(context);
  const rendered = renderHook(({ query }) => useDashboardResults(query), {
    initialProps: {
      query: viewQuery()
    },
    wrapper: queryWrapper(environment.queryClient)
  });

  await wait(0);
  await respond(environment.requests("reports/net-worth")[0], netWorth("EUR"));
  await respond(environment.requests("reports/cash-flow")[0], cashFlow("EUR"));
  await respond(environment.requests("transactions")[0], transactionPage(1));

  return {
    ...environment,
    ...rendered
  };
}

test("a delayed pre-logout response cannot reopen the dashboard or restore financial state", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  const { result } = renderHook(() => ({
    lock: useSessionLock(),
    accounts: useAccounts()
  }), {
    wrapper: queryWrapper(queryClient)
  });

  await wait(0);
  assert.equal(requests("accounts").length, 1);
  act(() => result.current.lock.lock());
  await respond(requests("accounts")[0], Response.json([{
    id: "synthetic-account"
  }]));

  assert.equal(result.current.lock.locked, true);
  assert.equal(queryClient.getQueryData(queryKeys.accounts()), undefined);
});

test("a read rejected with 401 locks the dashboard and drops cached financial data", async context => {
  const {
    queryClient,
    requests
  } = browser(context);

  queryClient.setQueryData(queryKeys.categories(), []);
  const { result } = renderHook(() => ({
    lock: useSessionLock(),
    accounts: useAccounts()
  }), {
    wrapper: queryWrapper(queryClient)
  });

  await wait(0);
  await respond(requests("accounts")[0], Response.json({
    title: "Unauthorized",
    detail: "Sign in to continue."
  }, {
    status: 401
  }));

  assert.equal(result.current.lock.locked, true);
  assert.equal(queryClient.getQueryData(queryKeys.categories()), undefined);
});

test("a write rejected with 401 locks the dashboard and drops pending changes, while a rejected sign-in stays a form error", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  const transaction = {
    id: "synthetic-entry",
    category_id: "groceries",
    category_source: "rule"
  } as Transaction;

  queryClient.setQueryData(queryKeys.categories(), []);
  const { result } = renderHook(() => ({
    lock: useSessionLock(),
    row: useTransactionCategory(transaction),
    connect: useConnectBank(),
    signIn: useMutation({
      meta: signInMeta,
      mutationFn: () => api("auth/sign-in/username", {})
    })
  }), {
    wrapper: queryWrapper(queryClient)
  });
  const unauthorized = () => Response.json({
    title: "Unauthorized",
    detail: "Sign in to continue."
  }, {
    status: 401
  });

  act(() => result.current.signIn.mutate());
  await wait(0);
  await respond(requests("auth/sign-in/username")[0], unauthorized());

  assert.equal(result.current.lock.locked, false);
  assert.equal(result.current.signIn.error?.message, "Sign in to continue.");

  act(() => result.current.row.change("leisure"));
  await wait(0);
  assert.equal(result.current.row.categoryId, "leisure");

  act(() => result.current.connect.mutate({
    bank: "Example bank",
    country: "AT"
  }));
  await wait(0);
  await respond(requests("banking/connect")[0], unauthorized());

  assert.equal(result.current.lock.locked, true);
  assert.equal(queryClient.getQueryData(queryKeys.categories()), undefined);
  // The pending change left with the cleared caches, so the row cannot show it again after signing in.
  assert.equal(result.current.row.categoryId, "groceries");
  assert.equal(result.current.row.status, undefined);

  await respond(requests("transactions/synthetic-entry")[0], unauthorized());
  assert.equal(result.current.row.categoryId, "groceries");
});

test("a bank authorization that completes after the dashboard locked does not leave the sign-in form", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  const { result } = renderHook(() => ({
    lock: useSessionLock(),
    connect: useConnectBank()
  }), {
    wrapper: queryWrapper(queryClient)
  });
  // A same-document URL stands in for the bank's consent page, which the test environment cannot load.
  const consentPage = () => Response.json({
    url: "#bank-consent"
  });
  const bank = {
    bank: "Example bank",
    country: "AT"
  };

  act(() => result.current.connect.mutate(bank));
  await wait(0);
  act(() => result.current.lock.lock());
  await respond(requests("banking/connect")[0], consentPage());

  assert.equal(window.location.hash, "");

  act(() => result.current.lock.unlock());
  act(() => result.current.connect.mutate(bank));
  await wait(0);
  await respond(requests("banking/connect")[1], consentPage());

  assert.equal(window.location.hash, "#bank-consent");
});

test("an older response cannot replace the results for newer filters", async context => {
  const {
    rerender,
    requests,
    result
  } = await renderResults(context);

  rerender({
    query: viewQuery({
      currency: "USD"
    })
  });
  await wait(0);
  rerender({
    query: viewQuery({
      currency: "CHF"
    })
  });
  await wait(0);
  await respond(requests("reports/net-worth")[2], netWorth("CHF"));
  await respond(requests("reports/net-worth")[1], netWorth("USD"));

  assert.equal(result.current.netWorth.data?.currency, "CHF");
  assert.equal(result.current.netWorth.status, "ready");
});

test("a write completed after a filter change refreshes the results for the current filters", async context => {
  const {
    queryClient,
    rerender,
    requests,
    result
  } = await renderResults(context);

  rerender({
    query: viewQuery({
      currency: "USD"
    })
  });
  await wait(0);
  await respond(requests("transactions")[1], transactionPage(0));

  // A mutation that started before the change invalidates the list when it settles.
  const refresh = invalidate(queryClient, [queryKeys.transactions.all()]);

  await wait(0);
  assert.equal(requests("transactions").length, 3);
  assert.equal(requests("transactions")[2].url.searchParams.get("currency"), "USD");
  await respond(requests("transactions")[2], transactionPage(2));
  await act(() => refresh);

  assert.equal(result.current.list.data?.transactionCount, 2);
  assert.equal(result.current.list.status, "ready");
});

test("a period change marks the period results as loading until the response for that period arrives", async context => {
  const {
    rerender,
    requests,
    result
  } = await renderResults(context);
  const period = previousMonth(currentMonthPeriod());

  rerender({
    query: viewQuery({
      period
    })
  });
  await wait(loadingDelay);

  assert.deepEqual(statuses(result.current), {
    netWorth: "ready",
    cashFlow: "loading",
    transactions: "loading"
  });
  assert.equal(requests("reports/net-worth").length, 1);

  await respond(requests("reports/cash-flow")[1], cashFlow("EUR"));
  await respond(requests("transactions")[1], transactionPage(2));

  assert.deepEqual(statuses(result.current), {
    netWorth: "ready",
    cashFlow: "ready",
    transactions: "ready"
  });
  assert.equal(result.current.list.data?.transactionCount, 2);
  assert.equal(requests("transactions")[1].url.searchParams.get("period"), serializePeriod(period));
});

test("a transaction filter change marks only the transaction list as loading", async context => {
  const {
    rerender,
    requests,
    result
  } = await renderResults(context);

  for (const changes of [{
    search: "rent"
  }, {
    account: "synthetic-account"
  }, {
    category: "uncategorized"
  }]) {
    rerender({
      query: viewQuery(changes)
    });
    await wait(loadingDelay);

    assert.deepEqual(statuses(result.current), {
      netWorth: "ready",
      cashFlow: "ready",
      transactions: "loading"
    }, JSON.stringify(changes));
  }

  assert.equal(requests("reports/cash-flow").length, 1);
});

test("a fast response replaces the results without showing loading first", async context => {
  const {
    rerender,
    requests,
    result
  } = await renderResults(context);
  const seen: string[] = [];

  rerender({
    query: viewQuery({
      currency: "USD"
    })
  });
  await wait(loadingDelay - 1);
  seen.push(result.current.netWorth.status);
  await respond(requests("reports/net-worth")[1], netWorth("USD"));
  await wait(loadingDelay);
  seen.push(result.current.netWorth.status);

  assert.deepEqual(seen, ["ready", "ready"]);
  assert.equal(result.current.netWorth.data?.currency, "USD");
});

test("a background refresh with unchanged filters keeps the current results visible", async context => {
  const {
    queryClient,
    requests,
    result
  } = await renderResults(context);

  void invalidate(queryClient, [queryKeys.transactions.all()]);
  await wait(loadingDelay);

  assert.equal(requests("transactions").length, 2);
  assert.equal(result.current.list.status, "ready");
  assert.equal(result.current.list.data?.transactionCount, 1);
});

test("after rapid period changes only the response for the latest period ends loading", async context => {
  const {
    rerender,
    requests,
    result
  } = await renderResults(context);
  const first = previousMonth(currentMonthPeriod());
  const second = previousMonth(first);

  rerender({
    query: viewQuery({
      period: first
    })
  });
  await wait(50);
  rerender({
    query: viewQuery({
      period: second
    })
  });
  await wait(loadingDelay);
  await respond(requests("transactions")[1], transactionPage(5));

  assert.equal(result.current.list.status, "loading");
  assert.equal(result.current.list.data?.transactionCount, 1);

  await respond(requests("transactions")[2], transactionPage(7));

  assert.equal(result.current.list.status, "ready");
  assert.equal(result.current.list.data?.transactionCount, 7);
  assert.equal(requests("transactions")[2].url.searchParams.get("period"), serializePeriod(second));
});

test("a failed request for changed filters ends loading and masks the outdated results until a retry succeeds", async context => {
  const {
    rerender,
    requests,
    result
  } = await renderResults(context);

  rerender({
    query: viewQuery({
      period: previousMonth(currentMonthPeriod())
    })
  });
  await wait(loadingDelay);
  assert.equal(result.current.cashFlow.status, "loading");
  await respond(requests("reports/cash-flow")[1], Response.json({
    detail: "The database is not reachable."
  }, {
    status: 500
  }));
  await respond(requests("transactions")[1], Response.json({
    detail: "The database is not reachable."
  }, {
    status: 500
  }));

  assert.equal(result.current.loadError.failure?.message ?? "", "The database is not reachable.");
  assert.deepEqual(statuses(result.current), {
    netWorth: "ready",
    cashFlow: "unavailable",
    transactions: "unavailable"
  });
  // The outdated results keep the layout while they are masked.
  assert.equal(result.current.list.data?.transactionCount, 1);

  act(() => result.current.loadError.retry());
  await wait(0);
  assert.equal(result.current.cashFlow.status, "loading");
  assert.equal(result.current.loadError.failure?.message ?? "", "The database is not reachable.");
  await respond(requests("reports/cash-flow")[2], cashFlow("EUR"));
  await respond(requests("transactions")[2], transactionPage(3));

  assert.equal(result.current.loadError.failure?.message ?? "", "");
  assert.equal(result.current.cashFlow.status, "ready");
  assert.equal(result.current.list.data?.transactionCount, 3);
});

function databaseFailure() {
  return Response.json({
    title: "Internal Server Error",
    detail: "The database is not reachable."
  }, {
    status: 500
  });
}

test("an area without results reports its failed first load in place and retries it there", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  const { result } = renderHook(() => ({
    accounts: useAreaResult(useAccounts()),
    loadError: useLoadError()
  }), {
    wrapper: queryWrapper(queryClient)
  });

  await wait(0);
  assert.equal(result.current.accounts.status, "pending");
  assert.equal(result.current.loadError.announcement, "Loading your data …");
  await respond(requests("accounts")[0], databaseFailure());

  const pending = result.current.accounts;

  assert.equal(pending.status, "pending");
  assert.equal(pending.failure?.message, "The database is not reachable.");
  // The skeleton's place shows the failure, so the banner does not repeat it.
  assert.equal(result.current.loadError.failure?.message ?? "", "");
  assert.equal(result.current.loadError.announcement, "Some of your data could not be loaded.");

  act(() => pending.failure?.retry());
  await wait(0);
  assert.equal(requests("accounts").length, 2);
  assert.deepEqual(result.current.accounts, {
    status: "pending",
    failure: null
  });
  assert.equal(result.current.loadError.announcement, "Loading your data …");
  await respond(requests("accounts")[1], Response.json([]));

  assert.deepEqual(result.current.accounts, {
    data: [],
    status: "ready"
  });
  assert.equal(result.current.loadError.announcement, "");
});

test("a failed reload of shown results stays reported until a later load succeeds", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  const { result } = renderHook(() => ({
    accounts: useAreaResult(useAccounts()),
    loadError: useLoadError()
  }), {
    wrapper: queryWrapper(queryClient)
  });

  await wait(0);
  await respond(requests("accounts")[0], Response.json([]));
  // The banner orders a failure and the last load by their update times, so each load starts a moment after the previous one.
  await wait(1);
  act(() => void queryClient.invalidateQueries({
    queryKey: queryKeys.accounts()
  }));
  await wait(0);
  await respond(requests("accounts")[1], databaseFailure());

  assert.equal(result.current.loadError.failure?.message ?? "", "The database is not reachable.");
  assert.equal(result.current.loadError.announcement, "");
  assert.equal(result.current.accounts.status, "ready");

  await wait(1);
  act(() => result.current.loadError.retry());
  await wait(0);
  // The banner stays while the retry runs instead of disappearing and possibly coming back.
  assert.equal(requests("accounts").length, 3);
  assert.equal(result.current.loadError.failure?.message ?? "", "The database is not reachable.");
  await respond(requests("accounts")[2], Response.json([]));

  assert.equal(result.current.loadError.failure?.message ?? "", "");
});

test("success feedback dismisses itself while problems stay until dismissed", async context => {
  browser(context);
  const { result } = renderHook(() => useActionFeedback());

  act(() => result.current.report({
    tone: "problem",
    messages: ["Sync failed."]
  }));
  act(() => mock.timers.tick(60_000));
  assert.deepEqual(result.current.feedback?.messages, ["Sync failed."]);

  act(() => result.current.report({
    tone: "success",
    messages: ["Rules applied."]
  }));
  act(() => mock.timers.tick(8_000));
  assert.equal(result.current.feedback, null);
});

// Stands in for the App Router, which provides the current route to the dashboard layout; tests navigate with history.replaceState and rerender.
function renderDashboard(context: Parameters<typeof browser>[0], url: string) {
  const environment = browser(context);

  window.history.replaceState(null, "", url);
  const replaced: string[] = [];
  const router = {
    push: () => {},
    replace: (href: string) => {
      replaced.push(href);
    },
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {}
  } as unknown as AppRouterInstance;

  function wrapper({ children }: {
    children: ReactNode
  }) {
    const route = createElement(PathnameContext, {
      value: window.location.pathname
    }, createElement(SearchParamsContext, {
      value: new URLSearchParams(window.location.search)
    }, children));

    return withQueryClient(environment.queryClient, createElement(AppStoreProvider, {
      locked: false
    }, createElement(AppRouterContext, {
      value: router
    }, route)));
  }

  return {
    ...environment,
    ...renderHook(() => {
      useDashboardNavigation();
      const feedback = useAppStore(state => state.feedback);

      return {
        view: useView(),
        feedback: onView(feedback, usePathname()),
        list: useTransactionListView(useViewQuery(), replacePage)
      };
    }, {
      wrapper
    }),
    replaced
  };
}

test("a bank callback result is shown on the connections view and cleared when the view changes", async context => {
  const {
    result,
    rerender,
    replaced
  } = renderDashboard(context, "/connections?banking=connected");

  assert.equal(result.current.view, "connections");
  assert.equal(result.current.feedback?.tone, "success");
  assert.deepEqual(replaced, ["/connections"]);

  window.history.replaceState(null, "", "/");
  rerender();

  assert.equal(result.current.view, "overview");
  assert.equal(result.current.feedback, null);
});

test("a page past the last one is replaced by the last available page", async context => {
  const {
    requests,
    result,
    rerender
  } = renderDashboard(context, "/transactions?page=10");

  await wait(0);
  assert.equal(requests("transactions")[0].url.searchParams.get("page"), "10");
  await respond(requests("transactions")[0], transactionPage(60, 10));

  assert.equal(result.current.list.page, 2);
  assert.equal(window.location.search, "?page=2");

  rerender();
  await wait(0);
  assert.equal(requests("transactions").length, 2);
  assert.equal(requests("transactions")[1].url.searchParams.get("page"), "2");
});

test("an empty transaction history falls back to the first page", async context => {
  const {
    requests,
    result,
    rerender
  } = renderDashboard(context, "/transactions?page=3");

  await wait(0);
  await respond(requests("transactions")[0], transactionPage(0, 3));

  assert.equal(result.current.list.page, 1);
  assert.equal(window.location.search, "");

  rerender();
  await wait(0);
  assert.equal(requests("transactions")[1].url.searchParams.get("page"), "1");
  await respond(requests("transactions")[1], transactionPage(0, 1));
  assert.equal(result.current.list.page, 1);
  assert.equal(requests("transactions").length, 2);
});
