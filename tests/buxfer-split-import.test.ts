import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { insertRule } from "../src/features/categorization/server/rule-repository";
import { importMappedRows } from "../src/features/imports/server/mapped-import-service";
import { categoryValues } from "../src/features/imports/import-plan";
import { assignOccurrences, buxferTemplate, mapRows, parseCsv, tagSplit, templateMapping, withSplitTags, type CsvSettings, type MappedRow } from "../src/features/imports/csv-mapping";

const now = Temporal.Instant.from("2026-06-30T12:00:00Z");
const importId = "00000000-0000-4000-8000-000000000247";
const settings: CsvSettings = {
  encoding: "utf-8",
  delimiter: ",",
  decimal: ".",
  dateFormat: "YYYY-MM-DD"
};

// Synthetic rows in Buxfer's export layout.
const buxferCsv = [
  "ID,Date,Description,Currency,Amount,Type,Tags,Account,Status,Memo,IOU",
  "1,2026-01-10,\"Fuel station\",EUR,-51.4,Expense,\"Car / Fuel:45.52,Groceries:5.88\",\"Checking\",Cleared,\" \"",
  "2,2026-01-12,\"Cash withdrawal\",EUR,-170,Expense,\"Car:70, Cash : 100\",\"Checking\",Cleared,\" \"",
  "3,2026-01-14,\"Market\",EUR,-20,Expense,\"Groceries:15,Car:6\",\"Checking\",Cleared,\" \"",
  "4,2026-01-15,\"Bakery\",EUR,-4.2,Expense,\"Groceries\",\"Checking\",Cleared,\" \""
].join("\n");

async function isolatedDatabase(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousEnvironment = process.env.ENABLE_BANKING_ENVIRONMENT;

  context.after(() => {
    globals.budgetDb = previousDatabase;

    if (previousEnvironment === undefined) {
      delete process.env.ENABLE_BANKING_ENVIRONMENT;
    } else {
      process.env.ENABLE_BANKING_ENVIRONMENT = previousEnvironment;
    }

    client.close();
  });

  await initializeDatabase(client);
  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";

  await db.insert(schema.accounts).values({
    id: "synthetic-checking",
    environment: "SANDBOX",
    name: "Checking",
    institution: "Example institution",
    kind: "checking"
  });

  return db;
}

function mappedBuxferRows(csv = buxferCsv) {
  const [header, ...rows] = parseCsv(csv, ",");

  return mapRows(rows, templateMapping(buxferTemplate, header), settings, "en");
}

function payload(rows: MappedRow[], confirm: boolean, categories: object[] = []) {
  return {
    import_id: importId,
    rows: assignOccurrences(rows, () => "synthetic-checking"),
    targets: [{
      source: "Checking",
      account_id: "synthetic-checking"
    }],
    categories,
    confirm
  };
}

test("amount-bearing tags become parts signed like the row, with decimals and whitespace", () => {
  assert.deepEqual(tagSplit("Car / Fuel:45.52,Groceries:5.88", "-51.4"), {
    parts: [{
      category: "Car / Fuel",
      amount: "-45.52"
    }, {
      category: "Groceries",
      amount: "-5.88"
    }]
  });
  assert.deepEqual(tagSplit(" Salary : 1000.5 , Bonus:-0.50 ", "1000"), {
    parts: [{
      category: "Salary",
      amount: "1000.5"
    }, {
      category: "Bonus",
      amount: "-0.50"
    }]
  });
  assert.equal(tagSplit("Car / Fuel, Groceries", "-10"), null);
  assert.equal(tagSplit("", "-10"), null);
});

test("tags that cannot split the row are recognized", () => {
  assert.match(problemOf(tagSplit("Car:45.52,Groceries", "-45.52")), /A tag has no amount/);
  assert.match(problemOf(tagSplit("Car:10", "-10")), /at least two tags/);
  assert.match(problemOf(tagSplit("Groceries:15,Car:6", "-20")), /add up to -21 instead of -20/);
  assert.match(problemOf(tagSplit("Groceries:20,Car:0", "-20")), /amount of 0/);
});

function problemOf(split: ReturnType<typeof tagSplit>) {
  assert.ok(split && "problem" in split);

  return split.problem;
}

test("the category review lists each part's name instead of the tag list", () => {
  const {
    rows,
    errors
  } = mappedBuxferRows();

  // Tags that do not add up import the row unsplit and keep the original tags in its description.
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map(row => row.category), [null, null, null, "Groceries"]);
  assert.deepEqual([rows[2].parts, rows[2].description], [null, "Market · Split: Groceries 15, Car 6"]);
  assert.equal(withSplitTags("", "Health:10, Groceries"), "Split: Health 10, Groceries");
  // Rules never categorize parts, so values used only by parts are not offered to the rules.
  assert.deepEqual(categoryValues(rows, []).map(value => [value.value, value.rows, value.multiTag, value.splitOnly]), [
    ["Groceries", 2, false, false],
    ["Car", 1, false, true],
    ["Car / Fuel", 1, false, true],
    ["Cash", 1, false, true]
  ]);
});

test("valid splits import as split bookings, invalid ones as rule-categorized bookings, and re-importing changes nothing", async context => {
  const db = await isolatedDatabase(context);
  const {
    rows
  } = mappedBuxferRows();
  const choices = ["Car / Fuel", "Groceries", "Car", "Cash"].map(value => ({
    value,
    action: "create"
  }));

  // A rule that categorizes and retypes every row must leave split bookings alone and decide the invalid split like any booking.
  await db.insert(schema.categories).values({
    id: "synthetic-misc",
    name: "Miscellaneous",
    color: "#888888"
  });
  await insertRule({
    id: "synthetic-rule-all",
    name: "Everything",
    pattern: "e",
    mode: "keyword",
    category_id: "synthetic-misc",
    priority: 100,
    enabled: true,
    transaction_type: "transfer",
    transfer_account_id: null
  });

  const checked = await importMappedRows(payload(rows, false, choices), now);

  assert.deepEqual(checked.errors, []);
  assert.equal(checked.newRows, 4);

  const confirmed = await importMappedRows(payload(rows, true, choices), now);
  const again = await importMappedRows(payload(rows, true, choices), now);

  assert.equal(confirmed.newRows, 4);
  assert.equal(again.newRows, 0);

  const bookings = await db.select().from(schema.transactions).orderBy(asc(schema.transactions.booking_date));
  const parts = await db.select().from(schema.transactionSplits).orderBy(asc(schema.transactionSplits.transaction_id), asc(schema.transactionSplits.position));
  const categories = new Map((await db.select().from(schema.categories)).map(category => [category.id, category.name]));
  const partsOf = (id: string) => parts.filter(part => part.transaction_id === id).map(part => [categories.get(part.category_id ?? ""), part.amount_minor]);

  assert.equal(bookings.length, 4);
  assert.equal(parts.length, 4);
  assert.deepEqual(partsOf(bookings[0].id), [["Car / Fuel", -4552], ["Groceries", -588]]);
  assert.deepEqual(partsOf(bookings[1].id), [["Car", -7000], ["Cash", -10000]]);
  assert.deepEqual([bookings[0].category_id, bookings[0].category_source, bookings[0].type], [null, "manual", "expense"]);
  assert.deepEqual([bookings[2].description, bookings[2].category_id, bookings[2].category_source, bookings[2].category_rule_id, bookings[2].type], ["Market · Split: Groceries 15, Car 6", "synthetic-misc", "rule", "synthetic-rule-all", "transfer"]);
  assert.deepEqual(partsOf(bookings[2].id), []);
  assert.equal(categories.get(bookings[3].category_id ?? ""), "Groceries");
});

test("tags the server cannot take as a split import an unsplit booking that keeps them in its description", async context => {
  const db = await isolatedDatabase(context);
  const header = "ID,Date,Description,Currency,Amount,Type,Tags,Account,Status,Memo,IOU";
  const {
    rows
  } = mappedBuxferRows([
    header,
    "9,2026-01-10,\"Shop\",EUR,-10,Expense,\"Car:9.995,Cash:0.005\",\"Checking\",Cleared,\" \"",
    "10,2026-01-11,\"To savings\",EUR,-10,Expense,\"Car:5,Cash:5\",\"Checking\",Cleared,\" \""
  ].join("\n"));

  assert.deepEqual(rows.map(row => row.parts?.length), [2, 2]);

  // The second row reaches the server as a transfer, which is never split.
  const sent = rows.map(row => row.line === 3 ? {
    ...row,
    transfer: true
  } : row);
  const result = await importMappedRows(payload(sent, true), now);
  const bookings = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "synthetic-checking")).orderBy(asc(schema.transactions.booking_date));

  assert.deepEqual(result.errors, []);
  assert.equal(result.newRows, 2);
  assert.equal((await db.select().from(schema.transactionSplits)).length, 0);
  assert.deepEqual(bookings.map(booking => [booking.description, booking.category_source, booking.type]), [
    ["Shop · Split: Car 9.995, Cash 0.005", "rule", "expense"],
    ["To savings · Split: Car 5, Cash 5", "rule", "transfer"]
  ]);
});

test("a transfer row with amount-bearing tags is not split and keeps its tags in the description", () => {
  const {
    rows,
    errors
  } = mappedBuxferRows([
    "ID,Date,Description,Currency,Amount,Type,Tags,Account,Status,Memo,IOU",
    "9,2026-01-10,\"To savings\",EUR,-10,Transfer,\"Car:5,Cash:5\",\"Checking\",Cleared,\" \""
  ].join("\n"));

  assert.deepEqual(errors, []);
  assert.deepEqual([rows[0].parts, rows[0].category, rows[0].description, rows[0].transfer], [null, null, "To savings · Split: Car 5, Cash 5", true]);
});
