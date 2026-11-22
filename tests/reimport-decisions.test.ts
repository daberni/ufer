import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { importMappedRows } from "../src/features/imports/server/mapped-import-service";
import type { ImportRow } from "../src/features/imports/import-rows";
import { decisionTotals, type ExistingMatch, type RowMatch } from "../src/features/imports/reimport-decisions";

const now = Temporal.Instant.from("2026-06-30T12:00:00Z");

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
    id: "synthetic-account",
    name: "Synthetic account",
    kind: "checking"
  });

  return db;
}

function row(line: number, date: string, amount: string, payee: string, extra: Partial<ImportRow> = {}): ImportRow {
  return {
    line,
    date,
    amount,
    currency: "EUR",
    payee,
    description: "",
    category: null,
    source: "",
    occurrence: 0,
    id: null,
    type: null,
    hidden: false,
    parts: null,
    tags: null,
    ...extra
  };
}

function importRows(importId: string, rows: ImportRow[], confirm: boolean, decisions: {
  line: number;
  action: "update" | "skip" | "create";
  reference?: string;
}[] = []) {
  return importMappedRows({
    import_id: importId,
    rows,
    targets: [{
      source: "",
      account_id: "synthetic-account"
    }],
    decisions,
    confirm
  }, now);
}

const firstImport = "00000000-0000-4000-8000-000000000284";

const reimport = "00000000-0000-4000-8000-000000000285";

async function booking(db: Database, payee: string) {
  const found = await db.select().from(schema.transactions).where(eq(schema.transactions.counterparty, payee)).get();

  assert.ok(found, `booking ${payee}`);

  return found;
}

test("a reimport updates matched bookings' source fields and keeps overrides, manual corrections, splits and links", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.categories).values([{
    id: "synthetic-food",
    name: "Synthetic food",
    color: "#336699"
  }, {
    id: "synthetic-home",
    name: "Synthetic home",
    color: "#669933"
  }]);
  await importRows(firstImport, [
    row(2, "2024-05-02", "-20.00", "Corner Shop", {
      id: "export-1"
    }),
    row(3, "2024-05-03", "-35.00", "Hardware Store", {
      id: "export-2"
    }),
    row(4, "2024-05-04", "-12.00", "Pharmacy", {
      id: "export-3"
    }),
    row(5, "2024-05-05", "-50.00", "Savings", {
      id: "export-4"
    })
  ], true);

  const shop = await booking(db, "Corner Shop");
  const hardware = await booking(db, "Hardware Store");
  const pharmacy = await booking(db, "Pharmacy");
  const savings = await booking(db, "Savings");

  // A person's corrections, stored next to the source values.
  await db.update(schema.transactions).set({
    category_id: "synthetic-food",
    category_source: "manual",
    description_override: "Weekly groceries"
  }).where(eq(schema.transactions.id, shop.id));
  await db.update(schema.transactions).set({
    type: "income",
    type_source: "manual"
  }).where(eq(schema.transactions.id, hardware.id));
  await db.insert(schema.transactionSplits).values([{
    id: "split-1",
    transaction_id: pharmacy.id,
    position: 0,
    amount_minor: -700,
    category_id: "synthetic-food",
    note: ""
  }, {
    id: "split-2",
    transaction_id: pharmacy.id,
    position: 1,
    amount_minor: -500,
    category_id: "synthetic-home",
    note: ""
  }]);
  await db.update(schema.transactions).set({
    type: "transfer",
    transfer_id: "synthetic-link",
    transfer_source: "manual"
  }).where(eq(schema.transactions.id, savings.id));

  const corrected = [
    row(2, "2024-05-02", "-20.00", "Corner Shop Ltd", {
      id: "export-1",
      description: "Card payment"
    }),
    row(3, "2024-05-03", "-35.00", "Hardware Store", {
      id: "export-2",
      type: "transfer"
    }),
    row(4, "2024-05-04", "-12.00", "City Pharmacy", {
      id: "export-3",
      type: "transfer"
    }),
    row(5, "2024-05-05", "-50.00", "Savings plan", {
      id: "export-4",
      type: "expense"
    })
  ];
  const check = await importRows(reimport, corrected, false);

  assert.equal(check.updatedRows, 3);
  assert.equal(check.newRows, 0);
  assert.deepEqual(check.matches.map(match => [match.line, match.kind, match.candidates[0].changes]), [
    [2, "match", ["payee", "description"]],
    // A manual type and a linked transfer keep their type, so nothing else changes on line 3.
    [3, "match", []],
    [4, "match", ["payee"]],
    [5, "match", ["payee"]]
  ]);
  assert.equal(check.matches[0].candidates[0].descriptionOverridden, true);
  assert.equal((await booking(db, "Corner Shop")).description, "", "checking writes nothing");

  const confirmed = await importRows(reimport, corrected, true);

  assert.equal(confirmed.updatedRows, 3);
  assert.equal(confirmed.newRows, 0);
  assert.equal((await db.select().from(schema.transactions)).length, 4);

  const updatedShop = await db.select().from(schema.transactions).where(eq(schema.transactions.id, shop.id)).get();
  const updatedHardware = await db.select().from(schema.transactions).where(eq(schema.transactions.id, hardware.id)).get();
  const updatedPharmacy = await db.select().from(schema.transactions).where(eq(schema.transactions.id, pharmacy.id)).get();
  const updatedSavings = await db.select().from(schema.transactions).where(eq(schema.transactions.id, savings.id)).get();

  assert.deepEqual([updatedShop?.counterparty, updatedShop?.description, updatedShop?.description_override, updatedShop?.category_id, updatedShop?.category_source], ["Corner Shop Ltd", "Card payment", "Weekly groceries", "synthetic-food", "manual"]);
  assert.deepEqual([updatedHardware?.type, updatedHardware?.type_source], ["income", "manual"]);
  assert.deepEqual([updatedPharmacy?.counterparty, updatedPharmacy?.type], ["City Pharmacy", "expense"], "a split booking stays an expense");
  assert.equal((await db.select().from(schema.transactionSplits).where(eq(schema.transactionSplits.transaction_id, pharmacy.id))).length, 2);
  assert.deepEqual([updatedSavings?.counterparty, updatedSavings?.type, updatedSavings?.transfer_id], ["Savings plan", "transfer", "synthetic-link"]);
});

test("the file's type updates an automatic type of a content match, and skipping a match leaves it unchanged", async context => {
  const db = await isolatedDatabase(context);

  await importRows(firstImport, [row(2, "2024-06-01", "-80.00", "Example Utility"), row(3, "2024-06-02", "-15.00", "Example Kiosk")], true);

  const rows = [
    row(2, "2024-06-02", "-80.00", "EXAMPLE UTILITY 0042", {
      type: "transfer"
    }),
    row(3, "2024-06-02", "-15.00", "Example Kiosk", {
      description: "Newspaper"
    })
  ];
  const result = await importRows(reimport, rows, true, [{
    line: 3,
    action: "skip"
  }]);

  assert.deepEqual(result.duplicates.map(duplicate => duplicate.reason), ["existing_booking", "existing_booking"]);
  assert.equal(result.updatedRows, 1);

  const utility = await booking(db, "EXAMPLE UTILITY 0042");

  assert.deepEqual([utility.type, utility.transfer_detected, utility.date], ["transfer", 1, "2024-06-01"]);
  assert.equal((await booking(db, "Example Kiosk")).description, "");
});

test("creating a content match anyway adds a new booking next to it", async context => {
  const db = await isolatedDatabase(context);

  await importRows(firstImport, [row(2, "2024-06-01", "-9.00", "Example Bakery")], true);

  const result = await importRows(reimport, [row(2, "2024-06-02", "-9.00", "Example Bakery", {
    description: "Second visit"
  })], true, [{
    line: 2,
    action: "create"
  }]);

  assert.equal(result.newRows, 1);
  assert.equal(result.updatedRows, 0);
  assert.equal((await db.select().from(schema.transactions)).length, 2);
});

test("a row imported before under the same reference is never created twice", async context => {
  const db = await isolatedDatabase(context);
  const rows = [row(2, "2024-06-01", "-9.00", "Example Bakery")];

  await importRows(firstImport, rows, true);
  const result = await importRows(reimport, rows, true, [{
    line: 2,
    action: "create"
  }]);

  assert.equal(result.newRows, 0);
  assert.equal((await db.select().from(schema.transactions)).length, 1);
});

for (const [decision, expected] of [
  ["none", {
    count: 2,
    payees: ["Example Cinema", "Example Cinema"],
    newRows: 0,
    updatedRows: 0,
    undecided: [2]
  }],
  ["skip", {
    count: 2,
    payees: ["Example Cinema", "Example Cinema"],
    newRows: 0,
    updatedRows: 0,
    undecided: []
  }],
  ["create", {
    count: 3,
    payees: ["Example Cinema", "Example Cinema", "Example Cinema"],
    newRows: 1,
    updatedRows: 0,
    undecided: []
  }],
  ["update", {
    count: 2,
    payees: ["Cinema Ticket Office", "Example Cinema"],
    newRows: 0,
    updatedRows: 1,
    undecided: []
  }]
] as const) {
  test(`a possible duplicate with decision "${decision}" is created or updated only as decided`, async context => {
    const db = await isolatedDatabase(context);

    await importRows(firstImport, [row(2, "2024-04-20", "-15.00", "Example Cinema"), row(3, "2024-04-24", "-15.00", "Example Cinema")], true);

    const rows = [row(2, "2024-04-22", "-15.00", "Example Cinema", {
      description: "Cinema Ticket Office"
    })];
    const check = await importRows(reimport, rows, false);
    const candidates = check.matches[0].candidates;

    // Two equally distant bookings are candidates; the review lets the person choose the later one.
    assert.equal(check.matches[0].kind, "possible");
    assert.deepEqual(candidates.map(candidate => candidate.date).toSorted(), ["2024-04-20", "2024-04-24"]);

    const later = candidates.find(candidate => candidate.date === "2024-04-24");
    const decisions = decision === "none" ? [] : [{
      line: 2,
      action: decision,
      reference: later?.reference
    }];
    const updated = decision === "update" ? [row(2, "2024-04-22", "-15.00", "Cinema Ticket Office")] : rows;
    const result = await importRows(reimport, updated, true, decisions);
    const stored = await db.select().from(schema.transactions).orderBy(schema.transactions.date);

    assert.deepEqual([result.newRows, result.updatedRows, result.undecided], [expected.newRows, expected.updatedRows, expected.undecided]);
    assert.equal(stored.length, expected.count);

    if (decision === "update") {
      assert.deepEqual(stored.map(item => [item.date, item.counterparty]), [["2024-04-20", "Example Cinema"], ["2024-04-24", "Cinema Ticket Office"]]);
    } else {
      assert.deepEqual(stored.map(item => item.counterparty).toSorted(), [...expected.payees].toSorted());
    }
  });
}

test("an update naming a booking that is no longer a candidate waits for a new decision", async context => {
  const db = await isolatedDatabase(context);

  await importRows(firstImport, [row(2, "2024-04-20", "-15.00", "Example Cinema"), row(3, "2024-04-24", "-15.00", "Example Cinema")], true);

  const result = await importRows(reimport, [row(2, "2024-04-22", "-15.00", "Cinema Ticket Office")], true, [{
    line: 2,
    action: "update",
    reference: "csv:m:not-a-candidate"
  }]);

  assert.deepEqual(result.undecided, [2]);
  assert.deepEqual((await db.select().from(schema.transactions)).map(item => item.counterparty), ["Example Cinema", "Example Cinema"]);
});

function counts(totals: ReturnType<typeof decisionTotals>) {
  return {
    created: totals.created,
    updated: totals.updated,
    unchanged: totals.unchanged,
    undecided: totals.undecided
  };
}

test("the review's totals follow the decisions and leave a possible duplicate undecided when its booking is already updated", () => {
  const existing = (reference: string, changes: ExistingMatch["changes"]): ExistingMatch => ({
    reference,
    date: "2024-04-20",
    amount: -1500,
    payee: "Example Cinema",
    description: "",
    type: "expense",
    payeeOverridden: false,
    descriptionOverridden: false,
    changes
  });
  const matches: RowMatch[] = [{
    line: 2,
    accountId: "x",
    description: "",
    kind: "match",
    reason: "already_imported",
    candidates: [existing("a", ["payee"])]
  }, {
    line: 3,
    accountId: "x",
    description: "",
    kind: "match",
    reason: "existing_booking",
    candidates: [existing("b", [])]
  }, {
    line: 4,
    accountId: "x",
    description: "",
    kind: "possible",
    reason: null,
    candidates: [existing("a", ["description"]), existing("c", ["description"])]
  }];

  assert.deepEqual(counts(decisionTotals(matches, new Map())), {
    created: 0,
    updated: 1,
    unchanged: 1,
    undecided: 1
  });
  // A row imported before cannot be created again, so its choice falls back to the update; line 4's first candidate is already taken by line 2.
  assert.deepEqual(counts(decisionTotals(matches, new Map([[2, {
    line: 2,
    action: "create" as const
  }], [4, {
    line: 4,
    action: "update" as const
  }]]))), {
    created: 0,
    updated: 1,
    unchanged: 1,
    undecided: 1
  });
  assert.deepEqual(counts(decisionTotals(matches, new Map([[3, {
    line: 3,
    action: "create" as const
  }], [4, {
    line: 4,
    action: "update" as const,
    reference: "c"
  }]]))), {
    created: 1,
    updated: 2,
    unchanged: 0,
    undecided: 0
  });
  // The same reference on another account is a different booking.
  assert.equal(decisionTotals([matches[0], {
    ...matches[2],
    accountId: "y"
  }], new Map([[4, {
    line: 4,
    action: "update" as const
  }]])).undecided, 0);
  // A second row choosing an already updated booking is a conflict the review marks.
  assert.deepEqual([...decisionTotals(matches, new Map([[4, {
    line: 4,
    action: "update" as const
  }]])).conflicts], [4]);
});

test("an update of a chosen booking is not redirected to another booking that now matches", async context => {
  const db = await isolatedDatabase(context);

  await importRows(firstImport, [row(2, "2024-04-20", "-15.00", "Example Cinema")], true);

  const result = await importRows(reimport, [row(2, "2024-04-21", "-15.00", "Example Cinema", {
    description: "Changed"
  })], true, [{
    line: 2,
    action: "update",
    reference: "csv:m:deleted-meanwhile"
  }]);

  assert.deepEqual([result.updatedRows, result.undecided], [0, [2]]);
  assert.equal((await db.select().from(schema.transactions)).at(0)?.description, "");
  // The booking stays free for later batches, which receive only what this batch really took.
  assert.deepEqual(result.matched, []);
});

test("an update decided for a row that no longer matches anything is not inserted", async context => {
  const db = await isolatedDatabase(context);
  const result = await importRows(reimport, [row(2, "2024-04-22", "-15.00", "Example Cinema")], true, [{
    line: 2,
    action: "update",
    reference: "csv:m:removed-meanwhile"
  }]);

  assert.deepEqual([result.newRows, result.undecided], [0, [2]]);
  assert.equal((await db.select().from(schema.transactions)).length, 0);
});

test("a possible duplicate offers at most five candidates, the closest first", async context => {
  await isolatedDatabase(context);
  await importRows(firstImport, ["2024-04-17", "2024-04-18", "2024-04-19", "2024-04-21", "2024-04-22", "2024-04-23"].map((date, index) => row(index + 2, date, "-15.00", "Example Cinema")), true);

  const check = await importRows(reimport, [row(2, "2024-04-20", "-15.00", "Example Cinema", {
    description: "Evening"
  })], false);

  assert.equal(check.matches[0].kind, "possible");
  assert.equal(check.matches[0].candidates.length, 5);
  assert.ok(["2024-04-19", "2024-04-21"].includes(check.matches[0].candidates[0].date));
});

test("a confident match keeps its booking when an earlier possible duplicate chose the same one", async context => {
  const db = await isolatedDatabase(context);

  await importRows(firstImport, [row(2, "2024-04-20", "-15.00", "Example Cinema"), row(3, "2024-04-24", "-15.00", "Example Cinema")], true);

  const rows = [row(2, "2024-04-22", "-15.00", "Example Cinema", {
    description: "Possible"
  }), row(3, "2024-04-24", "-15.00", "Example Cinema", {
    description: "Confident"
  })];
  const check = await importRows(reimport, rows, false);
  const later = check.matches.find(match => match.line === 2)?.candidates.find(candidate => candidate.date === "2024-04-24");
  const result = await importRows(reimport, rows, true, [{
    line: 2,
    action: "update",
    reference: later?.reference
  }]);
  const stored = await db.select().from(schema.transactions).orderBy(schema.transactions.date);

  assert.deepEqual([result.updatedRows, result.undecided], [1, [2]]);
  assert.deepEqual(stored.map(item => item.description), ["", "Confident"]);
});

test("the review shortens long candidate texts but compares the full text", async context => {
  await isolatedDatabase(context);
  const long = "Example Cinema ".repeat(20).trim();

  await importRows(firstImport, [row(2, "2024-04-20", "-15.00", long)], true);
  const check = await importRows(reimport, [row(2, "2024-04-20", "-15.00", long, {
    description: "Evening"
  })], false);
  const candidate = check.matches[0].candidates[0];

  assert.equal(candidate.payee.length, 120);
  assert.deepEqual(candidate.changes, ["description"]);
  assert.equal(check.matches[0].description, "Evening");
});
