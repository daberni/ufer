import assert from "node:assert/strict";
import { test } from "node:test";
import { chartMonthCount, skeletonMonthBreakpoints } from "../src/features/reports/chart-months";
import { trendLength } from "../src/lib/period";

test("the cash-flow chart shows as many months as fit its width, from six on phones up to the whole twelve-month trend", () => {
  assert.equal(chartMonthCount(0), 6);
  assert.equal(chartMonthCount(311), 6);
  assert.equal(chartMonthCount(450), 8);
  assert.equal(chartMonthCount(600), 11);
  assert.equal(chartMonthCount(624), 12);
  assert.equal(chartMonthCount(1400), 12);
});

test("the loading skeleton's breakpoints show the same number of months as the loaded chart at every width", () => {
  const breakpoints = skeletonMonthBreakpoints();

  for (let width = 0; width <= 1000; width++) {
    const hidden = Math.max(0, ...breakpoints.filter(breakpoint => width < breakpoint.belowWidth).map(breakpoint => breakpoint.hiddenMonths));

    assert.equal(trendLength - hidden, chartMonthCount(width), `width ${width}`);
  }
});
