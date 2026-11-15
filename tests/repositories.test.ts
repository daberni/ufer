import { seedActor } from "./fixtures/auth";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { database, type Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { createManualAccount, updateManualValuation } from "../src/features/accounts/server/account-service";
import { findManualAccount } from "../src/features/accounts/server/account-repository";
import { setTransactionCategory } from "../src/features/transactions/server/transaction-repository";
import { insertRule } from "../src/features/categorization/server/rule-repository";
import { HttpError, ValidationError } from "../src/lib/errors";
import { applyRulesToUncorrectedTransactions, createCategory, updateCategoryDetails } from "../src/features/categorization/server/categorization-service";
import { insertAuthorization } from "../src/features/banking/server/connection-repository";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { saveSessionAccounts } from "../src/features/banking/server/bank-account-repository";
import type { Entry } from "../src/features/transactions/server/transaction-entry";
import { respond } from "../src/server/http/respond";

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

  return db;
}

test("account creation stores exact money and its initial snapshot on the shared connection", async context => {
  const db = await isolatedDatabase(context);
  const created = await createManualAccount({
    name: "Synthetic savings",
    institution: "Example institution",
    kind: "savings",
    currency: "EUR",
    balance: "123.45"
  });
  const account = await findManualAccount(created.id);
  const raw = await db.$client.execute({
    sql: "SELECT balance_minor,provider FROM accounts WHERE id=?",
    args: [created.id]
  });
  const snapshot = await db.select().from(schema.balanceSnapshots).where(eq(schema.balanceSnapshots.account_id, created.id)).get();

  assert.equal(await database(), db);
  assert.equal(account?.balance_minor, 12345);
  assert.equal(raw.rows[0].balance_minor, 12345);
  assert.equal(raw.rows[0].provider, "manual");
  assert.equal(snapshot?.amount_minor, 12345);
  assert.equal(snapshot?.source, "manual");
});

test("invalid provider currencies and identities return provider failures without partial writes", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values({
    id: "synthetic-bank-account",
    environment: "SANDBOX",
    name: "Synthetic account",
    institution: "Example institution",
    kind: "checking",
    balance_minor: 10000
  });
  await assert.rejects(saveAccountSync(db, "synthetic-bank-account", "EUR", [], [{
    reference: "bank:synthetic-reference",
    date: "2020-01-01",
    amount: 100,
    currency: "USD",
    counterparty: "Example counterparty",
    description: "Synthetic transfer"
  }], []), {
    status: 502
  });
  await assert.rejects(saveSessionAccounts(db, "SANDBOX", "unused-connection", "Example institution", [{
    uid: "synthetic-uid",
    identification_hash: "",
    currency: "EUR"
  }]), {
    status: 502
  });
  assert.equal((await db.select().from(schema.accounts)).length, 1);
  assert.equal((await db.select().from(schema.accounts).get())?.balance_minor, 10000);
  assert.equal((await db.select().from(schema.transactions)).length, 0);
  assert.equal((await db.select().from(schema.balanceSnapshots)).length, 0);
  assert.equal((await db.select().from(schema.accountIdentifiers)).length, 0);
});

test("a failed initial snapshot rolls back account creation instead of leaving a partial asset", async context => {
  const db = await isolatedDatabase(context);

  await db.$client.execute("CREATE TRIGGER fail_snapshot BEFORE INSERT ON balance_snapshots BEGIN SELECT RAISE(ABORT,'synthetic snapshot failure'); END");

  await assert.rejects(createManualAccount({
    name: "Synthetic asset",
    institution: "Example institution",
    kind: "investment",
    currency: "EUR",
    balance: "10.00"
  }));
  assert.equal((await db.select().from(schema.accounts)).length, 0);
  assert.equal((await db.select().from(schema.balanceSnapshots)).length, 0);
});

test("dated valuation upserts preserve snapshot identity and never replace a newer current balance", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values({
    id: "asset",
    environment: "SANDBOX",
    name: "Synthetic asset",
    institution: "Example institution",
    kind: "investment",
    balance_minor: 20000,
    balance_date: "2000-02-10"
  });
  await updateManualValuation("asset", {
    balance: "100.00",
    date: "2000-01-10"
  });
  assert.equal((await findManualAccount("asset"))?.balance_minor, 20000);
  const snapshot = await db.select().from(schema.balanceSnapshots).get();

  await updateManualValuation("asset", {
    balance: "110.00",
    date: "2000-01-10"
  });
  const revised = await db.select().from(schema.balanceSnapshots).get();

  assert.equal(revised?.id, snapshot?.id);
  assert.equal(revised?.amount_minor, 11000);
  assert.equal((await findManualAccount("asset"))?.balance_minor, 20000);

  await updateManualValuation("asset", {
    balance: "250.00",
    date: "2000-02-10"
  });
  assert.equal((await findManualAccount("asset"))?.balance_minor, 25000);
});

test("category corrections retain environment isolation and manual exclusions survive rule application", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values([{
    id: "local",
    environment: "SANDBOX",
    name: "Synthetic local account",
    institution: "Example institution",
    kind: "checking"
  }, {
    id: "other",
    environment: "PRODUCTION",
    name: "Synthetic other account",
    institution: "Example institution",
    kind: "checking"
  }]);
  await db.insert(schema.transactions).values([{
    id: "local-entry",
    account_id: "local",
    provider_reference: "synthetic-1",
    booking_date: "2000-01-10",
    amount_minor: -100,
    currency: "EUR",
    counterparty: "Supermarket"
  }, {
    id: "other-entry",
    account_id: "other",
    provider_reference: "synthetic-2",
    booking_date: "2000-01-10",
    amount_minor: -200,
    currency: "EUR",
    counterparty: "Supermarket"
  }]);
  await insertRule({
    name: "Groceries",
    pattern: "Supermarket",
    mode: "keyword",
    category_id: "groceries",
    priority: 10,
    enabled: true
  });
  await db.insert(schema.transactions).values([{
    id: "automatic-entry",
    account_id: "local",
    provider_reference: "synthetic-3",
    booking_date: "2000-01-10",
    amount_minor: -300,
    currency: "EUR",
    counterparty: "Supermarket"
  }, {
    id: "transfer-entry",
    account_id: "local",
    provider_reference: "synthetic-4",
    booking_date: "2000-01-10",
    amount_minor: -400,
    currency: "EUR",
    counterparty: "Supermarket",
    category_id: "transfer"
  }]);

  assert.equal(await findManualAccount("other"), undefined);
  await assert.rejects(updateManualValuation("other", {
    balance: "1.00",
    date: "2000-01-10"
  }));
  assert.equal(await setTransactionCategory("other-entry", "groceries"), false);
  assert.equal(await setTransactionCategory("local-entry", null), true);

  await applyRulesToUncorrectedTransactions();
  const corrected = await db.select().from(schema.transactions).where(eq(schema.transactions.id, "local-entry")).get();
  const other = await db.select().from(schema.transactions).where(eq(schema.transactions.id, "other-entry")).get();

  assert.equal(corrected?.category_id, null);
  assert.equal(corrected?.category_source, "manual");
  assert.equal(other?.category_id, null);
  assert.equal(other?.category_source, "rule");
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "automatic-entry")).get())?.category_id, "groceries");
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "transfer-entry")).get())?.category_id, "transfer");
  assert.equal((await db.select().from(schema.balanceSnapshots)).length, 0);
});

test("bank authorization uses real SQL defaults and preserves unique callback state", async context => {
  const db = await isolatedDatabase(context);
  const authorization = {
    id: "authorization",
    bank: "Example institution",
    country: "AT",
    stateHash: "synthetic-state-hash",
    browserHash: "synthetic-browser-hash",
    authorizationId: "synthetic-authorization",
    actor: await seedActor(db)
  };

  await insertAuthorization(authorization);
  const stored = await db.select().from(schema.requisitions).get();

  assert.equal(stored?.status, "PENDING");
  assert.ok(stored?.created_at && Number.isFinite(Date.parse(stored.created_at)));
  await assert.rejects(insertAuthorization({
    ...authorization,
    id: "repeated-state"
  }));
  assert.equal((await db.select().from(schema.requisitions)).length, 1);
});

test("multi-chunk sync remains idempotent and rolls back every chunk when a later write fails", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values({
    id: "bulk-account",
    environment: "SANDBOX",
    name: "Synthetic account",
    institution: "Example institution",
    kind: "checking"
  });
  const entries: Entry[] = Array.from({
    length: 125
  }, (_, index) => ({
    reference: `bank:synthetic-${index}`,
    date: "2000-01-10",
    amount: -100,
    currency: "EUR",
    counterparty: "Example payee",
    description: "Synthetic purchase"
  }));
  const balances = [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "111.11",
      currency: "EUR"
    },
    reference_date: "2000-01-10"
  }];

  assert.equal(await saveAccountSync(db, "bulk-account", "EUR", balances, entries, []), 125);
  const corrected = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, "bank:synthetic-120")).get();

  assert.ok(corrected);
  await setTransactionCategory(corrected.id, null);
  assert.equal(await saveAccountSync(db, "bulk-account", "EUR", balances, entries, []), 0);
  const preserved = await db.select().from(schema.transactions).where(eq(schema.transactions.id, corrected.id)).get();

  assert.equal(preserved?.category_source, "manual");
  assert.equal(preserved?.category_id, null);
  await db.$client.execute("CREATE TRIGGER fail_late_transaction BEFORE INSERT ON transactions WHEN NEW.provider_reference='bank:broken' BEGIN SELECT RAISE(ABORT,'synthetic late write failure'); END");
  const changed = entries.map(entry => ({
    ...entry,
    amount: -900
  }));

  changed.push({
    ...entries[0],
    reference: "bank:broken"
  });
  await assert.rejects(saveAccountSync(db, "bulk-account", "EUR", balances, changed, []));
  const stored = await db.select().from(schema.transactions);

  assert.equal(stored.length, 125);
  assert.ok(stored.every(entry => entry.amount_minor === -100));
  assert.equal((await findManualAccount("bulk-account"))?.balance_minor, 11111);
  assert.equal((await db.select().from(schema.balanceSnapshots)).length, 1);
});

test("ambiguous reauthorization rolls back earlier account mappings and added aliases", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.requisitions).values([{
    id: "old",
    environment: "SANDBOX",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "LINKED"
  }, {
    id: "new",
    environment: "SANDBOX",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "LINKED"
  }]);

  for (const id of ["first", "second", "third"]) {
    await db.insert(schema.accounts).values({
      id,
      environment: "SANDBOX",
      name: "Synthetic account",
      institution: "Example institution",
      kind: "checking",
      provider: "enable_banking",
      provider_uid: `old-${id}`,
      requisition_id: "old"
    });
    await db.insert(schema.accountIdentifiers).values({
      environment: "SANDBOX",
      identification_hash: `hash-${id}`,
      account_id: id
    });
  }

  await assert.rejects(saveSessionAccounts(db, "SANDBOX", "new", "Example institution", [{
    uid: "new-first",
    identification_hash: "hash-first",
    identification_hashes: ["new-alias"],
    currency: "EUR"
  }, {
    uid: "ambiguous",
    identification_hash: "hash-second",
    identification_hashes: ["hash-third"],
    currency: "EUR"
  }]), /multiple existing accounts/);
  const first = await db.select().from(schema.accounts).where(eq(schema.accounts.id, "first")).get();

  assert.equal(first?.provider_uid, "old-first");
  assert.equal(first?.requisition_id, "old");
  assert.equal((await db.select().from(schema.accountIdentifiers)).length, 3);
  assert.equal((await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "old")).get())?.status, "LINKED");
});

test("category edits keep transaction assignments and rules attached and reject conflicting names", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values({
    id: "local",
    environment: "SANDBOX",
    name: "Synthetic local account",
    institution: "Example institution",
    kind: "checking"
  });
  await insertRule({
    name: "Groceries",
    pattern: "Supermarket",
    mode: "keyword",
    category_id: "groceries",
    priority: 10,
    enabled: true
  });
  await db.insert(schema.transactions).values({
    id: "assigned-entry",
    account_id: "local",
    provider_reference: "synthetic-1",
    booking_date: "2000-01-10",
    amount_minor: -100,
    currency: "EUR",
    counterparty: "Supermarket",
    category_id: "groceries",
    category_source: "manual"
  });

  await updateCategoryDetails("groceries", {
    name: "  Food  ",
    color: "#ABCDEF",
    icon: null
  });

  const category = await db.select().from(schema.categories).where(eq(schema.categories.id, "groceries")).get();
  const transaction = await db.select().from(schema.transactions).where(eq(schema.transactions.id, "assigned-entry")).get();
  const rule = await db.select().from(schema.categorizationRules).get();

  assert.equal(category?.name, "Food");
  assert.equal(category?.color, "#abcdef");
  assert.equal(transaction?.category_id, "groceries");
  assert.equal(rule?.category_id, "groceries");

  await updateCategoryDetails("groceries", {
    name: "FOOD",
    color: "#abcdef",
    icon: null
  });
  await assert.rejects(updateCategoryDetails("groceries", {
    name: "housing",
    color: "#abcdef",
    icon: null
  }), new ValidationError("A category with this name already exists."));
  await assert.rejects(createCategory({
    name: "TRANSPORT"
  }), ValidationError);
  await createCategory({
    name: "Épargne"
  });
  await assert.rejects(createCategory({
    name: "épargne"
  }), ValidationError);
  await assert.rejects(createCategory({
    name: "ÉPARGNE"
  }), ValidationError);
  const overlapping = await Promise.allSettled([createCategory({
    name: "Savings"
  }), createCategory({
    name: "SAVINGS"
  })]);

  assert.deepEqual(overlapping.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal((await db.select().from(schema.categories)).filter(row => row.name.toLowerCase() === "savings").length, 1);
  await assert.rejects(updateCategoryDetails("missing", {
    name: "Anything",
    color: "#abcdef",
    icon: null
  }), error => error instanceof HttpError && error.status === 404);
  await assert.rejects(updateCategoryDetails("groceries", {
    name: "Food",
    color: "green",
    icon: null
  }));
});

test("category icons persist through create and edit and only accept the curated keys", async context => {
  const db = await isolatedDatabase(context);
  const categoryIcon = async (name: string) => (await db.select().from(schema.categories).where(eq(schema.categories.name, name)).get())?.icon;

  await createCategory({
    name: "Dining out",
    color: "#123456",
    icon: "dining"
  });
  await createCategory({
    name: "Without icon",
    icon: ""
  });
  await createCategory({
    name: "Icon omitted"
  });

  assert.equal(await categoryIcon("Dining out"), "dining");
  assert.equal(await categoryIcon("Without icon"), null);
  assert.equal(await categoryIcon("Icon omitted"), null);
  assert.equal(await categoryIcon("Groceries"), null);

  const dining = await db.select().from(schema.categories).where(eq(schema.categories.name, "Dining out")).get();

  await updateCategoryDetails(String(dining?.id), {
    name: "Dining out",
    color: "#123456",
    icon: "travel"
  });
  assert.equal(await categoryIcon("Dining out"), "travel");

  await updateCategoryDetails(String(dining?.id), {
    name: "Dining out",
    color: "#123456",
    icon: ""
  });
  assert.equal(await categoryIcon("Dining out"), null);

  for (const icon of ["unknown", "Dining", "toString", "__proto__", "<svg></svg>"]) {
    await assert.rejects(createCategory({
      name: "Rejected",
      icon
    }), new ValidationError("Choose one of the available category icons."));
    await assert.rejects(updateCategoryDetails("groceries", {
      name: "Groceries",
      color: "#488a75",
      icon
    }), ValidationError);
  }

  assert.equal(await categoryIcon("Rejected"), undefined);
  assert.equal(await categoryIcon("Groceries"), null);

  context.mock.method(console, "warn", () => {});
  const response = await respond(new Request("http://localhost/api/categories"), async () => createCategory({
    name: "Rejected",
    icon: "unknown"
  }), {
    access: "public"
  });

  assert.equal(response.status, 422);
  assert.equal((await response.json()).detail, "Choose one of the available category icons.");
});
