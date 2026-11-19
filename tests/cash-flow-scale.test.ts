import assert from "node:assert/strict";
import { test } from "node:test";
import { barSpan, cashFlowScale, scaleOffset, type CashFlowScale } from "../src/features/reports/cash-flow-scale";

// Fractions of the plot height; the tolerance absorbs floating-point rounding at the edges.
function inside(fraction: number) {
  return fraction >= -1e-9 && fraction <= 1 + 1e-9;
}

function assertDrawable(scale: CashFlowScale, income: number, expenses: number) {
  const net = income - expenses;
  const incomeBar = barSpan(income, scale);
  const expenseBar = barSpan(-expenses, scale);

  assert.ok(inside(scaleOffset(net, scale)), `net ${net}`);
  assert.ok(inside(incomeBar.top) && inside(incomeBar.top + incomeBar.height), `income ${income}`);
  assert.ok(inside(expenseBar.top) && inside(expenseBar.top + expenseBar.height), `expenses ${expenses}`);
}

test("income rises and expenses fall from a zero line placed by the largest of each", () => {
  const scale = cashFlowScale([{
    income: 300000,
    expenses: 100000
  }, {
    income: 100000,
    expenses: 200000
  }]);

  assert.deepEqual(scale, {
    zero: 0.6,
    extent: 500000
  });
  assert.deepEqual(barSpan(300000, scale), {
    top: 0,
    height: 0.6
  });
  assert.deepEqual(barSpan(-200000, scale), {
    top: 0.6,
    height: 0.4
  });
});

test("refunds exceeding spending keep the net point and the reversed expense bar inside the plot", () => {
  const months = [{
    income: 400000,
    expenses: -100000
  }, {
    income: 0,
    expenses: -5000
  }, {
    income: 50000,
    expenses: 80000
  }];
  const scale = cashFlowScale(months);

  for (const month of months) {
    assertDrawable(scale, month.income, month.expenses);
  }

  assert.equal(scaleOffset(500000, scale), 0);
  assert.ok(barSpan(100000, scale).top < scale.zero);
});

test("negative income without expenses stays inside, and an empty trend centres the zero line", () => {
  const scale = cashFlowScale([{
    income: -20000,
    expenses: 0
  }]);

  assertDrawable(scale, -20000, 0);
  assert.equal(scale.zero, 0);
  assert.deepEqual(cashFlowScale([{
    income: 0,
    expenses: 0
  }]), {
    zero: 0.5,
    extent: 1
  });
});
