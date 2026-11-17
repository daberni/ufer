import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { Temporal } from "temporal-polyfill";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AppStoreProvider } from "../src/client/app-store";
import { monthPeriod, periodToJson } from "../src/lib/period";
import { browser } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {}
} as unknown as AppRouterInstance;

async function renderSummary(context: TestContext, url: string, flows: {
  income: number;
  expenses: number;
}) {
  browser(context, `http://localhost${url}`);
  // Next.js links schedule prefetching through the browser's global `self`, which Node does not define.
  Object.assign(globalThis, {
    self: window
  });
  context.after(() => {
    Reflect.deleteProperty(globalThis, "self");
  });
  const { WealthSummary } = await import("../src/features/reports/components/wealth-summary");

  function wrapper({ children }: {
    children: ReactNode
  }) {
    const route = createElement(PathnameContext, {
      value: window.location.pathname
    }, createElement(SearchParamsContext, {
      value: new URLSearchParams(window.location.search)
    }, children));

    return createElement(AppStoreProvider, {
      locked: false
    }, createElement(AppRouterContext, {
      value: router
    }, route));
  }

  return render(createElement(WealthSummary, {
    hasAccounts: true,
    netWorthArea: {
      status: "ready",
      data: {
        currency: "USD",
        netWorth: 0,
        liquidity: 0,
        investments: 0,
        property: 0,
        liabilities: 0,
        unvalued: 0
      }
    },
    cashFlowArea: {
      status: "ready",
      data: {
        period: periodToJson(monthPeriod(Temporal.PlainYearMonth.from("2026-10"))),
        currency: "USD",
        income: flows.income,
        expenses: flows.expenses,
        breakdown: [],
        trend: []
      }
    }
  }), {
    wrapper
  });
}

test("income, expenses and the monthly result open the transactions of the selected period and currency", async context => {
  const screen = await renderSummary(context, "/?period=2026-10&currency=USD", {
    income: 400000,
    expenses: 300000
  });
  const links = ["Income", "Expenses", "Monthly cash flow"].map(name => screen.getByRole("link", {
    name: new RegExp(name)
  }));

  for (const link of links) {
    assert.equal(link.getAttribute("href"), "/transactions?period=2026-10&currency=USD");
  }

  assert.ok(screen.getByText("Spent 75% of income"));
});

test("spending without income is not compared as a percentage", async context => {
  const screen = await renderSummary(context, "/?period=2026-10&currency=USD", {
    income: 0,
    expenses: 120000
  });

  assert.ok(screen.getByText("No income to compare spending with"));
  assert.equal(screen.queryByText(/%/), null);
});
