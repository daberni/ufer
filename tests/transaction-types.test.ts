import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { pairTransfersInEnvironment } from "../src/features/transactions/server/transfer-repository";
import { unambiguousPairs } from "../src/features/transactions/server/transfer-pairing";
import { transferOptions, updateTransactionDetails } from "../src/features/transactions/server/transaction-service";
import { importMappedRows } from "../src/features/imports/server/mapped-import-service";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { monthPeriod } from "../src/lib/period";
import { HttpError, ValidationError } from "../src/lib/errors";
import type { Entry } from "../src/features/transactions/server/transaction-entry";

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
  await db.insert(schema.accounts).values([{
    id: "checking",
    environment: "SANDBOX",
    name: "Synthetic checking",
    institution: "Example bank",
    kind: "checking",
    provider: "enable_banking"
  }, {
    id: "savings",
    environment: "SANDBOX",
    name: "Synthetic savings",
    institution: "Example bank",
    kind: "savings",
    provider: "enable_banking"
  }, {
    id: "dollars",
    environment: "SANDBOX",
    name: "Synthetic dollars",
    institution: "Example bank",
    kind: "checking",
    currency: "USD",
    provider: "enable_banking"
  }, {
    id: "property",
    environment: "SANDBOX",
    name: "Synthetic flat",
    institution: "Land register",
    kind: "property"
  }]);

  return db;
}

/** Saves a transfer with the given target, as the edit dialog does. */
function saveTransfer(id: string, transfer: {
  counterpart_id: string
} | {
  account_id: string
} | null) {
  return updateTransactionDetails(id, {
    type: "transfer",
    transfer
  });
}

let runCounter = 0;

/** Stores one account's bank delivery and then pairs transfers, as a sync does once every account is stored. */
async function sync(db: Database, accountId: string, entries: Entry[], currency = "EUR") {
  runCounter += 1;
  const run = {
    environment: "SANDBOX",
    startedAt: `2026-09-30T08:00:${String(runCounter % 60).padStart(2, "0")}.000Z`
  };
  const balances = [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "0.00",
      currency
    },
    reference_date: "2026-09-30"
  }];

  await saveAccountSync(db, run, accountId, currency, balances, entries, []);
  await pairTransfersInEnvironment("SANDBOX");
}

function entry(reference: string, date: string, amount: number, transfer = false, currency = "EUR"): Entry {
  return {
    reference: `bank:${reference}`,
    date,
    amount,
    currency,
    counterparty: "Example counterparty",
    description: `Synthetic ${reference}`,
    transfer
  };
}

async function stored(db: Database, reference: string) {
  const row = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, `bank:${reference}`)).get();

  assert.ok(row, reference);

  return row;
}

async function linked(db: Database, first: string, second: string) {
  const [one, two] = [await stored(db, first), await stored(db, second)];

  return one.transfer_id !== null && one.transfer_id === two.transfer_id;
}


/** Imports one synthetic cash withdrawal row into the manual account "cash" through the mapped CSV import. */
async function importCashRow(date: string, amount: string) {
  await importMappedRows({
    import_id: randomUUID(),
    rows: [{
      line: 2,
      date,
      amount,
      currency: "EUR",
      payee: "ATM",
      description: "Cash withdrawal",
      category: null,
      source: "",
      occurrence: 0,
      id: null
    }],
    targets: [{
      source: "",
      account_id: "cash"
    }],
    confirm: true
  });
}

test("only bookings whose two sides each have exactly one candidate are paired", () => {
  assert.deepEqual(unambiguousPairs([]), []);
  assert.deepEqual(unambiguousPairs([{
    outgoingId: "out",
    incomingId: "in"
  }]), [{
    outgoingId: "out",
    incomingId: "in"
  }]);
  // One outgoing booking with two possible incoming ones, and one incoming booking matching two outgoing ones.
  assert.deepEqual(unambiguousPairs([{
    outgoingId: "out",
    incomingId: "in-1"
  }, {
    outgoingId: "out",
    incomingId: "in-2"
  }, {
    outgoingId: "out-2",
    incomingId: "in-3"
  }, {
    outgoingId: "out-3",
    incomingId: "in-3"
  }, {
    outgoingId: "out-4",
    incomingId: "in-4"
  }]), [{
    outgoingId: "out-4",
    incomingId: "in-4"
  }]);
});

test("synced bookings get a type by direction and detected transfers, and cash flow counts only income and expenses", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("salary", "2026-09-01", 300000), entry("market", "2026-09-02", -4500), entry("to-savings", "2026-09-03", -50000, true)]);
  await sync(db, "savings", [entry("from-checking", "2026-09-03", 50000, true)]);

  assert.equal((await stored(db, "salary")).type, "income");
  assert.equal((await stored(db, "market")).type, "expense");
  assert.equal((await stored(db, "to-savings")).type, "transfer");
  assert.ok(await linked(db, "to-savings", "from-checking"));

  const refund = await db.insert(schema.transactions).values({
    id: "refund",
    account_id: "checking",
    provider_reference: "csv:refund",
    booking_date: "2026-09-05",
    amount_minor: 1500,
    currency: "EUR",
    category_id: "groceries",
    type: "income"
  }).returning();

  // A refund corrected to an expense reduces spending in its category instead of counting as income.
  await updateTransactionDetails(refund[0].id, {
    type: "expense"
  });
  const cashFlow = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-09")), "EUR");

  assert.equal(cashFlow.income, 300000);
  assert.equal(cashFlow.expenses, 3000);
});

test("automatic pairing needs opposite amounts in one currency on two accounts within three days and exactly one candidate", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [
    entry("single", "2026-09-01", -10000, true),
    entry("ambiguous", "2026-09-10", -20000, true),
    entry("late", "2026-09-20", -30000, true),
    entry("currency", "2026-09-25", -40000, true),
    entry("same-account-out", "2026-09-26", -5000, true),
    entry("same-account-in", "2026-09-26", 5000)
  ]);
  await sync(db, "savings", [
    entry("single-in", "2026-09-04", 10000),
    entry("ambiguous-in-1", "2026-09-10", 20000, true),
    entry("ambiguous-in-2", "2026-09-11", 20000),
    entry("late-in", "2026-09-24", 30000, true)
  ]);
  await sync(db, "dollars", [entry("currency-in", "2026-09-25", 40000, true, "USD")], "USD");

  // An income nobody corrected becomes the transfer's incoming side when it is the only match.
  assert.ok(await linked(db, "single", "single-in"));
  assert.equal((await stored(db, "single-in")).type, "transfer");
  assert.equal((await stored(db, "ambiguous")).transfer_id, null);
  assert.equal((await stored(db, "ambiguous-in-1")).transfer_id, null);
  assert.equal((await stored(db, "ambiguous-in-2")).type, "income");
  assert.equal((await stored(db, "late")).transfer_id, null);
  assert.equal((await stored(db, "currency")).transfer_id, null);
  assert.equal((await stored(db, "same-account-out")).transfer_id, null);
  assert.equal((await stored(db, "same-account-in")).type, "income");
});

test("manual types, links and unlinks survive resync and later pairing", async context => {
  const db = await isolatedDatabase(context);
  const checking = [entry("paired-out", "2026-09-01", -10000, true), entry("refund", "2026-09-02", 2500), entry("relinked-out", "2026-09-10", -7000, true)];
  const savings = [entry("paired-in", "2026-09-01", 10000, true), entry("relinked-in-1", "2026-09-10", 7000), entry("relinked-in-2", "2026-09-11", 7000)];

  await sync(db, "checking", checking);
  await sync(db, "savings", savings);
  assert.ok(await linked(db, "paired-out", "paired-in"));
  assert.equal((await stored(db, "relinked-out")).transfer_id, null);

  await saveTransfer((await stored(db, "paired-out")).id, null);
  await updateTransactionDetails((await stored(db, "refund")).id, {
    type: "expense"
  });
  await saveTransfer((await stored(db, "relinked-out")).id, {
    counterpart_id: (await stored(db, "relinked-in-2")).id
  });

  await sync(db, "checking", checking);
  await sync(db, "savings", savings);

  assert.equal((await stored(db, "paired-out")).transfer_id, null);
  assert.equal((await stored(db, "paired-out")).type, "transfer");
  assert.equal((await stored(db, "paired-in")).transfer_id, null);
  assert.equal((await stored(db, "refund")).type, "expense");
  assert.ok(await linked(db, "relinked-out", "relinked-in-2"));
  assert.equal((await stored(db, "relinked-in-1")).type, "income");
});

test("leaving the transfer type corrects both linked bookings together", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("out", "2026-09-01", -10000, true)]);
  await sync(db, "savings", [entry("in", "2026-09-01", 10000, true)]);
  await updateTransactionDetails((await stored(db, "out")).id, {
    type: "expense"
  });

  const [out, incoming] = [await stored(db, "out"), await stored(db, "in")];

  assert.deepEqual([out.type, out.transfer_id, out.type_source], ["expense", null, "manual"]);
  assert.deepEqual([incoming.type, incoming.transfer_id, incoming.type_source], ["income", null, "manual"]);
});

test("a transfer to a manual account creates its counterpart there, and unlinking removes it again", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("deposit", "2026-09-15", -2500000)]);
  const deposit = await stored(db, "deposit");
  const options = await transferOptions(deposit.id);

  assert.deepEqual(options.accounts, [{
    id: "property",
    name: "Synthetic flat"
  }]);
  await assert.rejects(saveTransfer(deposit.id, {
    account_id: "dollars"
  }), ValidationError);
  await saveTransfer(deposit.id, {
    account_id: "property"
  });

  const created = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "property")).get();

  assert.ok(created);
  assert.equal(created.amount_minor, 2500000);
  assert.equal(created.booking_date, "2026-09-15");
  assert.equal(created.transfer_id, (await stored(db, "deposit")).transfer_id);

  const page = await readTransactionPage(dashboardFilters(new URLSearchParams("period=2026-09&currency=EUR")));
  const shown = page.transactions.find(transaction => transaction.id === deposit.id);

  assert.equal(shown?.counterpart?.account_name, "Synthetic flat");
  assert.equal((await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-09")), "EUR")).expenses, 0);
  // Saving the same target again keeps the one counterpart.
  await saveTransfer(deposit.id, {
    account_id: "property"
  });
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "property"))).length, 1);

  await saveTransfer(deposit.id, null);

  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "property"))).length, 0);
  assert.deepEqual([(await stored(db, "deposit")).type, (await stored(db, "deposit")).transfer_id], ["transfer", null]);
});

test("opening balances and adjustments are refused for bank-synced bookings", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("synced", "2026-09-01", -100)]);
  await assert.rejects(updateTransactionDetails((await stored(db, "synced")).id, {
    type: "adjustment"
  }), ValidationError);
  await assert.rejects(updateTransactionDetails("missing", {
    type: "income"
  }), (error: unknown) => error instanceof HttpError && error.status === 404);
});

test("a CSV import pairs its bookings with an unpaired transfer of a synced account", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values({
    id: "cash",
    environment: "SANDBOX",
    name: "Synthetic cash",
    institution: "Wallet",
    kind: "savings"
  });
  await sync(db, "checking", [entry("withdrawal", "2026-09-01", -20000, true)]);
  await importCashRow("2026-09-02", "200.00");

  const cash = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "cash")).get();

  assert.equal(cash?.type, "transfer");
  assert.equal(cash?.transfer_id, (await stored(db, "withdrawal")).transfer_id);
});

for (const [accounts, paired] of [[["cash", "wallet"], false], [["cash"], true]] as const) {
  test(`a CSV import in batches pairs an existing transfer only after its last batch, ${paired ? "with its single candidate" : "and not with two candidates in different accounts"}`, async context => {
    const db = await isolatedDatabase(context);
    const importId = randomUUID();

    for (const id of ["cash", "wallet"]) {
      await db.insert(schema.accounts).values({
        id,
        environment: "SANDBOX",
        name: `Synthetic ${id}`,
        institution: "Wallet",
        kind: "savings"
      });
    }

    await sync(db, "checking", [entry("withdrawal", "2026-09-01", -20000, true)]);

    for (const [index, account] of accounts.entries()) {
      await importMappedRows({
        import_id: importId,
        rows: [{
          line: index + 2,
          date: "2026-09-02",
          amount: "200.00",
          currency: "EUR",
          payee: "ATM",
          description: "Cash withdrawal",
          category: null,
          source: account,
          occurrence: 0,
          id: null
        }],
        targets: accounts.map(source => ({
          source,
          account_id: source
        })),
        confirm: true,
        final: index === accounts.length - 1
      });
    }

    const linked = (await db.select().from(schema.transactions)).filter(row => row.transfer_id !== null);

    assert.equal(linked.length, paired ? 2 : 0);
  });
}

test("detected transfers are categorized by rules like any other booking and their category never changes the cash flow", async context => {
  const db = await isolatedDatabase(context);
  const rules = [{
    id: "rule-savings",
    name: "Savings",
    pattern: "Standing order",
    mode: "keyword" as const,
    category_id: "leisure",
    priority: 10,
    enabled: 1
  }];
  const balances = [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "0.00",
      currency: "EUR"
    },
    reference_date: "2026-09-30"
  }];
  const standingOrder = {
    ...entry("standing-order", "2026-09-02", -35000, true),
    description: "Standing order"
  };

  await saveAccountSync(db, {
    environment: "SANDBOX",
    startedAt: "2026-09-30T09:00:00.000Z"
  }, "checking", "EUR", balances, [standingOrder, entry("unmatched", "2026-09-03", -20000, true), entry("market", "2026-09-04", -4500)], rules);

  assert.deepEqual([(await stored(db, "standing-order")).category_id, (await stored(db, "standing-order")).type], ["leisure", "transfer"]);
  assert.deepEqual([(await stored(db, "unmatched")).category_id, (await stored(db, "unmatched")).type], [null, "transfer"]);

  const cashFlow = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-09")), "EUR");

  assert.equal(cashFlow.expenses, 4500);
  assert.deepEqual(cashFlow.expenseBreakdown.map(item => [item.categoryId, item.amount]), [[null, 4500]]);
});

test("leaving the transfer type on a booking Ufer created on a manual account removes it and corrects its source", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("deposit", "2026-09-15", -2500000)]);
  await saveTransfer((await stored(db, "deposit")).id, {
    account_id: "property"
  });
  const created = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "property")).get();

  assert.ok(created);
  await updateTransactionDetails(created.id, {
    type: "income"
  });

  const deposit = await stored(db, "deposit");

  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "property"))).length, 0);
  assert.deepEqual([deposit.type, deposit.type_source, deposit.transfer_id], ["expense", "manual", null]);
});

test("linking accepts only the bookings the dialog offers: the exact opposite amount in the same currency within 14 days", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("out", "2026-09-01", -10000)]);
  await sync(db, "savings", [entry("smaller", "2026-09-02", 9999), entry("late", "2026-09-16", 10000), entry("in-window", "2026-09-15", 10000)]);
  await sync(db, "dollars", [entry("dollars", "2026-09-02", 10000, false, "USD")], "USD");
  const out = (await stored(db, "out")).id;

  for (const reference of ["dollars", "smaller", "late"]) {
    await assert.rejects(saveTransfer(out, {
      counterpart_id: (await stored(db, reference)).id
    }), ValidationError, reference);
    assert.equal((await stored(db, reference)).transfer_id, null, reference);
  }

  assert.equal((await stored(db, "out")).transfer_id, null);
  await saveTransfer(out, {
    counterpart_id: (await stored(db, "in-window")).id
  });
  assert.ok(await linked(db, "out", "in-window"));
});

test("one save moves a transfer between a booking, a manual account and no counterpart without leaving stale links", async context => {
  const db = await isolatedDatabase(context);
  const createdOnFlat = async () => db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "property"));

  await sync(db, "checking", [entry("out", "2026-09-01", -10000, true)]);
  await sync(db, "savings", [entry("in", "2026-09-01", 10000, true)]);
  const out = (await stored(db, "out")).id;

  assert.ok(await linked(db, "out", "in"));
  assert.equal((await transferOptions(out)).counterpart?.id, (await stored(db, "in")).id);

  await saveTransfer(out, {
    account_id: "property"
  });
  assert.equal((await createdOnFlat()).length, 1);
  assert.equal((await createdOnFlat())[0].transfer_id, (await stored(db, "out")).transfer_id);
  assert.deepEqual([(await stored(db, "in")).type, (await stored(db, "in")).transfer_id], ["transfer", null]);
  assert.equal((await transferOptions(out)).counterpart?.created, true);

  await saveTransfer(out, {
    counterpart_id: (await stored(db, "in")).id
  });
  assert.equal((await createdOnFlat()).length, 0);
  assert.ok(await linked(db, "out", "in"));

  // Omitting the target keeps the link; a target on another type is refused.
  await updateTransactionDetails(out, {
    type: "transfer"
  });
  assert.ok(await linked(db, "out", "in"));
  await assert.rejects(updateTransactionDetails(out, {
    type: "expense",
    transfer: {
      account_id: "property"
    }
  }), ValidationError);

  await saveTransfer(out, null);
  assert.deepEqual([(await stored(db, "out")).transfer_id, (await stored(db, "out")).transfer_source], [null, "manual"]);
  assert.deepEqual([(await stored(db, "in")).type, (await stored(db, "in")).transfer_id], ["transfer", null]);
});

test("choosing no counterpart marks the transfer as manually unlinked, so neither the save nor later syncs and imports pair it", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values({
    id: "cash",
    environment: "SANDBOX",
    name: "Synthetic cash",
    institution: "Wallet",
    kind: "savings"
  });
  // Neither booking is a transfer yet, so nothing pairs them before the person decides.
  await sync(db, "checking", [entry("out", "2026-09-01", -10000)]);
  await sync(db, "savings", [entry("in", "2026-09-02", 10000)]);
  await saveTransfer((await stored(db, "out")).id, null);

  const out = await stored(db, "out");

  assert.deepEqual([out.type, out.transfer_id, out.transfer_source], ["transfer", null, "manual"]);
  assert.equal((await stored(db, "in")).transfer_id, null);

  await sync(db, "checking", [entry("out", "2026-09-01", -10000)]);
  await sync(db, "savings", [entry("in", "2026-09-02", 10000)]);
  await importCashRow("2026-09-01", "100.00");

  assert.equal((await stored(db, "out")).transfer_id, null);
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "cash")).get())?.transfer_id, null);
});

test("a booking Ufer created on a manual account keeps its source link or is removed, but is never retargeted", async context => {
  const db = await isolatedDatabase(context);
  const onFlat = async () => db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "property"));

  await sync(db, "checking", [entry("deposit", "2026-09-15", -2500000), entry("other-out", "2026-09-16", -2500000)]);
  await saveTransfer((await stored(db, "deposit")).id, {
    account_id: "property"
  });
  const [created] = await onFlat();
  const deposit = await stored(db, "deposit");

  for (const transfer of [{
    counterpart_id: (await stored(db, "other-out")).id
  }, {
    account_id: "property"
  }]) {
    await assert.rejects(saveTransfer(created.id, transfer), ValidationError);
  }

  assert.equal((await onFlat())[0].transfer_id, deposit.transfer_id);
  assert.equal((await stored(db, "other-out")).transfer_id, null);

  await saveTransfer(created.id, {
    counterpart_id: deposit.id
  });
  assert.equal((await onFlat())[0].transfer_id, deposit.transfer_id);

  await saveTransfer(created.id, null);
  assert.equal((await onFlat()).length, 0);
  assert.deepEqual([(await stored(db, "deposit")).type, (await stored(db, "deposit")).transfer_id], ["transfer", null]);
});

test("a redelivered booking whose sign changed releases its link instead of failing the sync", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("out", "2026-09-01", -10000, true)]);
  await sync(db, "savings", [entry("in", "2026-09-01", 10000, true)]);
  assert.ok(await linked(db, "out", "in"));

  await sync(db, "checking", [entry("out", "2026-09-01", 10000)]);

  const [out, incoming] = [await stored(db, "out"), await stored(db, "in")];

  assert.deepEqual([out.amount_minor, out.type, out.transfer_id], [10000, "income", null]);
  assert.deepEqual([incoming.type, incoming.transfer_id], ["transfer", null]);
});

test("a redelivered amount that no longer matches releases a link between imported bookings, and a counterpart created on a manual account follows it", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("out", "2026-09-01", -10000, true), entry("deposit", "2026-09-15", -2500000)]);
  await sync(db, "savings", [entry("in", "2026-09-01", 10000, true)]);
  await saveTransfer((await stored(db, "deposit")).id, {
    account_id: "property"
  });
  assert.ok(await linked(db, "out", "in"));

  await sync(db, "checking", [entry("out", "2026-09-01", -9000, true), entry("deposit", "2026-09-15", -2400000)]);

  assert.equal((await stored(db, "out")).transfer_id, null);
  assert.equal((await stored(db, "in")).transfer_id, null);
  // The created counterpart exists only for its source, so it takes the corrected amount and stays linked (ADR 009).
  const created = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "property"));

  assert.deepEqual(created.map(row => [row.amount_minor, row.transfer_id]), [[2400000, (await stored(db, "deposit")).transfer_id]]);
  assert.equal((await stored(db, "deposit")).type, "transfer");

  // An unchanged redelivery keeps a link.
  await sync(db, "checking", [entry("out", "2026-09-01", -10000, true)]);
  await sync(db, "savings", [entry("in", "2026-09-01", 10000, true)]);
  assert.ok(await linked(db, "out", "in"));
  await sync(db, "checking", [entry("out", "2026-09-01", -10000, true)]);
  assert.ok(await linked(db, "out", "in"));
});


test("type filtering uses booking types, combines with list filters and paginates matching counts", async context => {
  const db = await isolatedDatabase(context);
  const types = ["income", "expense", "transfer", "opening_balance", "adjustment"] as const;

  await db.insert(schema.transactions).values(types.map(type => ({
    id: `filter-${type}`,
    account_id: "property",
    provider_reference: `filter-${type}`,
    booking_date: "2026-09-15",
    amount_minor: 1000,
    currency: "EUR",
    counterparty: "Synthetic matching payee",
    category_id: "income",
    type
  })));
  await db.insert(schema.transactions).values(Array.from({
    length: 51
  }, (_, index) => ({
    id: `expense-${index}`,
    account_id: "checking",
    provider_reference: `expense-${index}`,
    booking_date: "2026-09-10",
    amount_minor: -100,
    currency: "EUR",
    type: "expense" as const
  })));

  for (const type of types) {
    const result = await readTransactionPage(dashboardFilters(new URLSearchParams({
      period: "2026-09",
      type
    })));

    assert.equal(result.transactionCount, type === "expense" ? 52 : 1);
    assert.ok(result.transactions.every(booking => booking.type === type));
  }

  const secondPage = await readTransactionPage(dashboardFilters(new URLSearchParams("period=2026-09&type=expense&page=2")));

  assert.equal(secondPage.transactionCount, 52);
  assert.equal(secondPage.transactions.length, 2);
  const combined = await readTransactionPage(dashboardFilters(new URLSearchParams("period=2026-09&type=expense&account=property&category=income&search=matching")));

  assert.deepEqual(combined.transactions.map(booking => booking.id), ["filter-expense"]);
  assert.equal(combined.transactions[0].amount_minor, 1000, "a positive expense refund stays an expense");
  assert.throws(() => dashboardFilters(new URLSearchParams("type=unknown")), error => error instanceof HttpError && error.status === 400);
});
