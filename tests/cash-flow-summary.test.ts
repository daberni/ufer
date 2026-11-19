import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSavingsRate, netFlow, selectedCashFlow, trendCashFlow } from "../src/features/reports/cash-flow-selection";
import type { CashFlow } from "../src/features/reports/types";

function month(name: string, income: number, expenses: number): CashFlow["trend"][number] {
  return {
    month: name,
    income,
    expenses,
    incomeBreakdown: [],
    expenseBreakdown: []
  };
}

test("net flow is income minus expenses and the savings rate divides it by income", () => {
  assert.deepEqual(netFlow(250000, 205000), {
    net: 45000,
    savingsRate: 0.18
  });
  assert.equal(formatSavingsRate(netFlow(250000, 205000).savingsRate), "18%");
});

test("expenses above income give a negative net and a negative savings rate", () => {
  const flow = netFlow(200000, 250000);

  assert.equal(flow.net, -50000);
  assert.equal(flow.savingsRate, -0.25);
  assert.equal(formatSavingsRate(flow.savingsRate), "-25%");
});

test("without income there is no savings rate, even when money was spent", () => {
  assert.deepEqual(netFlow(0, 3000), {
    net: -3000,
    savingsRate: null
  });
  assert.equal(netFlow(0, 0).savingsRate, null);
  assert.equal(formatSavingsRate(null), "–");
});

test("the visible months' rate sums their minor units before dividing, so months are weighted by income", () => {
  const flow = trendCashFlow([month("2026-05", 100000, 150000), month("2026-06", 300000, 150000), month("2026-07", 0, 20000)]);

  assert.equal(flow.net, 80000);
  assert.equal(flow.savingsRate, 0.2);
});

test("a selected month carries that month's totals, and an unknown month selects nothing", () => {
  const data: CashFlow = {
    period: {
      kind: "all"
    } as CashFlow["period"],
    currency: "EUR",
    income: 0,
    expenses: 0,
    incomeBreakdown: [],
    expenseBreakdown: [],
    trend: [month("2026-06", 0, 4200), month("2026-07", 100001, 1)]
  };

  assert.equal(selectedCashFlow(data, "2026-06")?.savingsRate, null);
  assert.equal(selectedCashFlow(data, "2026-07")?.net, 100000);
  assert.equal(selectedCashFlow(data, "2026-08"), null);
  assert.equal(selectedCashFlow(data, null), null);
});
