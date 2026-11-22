import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { applyRulesToUncorrectedTransactions, createRule, previewRule, updateRuleDetails } from "../src/features/transactions/server/rule-application-service";
import { listRules } from "../src/features/categorization/server/rule-repository";
import { listRuleSummaries } from "../src/features/categorization/server/categorization-queries";
import { pairAllTransfers } from "../src/features/transactions/server/transfer-pairing-repository";
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
    name: "Synthetic checking",
    kind: "checking",
    provider: "enable_banking"
  }, {
    id: "savings",
    name: "Synthetic savings",
    kind: "savings",
    provider: "enable_banking"
  }, {
    id: "closed",
    name: "Synthetic closed",
    kind: "savings",
    provider: "enable_banking",
    archived_at: "2026-09-01T00:00:00.000Z"
  }]);

  return db;
}

let runCounter = 0;

async function sync(accountId: string, entries: Entry[]) {
  runCounter += 1;
  const run = {
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

  await saveAccountSync(run, accountId, "EUR", balances, entries, await listRules());
  await pairAllTransfers();
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
  priority?: number;
  account_id?: string | null;
  transaction_type?: string | null;
  transfer_account_id?: string | null;
}) {
  await createRule({
    name: details.pattern,
    mode: "keyword",
    category_id: "groceries",
    ...details
  });

  const created = (await listRules()).find(candidate => candidate.pattern === details.pattern && candidate.account_id === (details.account_id ?? null));

  assert.ok(created);

  return created;
}

test("a rule limited to an account decides only that account's bookings on syncs, and a later rule decides the others", async context => {
  const db = await isolatedDatabase(context);
  const savingsOnly = await rule({
    pattern: "INTEREST",
    priority: 10,
    account_id: "savings"
  });
  const everywhere = await rule({
    pattern: "INTEREST",
    priority: 20
  });

  await sync("savings", [entry("savings-interest", "2026-09-10", 120, "Interest")]);
  await sync("checking", [entry("checking-interest", "2026-09-10", 80, "Interest")]);

  assert.equal((await stored(db, "bank:savings-interest")).category_rule_id, savingsOnly.id);
  assert.equal((await stored(db, "bank:checking-interest")).category_rule_id, everywhere.id);
});

test("applying rules and the preview respect the account condition, also after it is edited", async context => {
  const db = await isolatedDatabase(context);

  await sync("savings", [entry("savings-fee", "2026-09-10", -300, "Account fee")]);
  await sync("checking", [entry("checking-fee", "2026-09-10", -200, "Account fee")]);

  const fee = await rule({
    pattern: "ACCOUNT FEE",
    account_id: "checking"
  });

  const preview = await previewRule({
    pattern: "ACCOUNT FEE",
    mode: "keyword",
    account_id: "savings"
  });

  assert.deepEqual([preview.matched, preview.transactions.map(transaction => transaction.amount_minor)], [1, [-300]]);
  await applyRulesToUncorrectedTransactions();
  assert.deepEqual([(await stored(db, "bank:checking-fee")).category_rule_id, (await stored(db, "bank:savings-fee")).category_rule_id], [fee.id, null]);

  await updateRuleDetails(fee.id, {
    name: fee.name,
    pattern: fee.pattern,
    mode: fee.mode,
    category_id: fee.category_id,
    account_id: ""
  });
  await applyRulesToUncorrectedTransactions();
  assert.deepEqual([(await stored(db, "bank:checking-fee")).category_rule_id, (await stored(db, "bank:savings-fee")).category_rule_id], [fee.id, fee.id]);
});

test("a transfer rule never turns a booking into a transfer to its own account", async context => {
  const db = await isolatedDatabase(context);

  await rule({
    pattern: "SAVINGS PLAN",
    transaction_type: "transfer",
    transfer_account_id: "savings"
  });
  await sync("savings", [entry("savings-in", "2026-09-02", 20000, "Savings plan")]);

  const incoming = await stored(db, "bank:savings-in");

  assert.deepEqual([incoming.type, incoming.type_transfer_account_id], ["transfer", null]);

  await sync("checking", [entry("plan", "2026-09-01", -20000, "Savings plan")]);

  const outgoing = await stored(db, "bank:plan");

  assert.equal(outgoing.type_transfer_account_id, "savings");
  assert.ok(outgoing.transfer_id);
  assert.equal((await stored(db, "bank:savings-in")).transfer_id, outgoing.transfer_id);
});

test("an archived account cannot become a rule's account condition, but an edited rule may keep it", async context => {
  const db = await isolatedDatabase(context);

  await assert.rejects(rule({
    pattern: "CLOSED FEE",
    account_id: "closed"
  }), ValidationError);

  const fee = await rule({
    pattern: "SAVINGS FEE",
    account_id: "savings"
  });
  const edit = {
    name: fee.name,
    pattern: fee.pattern,
    mode: fee.mode,
    category_id: fee.category_id
  };

  await assert.rejects(updateRuleDetails(fee.id, {
    ...edit,
    account_id: "closed"
  }), ValidationError);

  await db.update(schema.accounts).set({
    archived_at: "2026-09-15T00:00:00.000Z"
  }).where(eq(schema.accounts.id, "savings"));
  await updateRuleDetails(fee.id, {
    ...edit,
    name: "Renamed fee",
    account_id: "savings"
  });

  const [summary] = await listRuleSummaries();

  assert.deepEqual([summary.name, summary.account_id, summary.account_name], ["Renamed fee", "savings", "Synthetic savings"]);
});
