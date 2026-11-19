import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { render, type RenderResult } from "@testing-library/react";
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
        incomeBreakdown: [],
        expenseBreakdown: [],
        trend: []
      }
    }
  }), {
    wrapper
  });
}

function comparisonBar(screen: RenderResult, flow: "income" | "expenses") {
  const bar = screen.container.querySelector<HTMLElement>(`i[data-flow="${flow}"]`);

  assert.ok(bar, `Missing ${flow} comparison bar`);

  return bar;
}

test("one Transactions link preserves the selected period and currency without making all figures navigation targets", async context => {
  const screen = await renderSummary(context, "/?period=2026-10&currency=USD", {
    income: 400000,
    expenses: 300000
  });
  const link = screen.getByRole("link", {
    name: "View transactions"
  });

  assert.equal(screen.getAllByRole("link").length, 1);
  assert.equal(link.getAttribute("href"), "/transactions?period=2026-10&currency=USD");
  assert.ok(screen.getByText("Income"));
  assert.ok(screen.getByText("Expenses"));
  assert.ok(screen.getByText("Monthly cash flow"));
});

test("income and spending bars use the same scale and keep the spending percentage as supporting text", async context => {
  const screen = await renderSummary(context, "/?period=2026-10&currency=USD", {
    income: 400000,
    expenses: 300000
  });

  assert.equal(comparisonBar(screen, "income").style.width, "100%");
  assert.equal(comparisonBar(screen, "expenses").style.width, "75%");
  assert.ok(screen.getByText("Spent 75% of income"));
});

test("spending without income is not compared as a percentage", async context => {
  const screen = await renderSummary(context, "/?period=2026-10&currency=USD", {
    income: 0,
    expenses: 120000
  });

  assert.ok(screen.getByText("No income to compare spending with"));
  assert.equal(screen.queryByText(/%/) === null, true);
  assert.equal(comparisonBar(screen, "income").style.width, "0%");
  assert.equal(comparisonBar(screen, "expenses").style.width, "100%");
});

for (const income of [400000, 0, -40000]) {
  test(`net refunds with income ${income} show an empty comparison rather than negative spending`, async context => {
    const screen = await renderSummary(context, "/?period=2026-10&currency=USD", {
      income,
      expenses: -100000
    });

    assert.ok(screen.getByText("Refunds exceeded spending"));
    assert.equal(comparisonBar(screen, "expenses").style.width, "0%");
    assert.equal(comparisonBar(screen, "income").style.width, income > 0 ? "100%" : "0%");
    assert.equal(screen.queryByText(/Spent -/) === null, true);
    assert.match(screen.getByText("Expenses").parentElement?.textContent || "", /-.*1,000\.00/);
  });
}

test("a period with no net spending has an empty comparison", async context => {
  const screen = await renderSummary(context, "/?period=2026-10&currency=USD", {
    income: 400000,
    expenses: 0
  });

  assert.ok(screen.getByText("No spending this period"));
  assert.equal(comparisonBar(screen, "expenses").style.width, "0%");
  assert.equal(comparisonBar(screen, "income").style.width, "100%");
});

test("overspending keeps the real percentage while the comparison bar stops at its full width", async context => {
  const screen = await renderSummary(context, "/?period=2026-10&currency=USD", {
    income: 400000,
    expenses: 1100000
  });

  assert.ok(screen.getByText("Spent 275% of income"));
  assert.equal(comparisonBar(screen, "expenses").style.width, "100%");
  assert.ok(Math.abs(Number.parseFloat(comparisonBar(screen, "income").style.width) - 36.36) < 0.01);
});

test("a period without income or spending keeps both comparison bars empty", async context => {
  const screen = await renderSummary(context, "/?period=2026-10&currency=USD", {
    income: 0,
    expenses: 0
  });

  assert.ok(screen.getByText("No spending this period"));
  assert.equal(comparisonBar(screen, "income").style.width, "0%");
  assert.equal(comparisonBar(screen, "expenses").style.width, "0%");
});
