import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fireEvent, render, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { Temporal } from "temporal-polyfill";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AppStoreProvider } from "../src/client/app-store";
import { BankingConfigurationProvider } from "../src/features/banking/banking-configuration";
import { monthPeriod, periodToJson } from "../src/lib/period";
import type { CashFlow, CategoryAmount } from "../src/features/reports/types";
import { browser } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

function category(name: string, amount: number): CategoryAmount {
  return {
    categoryId: name.toLowerCase(),
    name,
    amount,
    color: "#638777",
    icon: null
  };
}

const cashFlow: CashFlow = {
  period: periodToJson(monthPeriod(Temporal.PlainYearMonth.from("2026-07"))),
  currency: "EUR",
  income: 300000,
  expenses: 10000,
  breakdown: [category("Food", 10000)],
  trend: [{
    month: "2026-06",
    income: 200000,
    expenses: 100000,
    incomeBreakdown: [category("Salary", 200000)],
    expenseBreakdown: [category("Rent", 80000), category("Travel", 20000)]
  }, {
    month: "2026-07",
    income: 300000,
    expenses: 10000,
    incomeBreakdown: [category("Salary", 300000)],
    expenseBreakdown: [category("Food", 10000)]
  }]
};

async function showReports(context: TestContext) {
  browser(context, "http://localhost/?period=2026-07");
  const previousNode = Object.getOwnPropertyDescriptor(globalThis, "Node");

  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: window.Node
  });
  Object.assign(globalThis, {
    self: window
  });
  context.after(() => {
    if (previousNode) {
      Object.defineProperty(globalThis, "Node", previousNode);
    } else {
      Reflect.deleteProperty(globalThis, "Node");
    }

    Reflect.deleteProperty(globalThis, "self");
  });
  const { OverviewView } = await import("../src/features/dashboard/components/overview-view");
  const props = {
    currencyAccounts: {
      status: "ready" as const,
      data: []
    },
    netWorth: {
      status: "ready" as const,
      data: {
        currency: "EUR",
        netWorth: 0,
        liquidity: 0,
        investments: 0,
        property: 0,
        liabilities: 0,
        unvalued: 0
      }
    },
    cashFlow: {
      status: "ready" as const,
      data: cashFlow
    }
  };
  const router = {
    push: () => {}
  } as unknown as AppRouterInstance;

  function wrapper({ children }: {
    children: ReactNode
  }) {
    const route = createElement(PathnameContext, {
      value: "/"
    }, createElement(SearchParamsContext, {
      value: new URLSearchParams(window.location.search)
    }, children));

    return createElement(AppStoreProvider, {
      locked: false
    }, createElement(AppRouterContext, {
      value: router
    }, createElement(BankingConfigurationProvider, {
      configuration: {
        environment: "SANDBOX",
        configured: false
      },
      children: route
    })));
  }

  const screen = render(createElement(OverviewView, props), {
    wrapper
  });

  return {
    ...screen,
    changeScope: (url: string) => {
      window.history.replaceState(null, "", url);
      screen.rerender(createElement(OverviewView, props));
    },
    panel: () => screen.getByRole("heading", {
      name: /Where your money goes|Spending by category|Income by category/
    }).closest("section")!
  };
}

function pointerOver(target: Element, pointerType: "mouse" | "touch") {
  const event = new window.Event("pointerover", {
    bubbles: true
  });

  Object.defineProperty(event, "pointerType", {
    value: pointerType
  });
  fireEvent(target, event);
}

test("hovering a monthly flow updates the existing category panel without a second breakdown", async context => {
  const screen = await showReports(context);
  const bar = screen.getByRole("button", {
    name: /June 2026 expenses:/
  });

  assert.ok(within(screen.panel()).getByText("Food"));
  pointerOver(bar, "mouse");
  assert.ok(within(screen.panel()).getByRole("heading", {
    name: "Spending by category"
  }));
  assert.ok(within(screen.panel()).getByText("June 2026"));
  assert.ok(within(screen.panel()).getByText("Rent"));
  assert.equal(within(screen.panel()).queryByText("Food"), null);
  assert.equal(screen.container.querySelector('[class*="details-slot"]'), null);
  assert.equal(bar.getAttribute("aria-controls"), screen.panel().id);
  fireEvent.keyDown(document, {
    key: "Escape"
  });
  assert.ok(within(screen.panel()).getByText("Food"));
});

test("touch selection survives interaction with the adjacent panel and clears outside the shared reports", async context => {
  const screen = await showReports(context);
  const bar = screen.getByRole("button", {
    name: /June 2026 income:/
  });

  pointerOver(bar, "touch");
  assert.ok(within(screen.panel()).getByText("Food"));
  fireEvent.click(bar);
  assert.ok(within(screen.panel()).getByRole("heading", {
    name: "Income by category"
  }));
  assert.ok(within(screen.panel()).getByText("Salary"));
  fireEvent.pointerDown(screen.panel());
  assert.ok(within(screen.panel()).getByText("Salary"));
  fireEvent.pointerDown(document.body);
  assert.ok(within(screen.panel()).getByText("Food"));
});

test("keyboard focus follows the monthly breakdown and period or currency changes clear the selection", async context => {
  const screen = await showReports(context);
  const income = screen.getByRole("button", {
    name: /June 2026 income:/
  });

  fireEvent.focus(income);
  assert.ok(within(screen.panel()).getByText("Salary"));
  screen.changeScope("/?period=2026-08");
  assert.ok(within(screen.panel()).getByText("Food"));
  fireEvent.focus(screen.getByRole("button", {
    name: /June 2026 expenses:/
  }));
  assert.ok(within(screen.panel()).getByText("Rent"));
  screen.changeScope("/?period=2026-08&currency=USD");
  assert.ok(within(screen.panel()).getByText("Food"));
});


test("a pointer-selected breakdown survives blur inside the report while keyboard departure clears it", async context => {
  const screen = await showReports(context);
  const income = screen.getByRole("button", {
    name: /June 2026 income:/
  });

  fireEvent.click(income);
  fireEvent.focus(income);
  const press = new window.Event("pointerdown", {
    bubbles: true
  });

  Object.defineProperty(press, "pointerType", {
    value: "touch"
  });
  fireEvent(screen.panel(), press);
  fireEvent.blur(income, {
    relatedTarget: null
  });
  assert.ok(within(screen.panel()).getByText("Salary"));
  fireEvent.keyDown(income, {
    key: "Tab"
  });
  fireEvent.blur(income, {
    relatedTarget: document.body
  });
  assert.ok(within(screen.panel()).getByText("Food"));
});
