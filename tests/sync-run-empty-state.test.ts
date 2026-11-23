import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "./fixtures/intl";
import { createElement, type ReactNode } from "react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AppStoreProvider } from "../src/client/app-store";
import { periodScope, viewQuery } from "../src/client/app-location";
import { queryKeys } from "../src/client/query-keys";
import { transactionListFilters } from "../src/features/transactions/queries";
import { periodToJson } from "../src/lib/period";
import { browser, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

for (const filtered of [true, false]) {
  test(`an empty sync-run list ${filtered ? "narrowed by type reports no matches" : "without filters retains its provenance explanation"}`, async context => {
    const params = new URLSearchParams(filtered ? "syncRun=synthetic-run&type=income" : "syncRun=synthetic-run");
    const query = viewQuery("/transactions", periodScope(params), params);
    const { queryClient } = browser(context, `http://localhost/transactions?${params}`);

    queryClient.setDefaultOptions({
      queries: {
        staleTime: Infinity
      }
    });
    queryClient.setQueryData(queryKeys.accounts(), []);
    queryClient.setQueryData(queryKeys.categories(), []);
    queryClient.setQueryData(queryKeys.transactions.list(transactionListFilters(query)), {
      period: periodToJson(query.period),
      page: 1,
      transactionCount: 0,
      transactions: [],
      syncRun: {
        id: "synthetic-run",
        started_at: "2026-11-01T08:00:00Z",
        status: "SUCCESS",
        inserted_count: 3,
        linked_count: 3,
        error: null
      }
    });
    const { TransactionsPage } = await import("../src/features/dashboard/components/dashboard-views");
    const router = {
      push: () => {}
    } as unknown as AppRouterInstance;

    function wrapper({ children }: {
      children: ReactNode
    }) {
      const route = createElement(PathnameContext, {
        value: "/transactions"
      }, createElement(SearchParamsContext, {
        value: params
      }, children));

      return withQueryClient(queryClient, createElement(AppStoreProvider, {
        locked: false
      }, createElement(AppRouterContext, {
        value: router
      }, route)));
    }

    const screen = render(createElement(TransactionsPage), {
      wrapper
    });

    assert.ok(screen.getByRole("heading", {
      name: filtered ? "No matching transactions" : "Transactions not traceable"
    }));
    assert.equal(screen.queryByText(filtered ? "Transactions not traceable" : "No matching transactions"), null);
  });
}
