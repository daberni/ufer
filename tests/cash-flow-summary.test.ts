import assert from "node:assert/strict";
import { test } from "node:test";
import { edgeNet, hasCashFlowToDraw, formatSavingsRate, netFlow, reservedCategoryRows, selectedCashFlow, trendCashFlow } from "../src/features/reports/cash-flow-selection";
import { cashFlowScale, scaleOffset } from "../src/features/reports/cash-flow-scale";
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
  assert.equal(formatSavingsRate(netFlow(250000, 205000).savingsRate, "en"), "18%");
});

test("expenses above income give a negative net and a negative savings rate", () => {
  const flow = netFlow(200000, 250000);

  assert.equal(flow.net, -50000);
  assert.equal(flow.savingsRate, -0.25);
  assert.equal(formatSavingsRate(flow.savingsRate, "en"), "-25%");
});

test("without income there is no savings rate, even when money was spent", () => {
  assert.deepEqual(netFlow(0, 3000), {
    net: -3000,
    savingsRate: null
  });
  assert.equal(netFlow(0, 0).savingsRate, null);
  assert.equal(formatSavingsRate(null, "en"), "–");
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
    leadIn: month("2026-05", 0, 0),
    trend: [month("2026-06", 0, 4200), month("2026-07", 100001, 1)]
  };

  assert.equal(selectedCashFlow(data, "2026-06")?.savingsRate, null);
  assert.equal(selectedCashFlow(data, "2026-07")?.net, 100000);
  assert.equal(selectedCashFlow(data, "2026-08"), null);
  assert.equal(selectedCashFlow(data, null), null);
});

test("a savings rate that rounds to zero shows 0% without a sign", () => {
  assert.equal(formatSavingsRate(-0.001, "en"), "0%");
  assert.equal(formatSavingsRate(0.004, "en"), "0%");
  assert.equal(formatSavingsRate(-0.004, "en"), "0%");
  assert.equal(formatSavingsRate(-0.005, "en"), "-1%");
  assert.equal(formatSavingsRate(-0.006, "en"), "-1%");
});

test("panel columns reserve the most rows any month or the period needs, at least one", () => {
  const amount = (name: string) => ({
    categoryId: name,
    name,
    color: "#638777",
    icon: null,
    amount: 100
  });
  const data: CashFlow = {
    period: {
      kind: "all"
    } as CashFlow["period"],
    currency: "EUR",
    income: 0,
    expenses: 0,
    incomeBreakdown: [],
    expenseBreakdown: [amount("a")],
    leadIn: month("2026-05", 0, 0),
    trend: [{
      ...month("2026-06", 100, 300),
      incomeBreakdown: [amount("salary"), amount("interest")],
      expenseBreakdown: ["a", "b", "c", "d", "e", "f", "g"].map(amount)
    }, month("2026-07", 0, 0)]
  };

  assert.deepEqual(reservedCategoryRows(data), {
    income: 2,
    expenses: 5
  });
  assert.deepEqual(reservedCategoryRows({
    ...data,
    expenseBreakdown: [],
    trend: [month("2026-07", 0, 0)]
  }), {
    income: 1,
    expenses: 1
  });
});

test("the net area's left edge lies halfway to the previous month's net, from hidden trend months or the month before the trend", () => {
  const data: CashFlow = {
    period: {
      kind: "all"
    } as CashFlow["period"],
    currency: "EUR",
    income: 0,
    expenses: 0,
    incomeBreakdown: [],
    expenseBreakdown: [],
    leadIn: month("2026-04", 1000, 9000),
    trend: [month("2026-05", 10000, 2000), month("2026-06", 3000, 1000), month("2026-07", 0, 0)]
  };

  // All three months visible: the month before the trend (net -8000) and May (net 8000).
  assert.equal(edgeNet(data, 3), 0);
  // Two visible: hidden May (net 8000) and June (net 2000).
  assert.equal(edgeNet(data, 2), 5000);
  assert.equal(edgeNet({
    ...data,
    trend: []
  }, 0), null);
});

test("an empty visible window still draws the net entering from an earlier month, and nothing when every value is zero", () => {
  const data: CashFlow = {
    period: {
      kind: "all"
    } as CashFlow["period"],
    currency: "EUR",
    income: 0,
    expenses: 0,
    incomeBreakdown: [],
    expenseBreakdown: [],
    leadIn: month("2026-04", 0, 0),
    trend: [month("2026-05", 10000, 2000), month("2026-06", 0, 0), month("2026-07", 0, 0)]
  };
  const visible = data.trend.slice(-2);
  const edge = edgeNet(data, 2);

  // Halfway between May's net of 8000 and June's 0.
  assert.equal(edge, 4000);
  assert.equal(hasCashFlowToDraw(visible, edge), true);
  assert.equal(scaleOffset(edge!, cashFlowScale(visible, [edge!])), 0);
  assert.equal(hasCashFlowToDraw(visible, edgeNet({
    ...data,
    trend: [month("2026-05", 0, 0), month("2026-06", 0, 0), month("2026-07", 0, 0)]
  }, 2)), false);
});
