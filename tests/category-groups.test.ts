import assert from "node:assert/strict";
import { test } from "node:test";
import { groupByCategory, categoryRowLimit } from "../src/features/reports/category-groups";
import type { CategoryAmount } from "../src/features/reports/types";

function category(id: string, amount: number): CategoryAmount {
  return {
    categoryId: id,
    name: `Category ${id}`,
    color: "#488a75",
    icon: null,
    amount
  };
}

function uncategorized(amount: number): CategoryAmount {
  return {
    categoryId: null,
    name: "Uncategorized",
    color: "#a2aaa5",
    icon: null,
    amount
  };
}

function total(amounts: Pick<CategoryAmount, "amount">[]) {
  return amounts.reduce((sum, item) => sum + item.amount, 0);
}

test("up to five categories are shown as they are, largest first", () => {
  const items = [category("a", 100), category("b", 500), uncategorized(200), category("c", 300), category("d", 400)];
  const groups = groupByCategory(items);

  assert.equal(groups.length, categoryRowLimit);
  assert.deepEqual(groups.map(group => group.key), ["b", "d", "c", "uncategorized", "a"]);
  assert.deepEqual(groups.map(group => group.share), [500 / 1500, 400 / 1500, 300 / 1500, 200 / 1500, 100 / 1500]);
});

test("beyond five categories the four largest keep their rows and the rest are combined last", () => {
  const items = [10, 70, 20, 60, 30, 50, 40].map((amount, index) => category(String(index), amount));
  const groups = groupByCategory(items);
  const remainder = groups.at(-1);

  assert.equal(groups.length, categoryRowLimit);
  assert.deepEqual(groups.slice(0, -1).map(group => group.amount), [70, 60, 50, 40]);
  assert.equal(remainder?.key, "remainder");
  assert.equal(remainder?.name, "+3 more");
  assert.equal(remainder?.amount, 60);
  assert.equal(total(groups), total(items));
  assert.ok(Math.abs(groups.reduce((sum, group) => sum + group.share, 0) - 1) < 1e-9);
});

test("uncategorized spending keeps its own row even when it is the smallest", () => {
  const items = [uncategorized(5), ...[10, 70, 20, 60, 30, 50].map((amount, index) => category(String(index), amount))];
  const groups = groupByCategory(items);

  assert.equal(groups.length, categoryRowLimit);
  assert.deepEqual(groups.map(group => group.key), ["1", "3", "5", "uncategorized", "remainder"]);
  assert.equal(groups.at(-1)?.name, "+3 more");
  assert.equal(groups.at(-1)?.amount, 60);
  assert.equal(total(groups), total(items));
});

test("the remainder row is placed last even when it is larger than the shown categories", () => {
  const items = [category("big", 100), ...[30, 30, 30, 30, 30].map((amount, index) => category(`small-${index}`, amount))];
  const groups = groupByCategory(items);

  assert.deepEqual(groups.map(group => group.amount), [100, 30, 30, 30, 60]);
  assert.equal(groups.at(-1)?.key, "remainder");
});

test("equal amounts keep a stable order by name regardless of input order", () => {
  const first = groupByCategory([category("b", 50), category("a", 50)]);
  const second = groupByCategory([category("a", 50), category("b", 50)]);

  assert.deepEqual(first.map(group => group.key), ["a", "b"]);
  assert.deepEqual(second, first);
});

test("no spending has no rows", () => {
  assert.deepEqual(groupByCategory([]), []);
});

test("a negative category keeps its signed amount without a bar, and the rows still sum to the total", () => {
  const groups = groupByCategory([category("salary", 10000), category("correction", -2000)]);

  assert.deepEqual(groups.map(group => [group.key, group.amount, group.share]), [["salary", 10000, 1], ["correction", -2000, 0]]);
  assert.equal(groups.reduce((sum, group) => sum + group.amount, 0), 8000);
});

test("shares come from the rows shown, so a remainder netting a negative category still leaves the visible bars at 100%", () => {
  const groups = groupByCategory([category("a", 100), category("b", 90), category("c", 80), category("d", 70), category("e", 60), category("f", -100)]);

  assert.deepEqual(groups.map(group => [group.key, group.amount]), [["a", 100], ["b", 90], ["c", 80], ["d", 70], ["remainder", -40]]);
  assert.equal(groups.at(-1)?.share, 0);
  assert.ok(Math.abs(groups.reduce((sum, group) => sum + group.share, 0) - 1) < 1e-9);
  assert.equal(groups[0].share, 100 / 340);
});
