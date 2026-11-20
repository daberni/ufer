import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { applyRulesToUncorrectedTransactions, createRule, deleteRule, updateRuleDetails } from "../src/features/categorization/server/categorization-service";
import { listRules, saveRuleTypes } from "../src/features/categorization/server/rule-repository";
import { importMappedRows } from "../src/features/imports/server/mapped-import-service";
import { pairTransfersInEnvironment } from "../src/features/transactions/server/transfer-repository";
import { updateTransactionDetails } from "../src/features/transactions/server/transaction-service";
import { ValidationError } from "../src/lib/errors";
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
    id: "deposit",
    environment: "SANDBOX",
    name: "Synthetic deposit",
    institution: "Example bank",
    kind: "savings",
    provider: "enable_banking"
  }, {
    id: "cash",
    environment: "SANDBOX",
    name: "Synthetic cash",
    institution: "Wallet",
    kind: "checking"
  }]);

  return db;
}

let runCounter = 0;

/** Stores one account's bank delivery with the stored rules and then pairs transfers, as a sync does once every account is stored. */
async function sync(db: Database, accountId: string, entries: Entry[]) {
  runCounter += 1;
  const run = {
    environment: "SANDBOX",
    startedAt: `2026-09-30T09:00:${String(runCounter % 60).padStart(2, "0")}.000Z`
  };
  const balances = [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "0.00",
      currency: "EUR"
    },
    reference_date: "2026-09-30"
  }];

  await saveAccountSync(db, run, accountId, "EUR", balances, entries, await listRules());
  await pairTransfersInEnvironment("SANDBOX");
}

function entry(reference: string, date: string, amount: number, counterparty: string): Entry {
  return {
    reference: `bank:${reference}`,
    date,
    amount,
    currency: "EUR",
    counterparty,
    description: `Synthetic ${reference}`
  };
}

async function stored(db: Database, reference: string) {
  const row = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, reference)).get();

  assert.ok(row, reference);

  return row;
}

async function rule(details: {
  pattern: string;
  transaction_type?: string | null;
  transfer_account_id?: string | null;
  apply_to_uncategorized?: boolean;
  adopt_manual?: boolean;
}) {
  await createRule({
    name: details.pattern,
    mode: "keyword",
    category_id: "groceries",
    ...details
  });

  const created = (await listRules()).find(candidate => candidate.pattern === details.pattern);

  assert.ok(created);

  return created;
}

test("a sync gives matching bookings the rule's type and records the rule; other bookings keep the derived type", async context => {
  const db = await isolatedDatabase(context);
  const refund = await rule({
    pattern: "REFUND DESK",
    transaction_type: "expense"
  });

  await sync(db, "checking", [entry("refund", "2026-09-10", 1500, "Refund desk"), entry("salary", "2026-09-11", 300000, "Example employer")]);

  const ruled = await stored(db, "bank:refund");
  const other = await stored(db, "bank:salary");

  assert.deepEqual([ruled.type, ruled.type_source, ruled.type_rule_id], ["expense", "auto", refund.id]);
  assert.deepEqual([other.type, other.type_rule_id], ["income", null]);
});

test("a manual type correction survives later syncs and applying rules", async context => {
  const db = await isolatedDatabase(context);

  await rule({
    pattern: "REFUND DESK",
    transaction_type: "expense"
  });
  await sync(db, "checking", [entry("refund", "2026-09-10", 1500, "Refund desk")]);
  await updateTransactionDetails((await stored(db, "bank:refund")).id, {
    type: "income"
  });
  await sync(db, "checking", [entry("refund", "2026-09-10", 1500, "Refund desk")]);
  await applyRulesToUncorrectedTransactions();

  const corrected = await stored(db, "bank:refund");

  assert.deepEqual([corrected.type, corrected.type_source, corrected.type_rule_id], ["income", "manual", null]);
});

test("a rule's transfer account decides which of several opposite bookings the transfer links with", async context => {
  const db = await isolatedDatabase(context);

  await rule({
    pattern: "SAVINGS PLAN",
    transaction_type: "transfer",
    transfer_account_id: "savings"
  });
  // Opposite bookings on two own accounts would otherwise leave the transfer ambiguous and unpaired.
  await sync(db, "savings", [entry("savings-in", "2026-09-02", 20000, "Synthetic checking")]);
  await sync(db, "deposit", [entry("deposit-in", "2026-09-02", 20000, "Synthetic checking")]);
  await sync(db, "checking", [entry("plan", "2026-09-01", -20000, "Savings plan")]);

  const plan = await stored(db, "bank:plan");
  const savings = await stored(db, "bank:savings-in");
  const deposit = await stored(db, "bank:deposit-in");

  assert.equal(plan.type, "transfer");
  assert.ok(plan.transfer_id);
  assert.equal(savings.transfer_id, plan.transfer_id);
  assert.equal(deposit.transfer_id, null);
});

test("a rule's transfer to a manual account creates the counterpart exactly once across syncs and applying rules", async context => {
  const db = await isolatedDatabase(context);

  await rule({
    pattern: "CASH WITHDRAWAL",
    transaction_type: "transfer",
    transfer_account_id: "cash"
  });
  await sync(db, "checking", [entry("atm", "2026-09-05", -10000, "Cash withdrawal")]);
  await sync(db, "checking", [entry("atm", "2026-09-05", -10000, "Cash withdrawal")]);
  await applyRulesToUncorrectedTransactions();

  const withdrawal = await stored(db, "bank:atm");
  const counterparts = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "cash"));

  assert.equal(counterparts.length, 1);
  assert.deepEqual([counterparts[0].amount_minor, counterparts[0].booking_date, counterparts[0].transfer_id], [10000, "2026-09-05", withdrawal.transfer_id]);
  assert.deepEqual([withdrawal.type, withdrawal.type_source, withdrawal.transfer_source], ["transfer", "auto", "auto"]);
});

test("a rule's transfer to a manual account links a booking already there instead of creating another", async context => {
  const db = await isolatedDatabase(context);

  await rule({
    pattern: "CASH WITHDRAWAL",
    transaction_type: "transfer",
    transfer_account_id: "cash"
  });
  await importMappedRows({
    import_id: randomUUID(),
    rows: [{
      line: 2,
      date: "2026-09-05",
      amount: "100.00",
      currency: "EUR",
      payee: "ATM",
      description: "Cash top-up",
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
  await sync(db, "checking", [entry("atm", "2026-09-05", -10000, "Cash withdrawal")]);

  const withdrawal = await stored(db, "bank:atm");
  const cash = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "cash"));

  assert.equal(cash.length, 1);
  assert.ok(withdrawal.transfer_id);
  assert.equal(cash[0].transfer_id, withdrawal.transfer_id);
});

test("a CSV import gives rows the rule's type, also rows whose category came from the file", async context => {
  const db = await isolatedDatabase(context);
  const savings = await rule({
    pattern: "STANDING ORDER",
    transaction_type: "transfer"
  });

  await importMappedRows({
    import_id: randomUUID(),
    rows: [{
      line: 2,
      date: "2026-09-03",
      amount: "-50.00",
      currency: "EUR",
      payee: "Standing order",
      description: "",
      category: "Groceries",
      source: "",
      occurrence: 0,
      id: "row-1"
    }, {
      line: 3,
      date: "2026-09-04",
      amount: "-20.00",
      currency: "EUR",
      payee: "Example bakery",
      description: "",
      category: null,
      source: "",
      occurrence: 0,
      id: "row-2"
    }],
    targets: [{
      source: "",
      account_id: "cash"
    }],
    confirm: true
  });

  const rows = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "cash"));
  const order = rows.find(row => row.counterparty === "Standing order");
  const bakery = rows.find(row => row.counterparty === "Example bakery");

  assert.deepEqual([order?.type, order?.type_rule_id, order?.category_source], ["transfer", savings.id, "manual"]);
  assert.deepEqual([bakery?.type, bakery?.type_rule_id], ["expense", null]);
});

test("applying rules sets rule types on existing bookings and returns them to the derived type when the rule stops setting one", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("refund", "2026-09-10", 1500, "Refund desk")]);
  const refund = await rule({
    pattern: "REFUND DESK",
    transaction_type: "expense"
  });

  assert.equal((await stored(db, "bank:refund")).type, "income");
  assert.deepEqual(await applyRulesToUncorrectedTransactions(), {
    updated: 1,
    retyped: 1
  });
  assert.deepEqual([(await stored(db, "bank:refund")).type, (await stored(db, "bank:refund")).type_rule_id], ["expense", refund.id]);

  await updateRuleDetails(refund.id, {
    name: refund.name,
    pattern: refund.pattern,
    mode: refund.mode,
    category_id: refund.category_id,
    transaction_type: ""
  });
  await applyRulesToUncorrectedTransactions();

  const released = await stored(db, "bank:refund");

  assert.deepEqual([released.type, released.type_rule_id], ["income", null]);
});

test("creating a rule that applies to uncategorized bookings also sets its type on them", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("refund", "2026-09-10", 1500, "Refund desk")]);
  const refund = await rule({
    pattern: "REFUND DESK",
    transaction_type: "expense",
    apply_to_uncategorized: true
  });

  const booking = await stored(db, "bank:refund");

  assert.deepEqual([booking.category_id, booking.type, booking.type_rule_id], ["groceries", "expense", refund.id]);
});

test("a rule that takes over manual category assignments also sets its type on them", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("refund", "2026-09-10", 1500, "Refund desk")]);
  await db.update(schema.transactions).set({
    category_id: "groceries",
    category_source: "manual"
  }).where(eq(schema.transactions.provider_reference, "bank:refund"));
  const refund = await rule({
    pattern: "REFUND DESK",
    transaction_type: "expense",
    adopt_manual: true
  });

  const booking = await stored(db, "bank:refund");

  assert.deepEqual([booking.category_source, booking.type, booking.type_rule_id], ["rule", "expense", refund.id]);
});

test("deleting a rule keeps the types it set without a reference to the rule", async context => {
  const db = await isolatedDatabase(context);
  const refund = await rule({
    pattern: "REFUND DESK",
    transaction_type: "expense"
  });

  await sync(db, "checking", [entry("refund", "2026-09-10", 1500, "Refund desk")]);
  await deleteRule(refund.id);

  const booking = await stored(db, "bank:refund");

  assert.deepEqual([booking.type, booking.type_rule_id], ["expense", null]);
});

test("a rule names a transfer account only for transfers, and only one of the workspace's accounts", async context => {
  await isolatedDatabase(context);

  await assert.rejects(rule({
    pattern: "SAVINGS PLAN",
    transaction_type: "expense",
    transfer_account_id: "savings"
  }), ValidationError);
  await assert.rejects(rule({
    pattern: "SAVINGS PLAN",
    transaction_type: "transfer",
    transfer_account_id: "unknown-account"
  }), ValidationError);
  await assert.rejects(rule({
    pattern: "SAVINGS PLAN",
    transaction_type: "opening_balance"
  }));

  const saved = await rule({
    pattern: "SAVINGS PLAN",
    transaction_type: "transfer",
    transfer_account_id: "savings"
  });

  assert.deepEqual([saved.transaction_type, saved.transfer_account_id], ["transfer", "savings"]);
});

test("a transfer rule cannot name an archived account", async context => {
  const db = await isolatedDatabase(context);

  await db.update(schema.accounts).set({
    archived_at: "2026-09-01T00:00:00.000Z"
  }).where(eq(schema.accounts.id, "savings"));

  await assert.rejects(rule({
    pattern: "SAVINGS PLAN",
    transaction_type: "transfer",
    transfer_account_id: "savings"
  }), ValidationError);
});

test("a rule's transfer creates no counterpart on a manual account archived after the rule was saved", async context => {
  const db = await isolatedDatabase(context);

  await rule({
    pattern: "CASH WITHDRAWAL",
    transaction_type: "transfer",
    transfer_account_id: "cash"
  });
  await db.update(schema.accounts).set({
    archived_at: "2026-09-01T00:00:00.000Z"
  }).where(eq(schema.accounts.id, "cash"));
  await sync(db, "checking", [entry("atm", "2026-09-05", -10000, "Cash withdrawal")]);
  await applyRulesToUncorrectedTransactions();

  const withdrawal = await stored(db, "bank:atm");

  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "cash"))).length, 0);
  assert.deepEqual([withdrawal.type, withdrawal.transfer_id], ["transfer", null]);
});

test("applying rule types leaves bookings on archived accounts unchanged, also when the account is archived after they were read", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("refund", "2026-09-10", 1500, "Refund desk")]);
  const refund = await rule({
    pattern: "REFUND DESK",
    transaction_type: "expense"
  });
  const booking = await stored(db, "bank:refund");

  await db.update(schema.accounts).set({
    archived_at: "2026-09-20T00:00:00.000Z"
  }).where(eq(schema.accounts.id, "checking"));

  assert.equal((await applyRulesToUncorrectedTransactions()).retyped, 0);
  await saveRuleTypes([{
    id: booking.id,
    type: "expense",
    type_rule_id: refund.id
  }]);

  const unchanged = await stored(db, "bank:refund");

  assert.deepEqual([unchanged.type, unchanged.type_rule_id], ["income", null]);
});

test("a rule without a type that takes over a manual assignment returns an earlier rule's type to the derived type", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("refund", "2026-09-10", 1500, "Refund desk")]);
  const earlier = await rule({
    pattern: "REFUND DESK",
    transaction_type: "expense",
    apply_to_uncategorized: true
  });

  assert.deepEqual([(await stored(db, "bank:refund")).type, (await stored(db, "bank:refund")).type_rule_id], ["expense", earlier.id]);
  // A person then chooses the category, and the earlier rule no longer matches the booking.
  await db.update(schema.transactions).set({
    category_source: "manual",
    category_rule_id: null
  }).where(eq(schema.transactions.provider_reference, "bank:refund"));
  await db.update(schema.categorizationRules).set({
    pattern: "UNRELATED"
  }).where(eq(schema.categorizationRules.id, earlier.id));

  await rule({
    pattern: "REFUND",
    adopt_manual: true
  });

  const adopted = await stored(db, "bank:refund");

  assert.deepEqual([adopted.category_source, adopted.type, adopted.type_rule_id], ["rule", "income", null]);
});

test("a bank-reported transfer returns to Transfer when the rule that overrode its type stops setting one", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [{
    ...entry("sweep", "2026-09-12", -2500, "Account sweep"),
    transfer: true
  }]);
  assert.equal((await stored(db, "bank:sweep")).type, "transfer");

  const sweep = await rule({
    pattern: "ACCOUNT SWEEP",
    transaction_type: "expense"
  });

  await applyRulesToUncorrectedTransactions();
  assert.equal((await stored(db, "bank:sweep")).type, "expense");

  await updateRuleDetails(sweep.id, {
    name: sweep.name,
    pattern: sweep.pattern,
    mode: sweep.mode,
    category_id: sweep.category_id,
    transaction_type: ""
  });
  await applyRulesToUncorrectedTransactions();

  const released = await stored(db, "bank:sweep");

  assert.deepEqual([released.type, released.type_rule_id], ["transfer", null]);
});

test("a rule without a type that takes over a manual assignment returns a bank-reported transfer to Transfer", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [{
    ...entry("sweep", "2026-09-12", -2500, "Account sweep"),
    transfer: true
  }]);
  const earlier = await rule({
    pattern: "ACCOUNT SWEEP",
    transaction_type: "expense",
    apply_to_uncategorized: true
  });

  assert.equal((await stored(db, "bank:sweep")).type, "expense");
  await db.update(schema.transactions).set({
    category_source: "manual",
    category_rule_id: null
  }).where(eq(schema.transactions.provider_reference, "bank:sweep"));
  await db.update(schema.categorizationRules).set({
    pattern: "UNRELATED"
  }).where(eq(schema.categorizationRules.id, earlier.id));

  await rule({
    pattern: "SWEEP",
    adopt_manual: true
  });

  const adopted = await stored(db, "bank:sweep");

  assert.deepEqual([adopted.type, adopted.type_rule_id], ["transfer", null]);
});
