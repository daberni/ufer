import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { createManualAccount } from "../src/features/accounts/server/account-service";
import { listAccounts } from "../src/features/accounts/server/account-queries";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { importMappedRows } from "../src/features/imports/server/mapped-import-service";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { enterManualTransaction, hideTransaction, updateTransactionCategory, updateTransactionDetails } from "../src/features/transactions/server/transaction-service";
import { listRules } from "../src/features/categorization/server/rule-repository";
import type { Rule } from "../src/lib/rules";
import { applyRulesToUncorrectedTransactions, createRule, previewRule } from "../src/features/categorization/server/categorization-service";
import { pairAllTransfers } from "../src/features/transactions/server/transfer-pairing-repository";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { monthPeriod } from "../src/lib/period";
import { HttpError, ValidationError } from "../src/lib/errors";

const now = Temporal.Instant.from("2026-10-31T12:00:00Z");
const september = monthPeriod(Temporal.PlainYearMonth.from("2026-09"));

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
    name: "Synthetic checking",
    institution: "Example bank",
    kind: "checking",
    provider: "enable_banking"
  }, {
    id: "savings",
    name: "Synthetic savings",
    institution: "Example bank",
    kind: "savings",
    provider: "enable_banking"
  }]);

  return db;
}

type Booking = {
  reference: string;
  date: string;
  amount: number;
  counterparty?: string;
  description?: string;
};

/** Stores one sync delivery of bookings on a synced account. */
async function sync(accountId: string, bookings: Booking[], rules: Rule[] = []) {
  await saveAccountSync({
    startedAt: "2026-09-30T08:00:00.000Z"
  }, accountId, "EUR", [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "1000.00",
      currency: "EUR"
    },
    reference_date: "2026-09-30"
  }], bookings.map(booking => ({
    reference: booking.reference,
    date: booking.date,
    amount: booking.amount,
    currency: "EUR",
    counterparty: booking.counterparty ?? "Example counterparty",
    description: booking.description ?? `Synthetic ${booking.reference}`
  })), rules);
}

async function byReference(db: Database, reference: string) {
  const booking = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, reference)).get();

  assert.ok(booking, reference);

  return booking;
}

async function row(db: Database, id: string) {
  return db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get();
}

async function listed(search = "") {
  const page = await readTransactionPage(dashboardFilters(new URLSearchParams({
    period: "2026-09",
    ...(search ? {
      search
    } : {})
  })));

  return page.transactions;
}

async function expenses() {
  return (await readCashFlow(september, "EUR")).expenses;
}

test("a payee and description override survives a resync that changes the bank's text, and restoring the bank's text follows the bank again", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [{
    reference: "bank:1",
    date: "2026-09-03",
    amount: -1250,
    counterparty: "EXMPL MKT 123",
    description: "CARD 4711"
  }]);
  const booking = await byReference(db, "bank:1");

  await updateTransactionDetails(booking.id, {
    type: "expense",
    counterparty: "Example Market",
    description: "Weekly groceries"
  });
  await sync("checking", [{
    reference: "bank:1",
    date: "2026-09-04",
    amount: -1300,
    counterparty: "EXAMPLE MARKET GMBH",
    description: "CARD 4711 CORRECTED"
  }]);

  const [shown] = await listed();

  assert.deepEqual([shown.counterparty, shown.description, shown.source_counterparty, shown.source_description], ["Example Market", "Weekly groceries", "EXAMPLE MARKET GMBH", "CARD 4711 CORRECTED"]);
  // The bank keeps the identity, date and amount.
  assert.deepEqual([shown.date, shown.amount_minor], ["2026-09-04", -1300]);
  assert.equal((await listed("weekly groceries")).length, 1);
  assert.equal((await listed("4711 corrected")).length, 0);

  await updateTransactionDetails(booking.id, {
    type: "expense",
    counterparty: "EXAMPLE MARKET GMBH"
  });
  const stored = await byReference(db, "bank:1");

  assert.equal(stored.counterparty_override, null);
  assert.equal(stored.description_override, "Weekly groceries");
  assert.equal(await db.$count(schema.transactions, ne(schema.transactions.type, "opening_balance")), 1);
});

test("saving only a type stores no override, and a transaction entered in Ufer is not given one", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [{
    reference: "bank:1",
    date: "2026-09-03",
    amount: -1250
  }]);
  const booking = await byReference(db, "bank:1");

  await updateTransactionDetails(booking.id, {
    type: "expense"
  });
  assert.deepEqual([(await byReference(db, "bank:1")).counterparty_override, (await byReference(db, "bank:1")).description_override], [null, null]);

  const { id: cash } = await createManualAccount({
    name: "Synthetic cash",
    institution: "Example institution",
    kind: "savings",
    currency: "EUR",
    balance: "100.00",
    date: "2026-09-01"
  }, now);
  const { id } = await enterManualTransaction(cash, {
    type: "expense",
    date: "2026-09-05",
    amount: "-5.00",
    counterparty: "Example kiosk"
  }, now);

  await assert.rejects(updateTransactionDetails(id, {
    type: "expense",
    counterparty: "Renamed"
  }), ValidationError);
  await assert.rejects(hideTransaction(id, true, now), ValidationError);
});

test("a hidden synced booking stays hidden across resyncs and counts toward no cash flow until it is shown again", async context => {
  const db = await isolatedDatabase(context);
  const delivery = [{
    reference: "bank:1",
    date: "2026-09-03",
    amount: -1250
  }, {
    reference: "bank:duplicate",
    date: "2026-09-03",
    amount: -1250
  }];

  await sync("checking", delivery);
  assert.equal(await expenses(), 2500);

  const duplicate = await byReference(db, "bank:duplicate");

  await hideTransaction(duplicate.id, true, now);
  await sync("checking", delivery);

  assert.equal(await db.$count(schema.transactions, ne(schema.transactions.type, "opening_balance")), 2);
  assert.equal((await byReference(db, "bank:duplicate")).suppressed_at, now.toString());
  assert.equal(await expenses(), 1250);
  // The listing also holds the opening balance the first sync booked.
  assert.deepEqual((await listed()).map(item => item.hidden).sort(), [false, false, true]);

  await hideTransaction(duplicate.id, false, now);
  assert.equal(await expenses(), 2500);
});

test("a hidden CSV booking leaves the manual account balance, and importing the same file again does not bring it back", async context => {
  const db = await isolatedDatabase(context);
  const { id: cash } = await createManualAccount({
    name: "Synthetic cash",
    institution: "Example institution",
    kind: "savings",
    currency: "EUR",
    balance: "100.00",
    date: "2026-09-01"
  }, now);
  const balance = async () => (await listAccounts()).find(account => account.id === cash)?.balance_minor;
  const importFile = (id: string) => importMappedRows({
    import_id: randomUUID(),
    rows: [0, 1].map(occurrence => ({
      line: occurrence + 2,
      date: "2026-09-10",
      amount: "-20.00",
      currency: "EUR",
      payee: "Example bank",
      description: "Synthetic fee",
      category: null,
      source: "",
      occurrence,
      id: `${id}-${occurrence}`
    })),
    targets: [{
      source: "",
      account_id: cash
    }],
    confirm: true
  }, now);
  const fees = () => db.select().from(schema.transactions).where(eq(schema.transactions.account_id, cash)).all().then(rows => rows.filter(row => row.type === "expense"));

  await importFile("fee");
  assert.equal(await balance(), 6000);

  const [, duplicate] = await fees();

  await hideTransaction(duplicate.id, true, now);
  await updateTransactionDetails(duplicate.id, {
    type: "expense",
    counterparty: "Duplicate of the bank fee"
  });
  await importFile("fee");

  assert.equal((await fees()).length, 2);
  assert.equal(await balance(), 8000);
  assert.equal(await expenses(), 2000);
  assert.ok((await row(db, duplicate.id))?.suppressed_at);
});

test("hiding a linked transfer releases its counterpart, and automatic pairing never links a hidden booking", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [{
    reference: "bank:out",
    date: "2026-09-03",
    amount: -5000
  }]);
  await sync("savings", [{
    reference: "bank:in",
    date: "2026-09-03",
    amount: 5000
  }]);
  const outgoing = await byReference(db, "bank:out");
  const incoming = await byReference(db, "bank:in");

  await updateTransactionDetails(outgoing.id, {
    type: "transfer",
    transfer: {
      counterpart_id: incoming.id
    }
  });
  assert.ok((await byReference(db, "bank:in")).transfer_id);

  await hideTransaction(outgoing.id, true, now);

  const released = await byReference(db, "bank:in");

  assert.deepEqual([released.transfer_id, released.type], [null, "income"]);
  assert.equal((await byReference(db, "bank:out")).transfer_id, null);

  // Even once both sides are plain transfers again, the hidden one is never paired.
  await db.update(schema.transactions).set({
    type: "transfer",
    transfer_source: "auto"
  });
  assert.equal(await pairAllTransfers(), 0);
});

test("a hidden booking cannot be linked with another booking until it is shown again", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [{
    reference: "bank:out",
    date: "2026-09-03",
    amount: -5000
  }]);
  await sync("savings", [{
    reference: "bank:in",
    date: "2026-09-03",
    amount: 5000
  }]);
  const outgoing = await byReference(db, "bank:out");
  const incoming = await byReference(db, "bank:in");
  const link = () => updateTransactionDetails(outgoing.id, {
    type: "transfer",
    transfer: {
      counterpart_id: incoming.id
    }
  });

  await hideTransaction(outgoing.id, true, now);
  await assert.rejects(link(), (error: unknown) => error instanceof HttpError && error.status === 409);
  assert.equal((await byReference(db, "bank:in")).transfer_id, null);
  assert.equal((await byReference(db, "bank:out")).type, "expense");

  await hideTransaction(outgoing.id, false, now);
  await link();
  assert.ok((await byReference(db, "bank:in")).transfer_id);
});

test("untouched source text with surrounding spaces stores no override", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [{
    reference: "bank:1",
    date: "2026-09-03",
    amount: -1250,
    counterparty: " Example Market ",
    description: "Card payment "
  }]);
  const booking = await byReference(db, "bank:1");

  await updateTransactionDetails(booking.id, {
    type: "expense",
    counterparty: " Example Market ",
    description: "Card payment "
  });

  const stored = await byReference(db, "bank:1");

  assert.deepEqual([stored.counterparty_override, stored.description_override], [null, null]);
});

test("a file row matching a hidden, overridden synced booking by the bank's text is a duplicate and does not bring it back", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [{
    reference: "bank:1",
    date: "2026-09-03",
    amount: -1250,
    counterparty: "Example Market",
    description: "Card payment"
  }]);
  const booking = await byReference(db, "bank:1");

  await updateTransactionDetails(booking.id, {
    type: "expense",
    counterparty: "Renamed by a person"
  });
  await hideTransaction(booking.id, true, now);
  await importMappedRows({
    import_id: randomUUID(),
    rows: [{
      line: 2,
      date: "2026-09-03",
      amount: "-12.50",
      currency: "EUR",
      payee: "Example Market",
      description: "Card payment",
      category: null,
      source: "",
      occurrence: 0,
      id: null
    }],
    targets: [{
      source: "",
      account_id: "checking"
    }],
    confirm: true
  }, now);

  assert.equal(await db.$count(schema.transactions, ne(schema.transactions.type, "opening_balance")), 1);
  assert.equal(await expenses(), 0);
});

/** A synced booking whose bank text carries no payee, with a person's payee override that names it. */
async function overriddenBooking(db: Database, reference = "bank:energy") {
  await sync("checking", [{
    reference,
    date: "2026-09-05",
    amount: -4200,
    counterparty: "",
    description: "EXAMPLE Power, invoice 0001"
  }]);
  const booking = await byReference(db, reference);

  await updateTransactionDetails(booking.id, {
    type: "expense",
    counterparty: "Example Energy Trading Ltd"
  });

  return booking.id;
}

const energyRule = {
  name: "Energy",
  pattern: "EXAMPLE ENERGY",
  mode: "keyword",
  category_id: "home"
};

test("a keyword matching only the payee override decides the booking when rules are applied, and later syncs keep it", async context => {
  const db = await isolatedDatabase(context);
  const id = await overriddenBooking(db);

  await createRule(energyRule);
  await applyRulesToUncorrectedTransactions();

  assert.equal((await row(db, id))?.category_id, "home");

  await sync("checking", [{
    reference: "bank:energy",
    date: "2026-09-05",
    amount: -4200,
    counterparty: "",
    description: "EXAMPLE Power, invoice 0001"
  }], await listRules());

  assert.equal((await row(db, id))?.category_id, "home");
});

test("a keyword matching only the payee override counts toward and adopts manual assignments, and the booking returns to it automatically", async context => {
  const db = await isolatedDatabase(context);
  const id = await overriddenBooking(db);

  await updateTransactionCategory(id, {
    category_id: "groceries"
  });

  const preview = await previewRule(energyRule);

  assert.equal(preview.manual, 1);

  const [shown] = await listed();

  assert.equal(shown.automatic_assignment?.category_id, null);

  await createRule({
    ...energyRule,
    id: preview.id,
    adopt_manual: true
  });
  const adopted = await row(db, id);

  assert.deepEqual([adopted?.category_id, adopted?.category_source], ["home", "rule"]);

  await updateTransactionCategory(id, {
    category_id: "groceries"
  });
  assert.equal((await listed())[0].automatic_assignment?.category_id, "home");
  assert.equal((await updateTransactionCategory(id, {
    automatic: true
  })).category_id, "home");
});

test("a rule created from a manually categorized booking adopts it when only its payee override matches", async context => {
  const db = await isolatedDatabase(context);
  const id = await overriddenBooking(db);

  await updateTransactionCategory(id, {
    category_id: "home"
  });
  await createRule({
    ...energyRule,
    source_transaction_id: id
  });

  assert.equal((await row(db, id))?.category_source, "rule");
});

test("the source text still decides when an override does not match, and the first rule matching either text wins", async context => {
  const db = await isolatedDatabase(context);
  const id = await overriddenBooking(db);

  await createRule({
    name: "Power",
    pattern: "EXAMPLE POWER",
    mode: "keyword",
    category_id: "leisure"
  });
  await applyRulesToUncorrectedTransactions();
  assert.equal((await row(db, id))?.category_id, "leisure");

  // The source-text rule comes first, so the later override rule does not decide.
  await createRule(energyRule);
  await applyRulesToUncorrectedTransactions();
  assert.equal((await row(db, id))?.category_id, "leisure");

  await createRule({
    ...energyRule,
    name: "Energy first",
    category_id: "groceries",
    priority: 0
  });
  await applyRulesToUncorrectedTransactions();
  assert.equal((await row(db, id))?.category_id, "groceries");
});
