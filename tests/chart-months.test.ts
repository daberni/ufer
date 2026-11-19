import assert from "node:assert/strict";
import { test } from "node:test";
import { chartMonthCount } from "../src/features/reports/chart-months";

test("the cash-flow chart shows as many months as fit its width, from six on phones up to the whole twelve-month trend", () => {
  assert.equal(chartMonthCount(0), 6);
  assert.equal(chartMonthCount(311), 6);
  assert.equal(chartMonthCount(450), 8);
  assert.equal(chartMonthCount(600), 11);
  assert.equal(chartMonthCount(624), 12);
  assert.equal(chartMonthCount(1400), 12);
});
