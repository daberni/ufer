import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fireEvent, render, within } from "@testing-library/react";
import { createElement } from "react";
import type { BalancePoint, ReportedBalance } from "../src/features/accounts/types";
import { browser } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const dailyBalances: BalancePoint[] = [{
  date: "2026-01-01",
  amount_minor: 10000,
  source: "transactions",
  bank_balance_type: "CLAV"
}, {
  date: "2026-01-04",
  amount_minor: 12000,
  source: "transactions",
  bank_balance_type: null
}, {
  date: "2026-01-11",
  amount_minor: 9000,
  source: "transactions",
  bank_balance_type: null
}];

async function showHistory(context: TestContext, balances = dailyBalances, reported: ReportedBalance[] = []) {
  browser(context);
  const { BalanceHistoryPanel } = await import("../src/features/accounts/components/balance-history");

  return render(createElement(BalanceHistoryPanel, {
    history: {
      status: "ready",
      data: {
        currency: "EUR",
        balances,
        reported
      }
    }
  }));
}

function sizePlot(plot: HTMLElement) {
  plot.getBoundingClientRect = () => ({
    left: 100,
    right: 500,
    top: 0,
    bottom: 160,
    width: 400,
    height: 160,
    x: 100,
    y: 0,
    toJSON: () => ({})
  });
}

test("reported balances list their difference and mark where it starts while calculated days remain keyboard-explorable", async context => {
  const balances: BalancePoint[] = Array.from({
    length: 12
  }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    amount_minor: 10000 + index * 100,
    source: "transactions",
    bank_balance_type: null
  }));
  const reported: ReportedBalance[] = Array.from({
    length: 6
  }, (_, index) => ({
    date: `2026-01-${String(index * 2 + 1).padStart(2, "0")}`,
    amount_minor: 10000 + index * 200 - (index >= 3 ? 500 : 0),
    bank_balance_type: "CLBD",
    calculated_minor: 10000 + index * 200,
    difference_minor: index >= 3 ? -500 : 0,
    difference_started: index === 3
  }));
  const screen = await showHistory(context, balances, reported);
  const table = screen.getByRole("table");

  assert.equal(within(table).getAllByRole("row").length, 6);
  assert.equal(within(table).getAllByText("Difference starts").length, 1);
  assert.ok(screen.getByText(/The current difference first appeared on/).textContent?.includes("Jan 7, 2026"));
  fireEvent.click(screen.getByRole("button", {
    name: "Show all 6 reported balances"
  }));
  assert.equal(within(table).getAllByRole("row").length, 7);

  const plot = screen.getByRole("slider", {
    name: "Balance history"
  });

  fireEvent.focus(plot);
  fireEvent.keyDown(plot, {
    key: "Home"
  });
  fireEvent.keyDown(plot, {
    key: "ArrowRight"
  });
  assert.match(plot.getAttribute("aria-valuetext") || "", /Jan 2, 2026.*101\.00.*From bookings/);
  fireEvent.keyDown(plot, {
    key: "End"
  });
  assert.match(plot.getAttribute("aria-valuetext") || "", /Jan 12, 2026/);
  const beforeShortcut = plot.getAttribute("aria-valuetext");

  assert.equal(fireEvent.keyDown(plot, {
    key: "ArrowLeft",
    altKey: true
  }), true);
  assert.equal(plot.getAttribute("aria-valuetext"), beforeShortcut);
});

test("hovering a step shows the balance effective there rather than the next observation", async context => {
  const screen = await showHistory(context);
  const plot = screen.getByRole("slider", {
    name: "Balance history"
  });

  sizePlot(plot);
  fireEvent.pointerMove(plot, {
    pointerType: "mouse",
    clientX: 219
  });
  assert.match(plot.getAttribute("aria-valuetext") || "", /Jan 1, 2026.*100\.00.*From bookings/);
  fireEvent.pointerMove(plot, {
    pointerType: "mouse",
    clientX: 220
  });
  assert.match(plot.getAttribute("aria-valuetext") || "", /Jan 4, 2026.*120\.00.*From bookings/);
  fireEvent.pointerMove(plot, {
    pointerType: "mouse",
    clientX: 600
  });
  assert.match(plot.getAttribute("aria-valuetext") || "", /Jan 11, 2026.*90\.00/);
});

test("touch selection persists after release, follows a scrub, and dismisses outside or on Escape", async context => {
  const screen = await showHistory(context);
  const plot = screen.getByRole("slider", {
    name: "Balance history"
  });

  sizePlot(plot);
  fireEvent.pointerDown(plot, {
    pointerType: "touch",
    clientX: 100,
    button: 0
  });
  fireEvent.pointerMove(plot, {
    pointerType: "touch",
    clientX: 220,
    buttons: 1
  });
  fireEvent.pointerLeave(plot, {
    pointerType: "touch"
  });
  assert.equal(plot.getAttribute("data-active"), "");
  assert.match(plot.getAttribute("aria-valuetext") || "", /Jan 4, 2026/);
  fireEvent.pointerDown(document.body, {
    pointerType: "touch"
  });
  assert.equal(plot.getAttribute("data-active"), null);
  fireEvent.focus(plot);
  fireEvent.keyDown(plot, {
    key: "Home"
  });
  assert.equal(plot.getAttribute("data-active"), "");
  fireEvent.keyDown(plot, {
    key: "Escape"
  });
  assert.equal(plot.getAttribute("data-active"), null);
});

test("ledger-only history has an interactive chart without an empty recorded-balances table", async context => {
  const screen = await showHistory(context, dailyBalances.map(balance => ({
    ...balance,
    source: "transactions",
    bank_balance_type: null
  })));

  assert.equal(screen.queryByRole("table") === null, true);
  const plot = screen.getByRole("slider", {
    name: "Balance history"
  });

  fireEvent.focus(plot);
  fireEvent.keyDown(plot, {
    key: "Home"
  });
  assert.match(plot.getAttribute("aria-valuetext") || "", /Jan 1, 2026.*100\.00.*From bookings/);
});
