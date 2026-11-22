import { seedActor } from "./fixtures/auth";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { database, type Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { updateAccount } from "../src/features/accounts/server/account-service";
import { createManualAccount, updateManualValuation } from "../src/features/transactions/server/manual-account-service";
import { findManualAccount } from "../src/features/accounts/server/account-repository";
import { listAccounts } from "../src/features/accounts/server/account-queries";
import { enterManualTransaction } from "../src/features/transactions/server/transaction-service";
import { setTransactionCategory } from "../src/features/transactions/server/transaction-repository";
import { insertRule } from "../src/features/transactions/server/rule-application-service";
import { HttpError, ValidationError } from "../src/lib/errors";
import { createCategory, updateCategoryDetails } from "../src/features/categorization/server/categorization-service";
import { applyRulesToUncorrectedTransactions, createRule, updateRuleEnabled } from "../src/features/transactions/server/rule-application-service";
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

function syncRun(startedAt: string) {
  return {
    startedAt
  };
}

async function manualBalance(accountId: string) {
  const account = (await listAccounts()).find(item => item.id === accountId);

  return {
    amount: account?.balance_minor,
    date: account?.balance_date
  };
}

async function balanceBookings(db: Database, accountId: string) {
  const rows = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, accountId)).orderBy(schema.transactions.date);

  return rows.map(row => [row.date, row.type, row.amount_minor]);
}

test("account creation books exact money as the opening balance on the shared connection", async context => {
  const db = await isolatedDatabase(context);
  const created = await createManualAccount({
    name: "Synthetic savings",
    kind: "savings",
    currency: "EUR",
    balance: "123.45",
    date: "2026-01-02"
  });
  const raw = await db.$client.execute({
    sql: "SELECT balance_minor,provider FROM accounts WHERE id=?",
    args: [created.id]
  });
  const opening = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, created.id)).get();

  assert.equal(await database(), db);
  assert.deepEqual(await manualBalance(created.id), {
    amount: 12345,
    date: "2026-01-02"
  });
  assert.equal(raw.rows[0].balance_minor, null);
  assert.equal(raw.rows[0].provider, "manual");
  assert.equal(opening?.type, "opening_balance");
  assert.equal(opening?.provider_reference, `manual:${opening?.id}`);
  assert.equal((await db.select().from(schema.balanceSnapshots)).length, 0);
});

test("a new account's balance date starts its history, defaults to today in Vienna and cannot be in the future", async context => {
  const db = await isolatedDatabase(context);
  const viennaAfterMidnight = Temporal.Instant.from("2026-03-01T23:30:00Z");
  const property = {
    name: "Synthetic property",
    kind: "property",
    currency: "EUR",
    balance: "250000.00"
  };
  const dated = await createManualAccount({
    ...property,
    date: "2025-06-30"
  }, viennaAfterMidnight);
  const undated = await createManualAccount(property, viennaAfterMidnight);

  assert.deepEqual(await balanceBookings(db, dated.id), [["2025-06-30", "opening_balance", 25000000]]);
  assert.deepEqual(await balanceBookings(db, undated.id), [["2026-03-02", "opening_balance", 25000000]]);

  await assert.rejects(createManualAccount({
    ...property,
    date: "2026-03-03"
  }, viennaAfterMidnight), ValidationError);
  assert.equal((await db.select().from(schema.accounts)).length, 2);
  assert.equal((await db.select().from(schema.transactions)).length, 2);
});

test("invalid provider currencies and identities return provider failures without partial writes", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values({
    id: "synthetic-bank-account",
    name: "Synthetic account",
    kind: "checking",
    balance_minor: 10000
  });
  await assert.rejects(saveAccountSync(syncRun("2020-01-01T08:00:00.000Z"), "synthetic-bank-account", "EUR", [], [{
    reference: "bank:synthetic-reference",
    date: "2020-01-01",
    amount: 100,
    currency: "USD",
    counterparty: "Example counterparty",
    description: "Synthetic transfer"
  }], []), {
    status: 502
  });
  await assert.rejects(saveSessionAccounts("unused-connection", "Example institution", "2099-01-01T00:00:00Z", [{
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

test("a failed opening balance rolls back account creation instead of leaving a partial asset", async context => {
  const db = await isolatedDatabase(context);

  await db.$client.execute("CREATE TRIGGER fail_opening BEFORE INSERT ON transactions BEGIN SELECT RAISE(ABORT,'synthetic booking failure'); END");

  await assert.rejects(createManualAccount({
    name: "Synthetic asset",
    kind: "investment",
    currency: "EUR",
    balance: "10.00"
  }));
  assert.equal((await db.select().from(schema.accounts)).length, 0);
  assert.equal((await db.select().from(schema.transactions)).length, 0);
});

test("updating a balance books the difference to the balance on its date, so later transactions keep their effect", async context => {
  const db = await isolatedDatabase(context);
  const created = await createManualAccount({
    name: "Synthetic asset",
    kind: "investment",
    currency: "EUR",
    balance: "200.00",
    date: "2000-01-01"
  });

  await enterManualTransaction(created.id, {
    date: "2000-02-01",
    amount: "50.00",
    type: "transfer",
    transfer: null
  });
  // Back-dated: the balance on 15 January is 200, so 300 books +100 there and the later deposit still counts.
  await updateManualValuation(created.id, {
    balance: "300.00",
    date: "2000-01-15"
  });
  assert.deepEqual(await manualBalance(created.id), {
    amount: 35000,
    date: "2000-02-01"
  });

  // The current balance again books nothing.
  await updateManualValuation(created.id, {
    balance: "350.00",
    date: "2000-03-01"
  });
  await updateManualValuation(created.id, {
    balance: "320.00",
    date: "2000-03-01"
  });

  assert.deepEqual(await balanceBookings(db, created.id), [
    ["2000-01-01", "opening_balance", 20000],
    ["2000-01-15", "adjustment", 10000],
    ["2000-02-01", "transfer", 5000],
    ["2000-03-01", "adjustment", -3000]
  ]);
  assert.equal((await manualBalance(created.id)).amount, 32000);
});

test("a valuation dated today in Vienna is accepted before UTC reaches that day, and tomorrow is rejected", async context => {
  const db = await isolatedDatabase(context);
  const viennaAfterMidnight = Temporal.Instant.from("2026-03-01T23:30:00Z");
  const created = await createManualAccount({
    name: "Synthetic asset",
    kind: "investment",
    currency: "EUR",
    balance: "200.00",
    date: "2026-02-01"
  }, viennaAfterMidnight);

  await updateManualValuation(created.id, {
    balance: "250.00",
    date: "2026-03-02"
  }, viennaAfterMidnight);
  assert.deepEqual(await manualBalance(created.id), {
    amount: 25000,
    date: "2026-03-02"
  });

  await assert.rejects(updateManualValuation(created.id, {
    balance: "260.00",
    date: "2026-03-03"
  }, viennaAfterMidnight), ValidationError);
  assert.equal((await db.select().from(schema.transactions)).length, 2);
});

test("unknown records are not found, manual exclusions survive rule application and transfers are categorized by rules", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values([{
    id: "local",
    name: "Synthetic local account",
    kind: "checking"
  }]);
  await db.insert(schema.transactions).values([{
    id: "local-entry",
    account_id: "local",
    provider_reference: "synthetic-1",
    date: "2000-01-10",
    amount_minor: -100,
    currency: "EUR",
    type: "expense",
    counterparty: "Supermarket"
  }]);
  await insertRule({
    id: "groceries-rule",
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
    date: "2000-01-10",
    amount_minor: -300,
    currency: "EUR",
    type: "expense",
    counterparty: "Supermarket"
  }, {
    id: "transfer-entry",
    account_id: "local",
    provider_reference: "synthetic-4",
    date: "2000-01-10",
    amount_minor: -400,
    currency: "EUR",
    type: "transfer",
    counterparty: "Supermarket",
    category_id: null
  }]);

  assert.equal(await findManualAccount("unknown"), undefined);
  await assert.rejects(updateManualValuation("unknown", {
    balance: "1.00",
    date: "2000-01-10"
  }));
  assert.equal(await setTransactionCategory("unknown-entry", "groceries"), undefined);
  assert.deepEqual(await setTransactionCategory("local-entry", null), {
    id: "local-entry",
    category_id: null,
    category_source: "manual",
    category_rule_id: null
  });

  await applyRulesToUncorrectedTransactions();
  const corrected = await db.select().from(schema.transactions).where(eq(schema.transactions.id, "local-entry")).get();

  assert.equal(corrected?.category_id, null);
  assert.equal(corrected?.category_source, "manual");
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "automatic-entry")).get())?.category_id, "groceries");
  // A rule-assigned category on a transfer is recalculated like any other; the type stays a transfer.
  const transfer = await db.select().from(schema.transactions).where(eq(schema.transactions.id, "transfer-entry")).get();

  assert.deepEqual([transfer?.category_id, transfer?.type], ["groceries", "transfer"]);
  assert.equal((await db.select().from(schema.balanceSnapshots)).length, 0);
});

test("applying rules reports only transactions whose category changed", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values({
    id: "local",
    name: "Synthetic local account",
    kind: "checking"
  });
  await db.insert(schema.transactions).values(["one", "two", "three"].map((id, index) => ({
    id,
    account_id: "local",
    provider_reference: `synthetic-${id}`,
    date: "2000-01-10",
    amount_minor: -100,
    currency: "EUR",
    type: "expense" as const,
    counterparty: index === 2 ? "Unmatched" : "Supermarket",
    category_id: index === 0 ? "groceries" : null
  })));
  await insertRule({
    id: "groceries-rule",
    name: "Groceries",
    pattern: "Supermarket",
    mode: "keyword",
    category_id: "groceries",
    priority: 10,
    enabled: true
  });

  assert.deepEqual(await applyRulesToUncorrectedTransactions(), {
    updated: 1,
    retyped: 0
  });
  assert.deepEqual(await applyRulesToUncorrectedTransactions(), {
    updated: 0,
    retyped: 0
  });
});

test("rule toggling answers 404 for unknown ids and invalid patterns are validation errors", async context => {
  await isolatedDatabase(context);

  await assert.rejects(updateRuleEnabled("missing", {
    enabled: false
  }), error => error instanceof HttpError && error.status === 404);
  await assert.rejects(createRule({
    name: "Broken",
    pattern: "(?<=secret)test",
    mode: "regex",
    category_id: "groceries",
    priority: 1
  }), ValidationError);
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
    name: "Synthetic account",
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

  assert.equal(await saveAccountSync(syncRun("2000-01-10T08:00:00.000Z"), "bulk-account", "EUR", balances, entries, []), 125);
  const corrected = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, "bank:synthetic-120")).get();

  assert.ok(corrected);
  await setTransactionCategory(corrected.id, null);
  assert.equal(await saveAccountSync(syncRun("2000-01-10T09:00:00.000Z"), "bulk-account", "EUR", balances, entries, []), 0);
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
  await assert.rejects(saveAccountSync(syncRun("2000-01-10T10:00:00.000Z"), "bulk-account", "EUR", balances, changed, []));
  // The first sync also booked the account's opening balance.
  const stored = await db.select().from(schema.transactions).where(ne(schema.transactions.type, "opening_balance"));

  assert.equal(stored.length, 125);
  assert.ok(stored.every(entry => entry.amount_minor === -100));
  assert.equal((await listAccounts()).find(account => account.id === "bulk-account")?.balance_minor, 11111);
  assert.equal((await db.select().from(schema.balanceSnapshots)).length, 1);
});

test("ambiguous reauthorization rolls back earlier account mappings and added aliases", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.requisitions).values([{
    id: "old",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "LINKED"
  }, {
    id: "new",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "LINKED"
  }]);

  for (const id of ["first", "second", "third"]) {
    await db.insert(schema.accounts).values({
      id,
      name: "Synthetic account",
      kind: "checking",
      provider: "enable_banking",
      provider_uid: `old-${id}`,
      requisition_id: "old"
    });
    await db.insert(schema.accountIdentifiers).values({
      identification_hash: `hash-${id}`,
      account_id: id
    });
  }

  await assert.rejects(saveSessionAccounts("new", "Example institution", "2099-01-01T00:00:00Z", [{
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
    name: "Synthetic local account",
    kind: "checking"
  });
  await insertRule({
    id: "groceries-rule",
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
    date: "2000-01-10",
    amount_minor: -100,
    currency: "EUR",
    type: "expense",
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

  // Keys added to the curated set are accepted alongside the original ones.
  await createCategory({
    name: "Pet food",
    icon: "pets"
  });
  assert.equal(await categoryIcon("Pet food"), "pets");
  await updateCategoryDetails(String(dining?.id), {
    name: "Dining out",
    color: "#123456",
    icon: "coffee"
  });
  assert.equal(await categoryIcon("Dining out"), "coffee");

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


test("renaming changes only the account display name, allows duplicates and rejects invalid or unknown writes", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values([
    {
      id: "manual-name",
      name: "Before",
      kind: "checking"
    },
    {
      id: "bank-name",
      name: "Bank supplied",
      provider_name: "Bank supplied",
      kind: "checking",
      provider: "enable_banking",
      provider_uid: "stable-provider-id",
      iban: "synthetic-iban",
      balance_minor: 12345,
      balance_date: "2026-01-01"
    }
  ]);
  await db.insert(schema.transactions).values({
    id: "preserved-booking",
    account_id: "bank-name",
    provider_reference: "bank:stable",
    date: "2026-01-01",
    amount_minor: 1200,
    currency: "EUR",
    type: "income"
  });
  const before = await db.select().from(schema.accounts).where(eq(schema.accounts.id, "bank-name")).get();
  const bookings = await db.select().from(schema.transactions);

  await updateAccount("bank-name", {
    name: "  Everyday account  ",
    provider_uid: "ignored",
    balance_minor: 0
  });
  await updateAccount("manual-name", {
    name: "Everyday account"
  });
  assert.deepEqual(await db.select().from(schema.accounts).where(eq(schema.accounts.id, "bank-name")).get(), {
    ...before,
    name: "Everyday account"
  });
  assert.deepEqual(await db.select().from(schema.transactions), bookings);

  for (const name of ["", "   ", "x".repeat(101), null, 42]) {
    await assert.rejects(updateAccount("bank-name", {
      name
    }), ValidationError);
  }

  await assert.rejects(updateAccount("missing", {
    name: "Not allowed"
  }), {
    status: 404
  });
  assert.equal((await listAccounts()).filter(account => account.name === "Everyday account").length, 2);
});

test("a manual or imported account changes its type when its balance fits, while synced and archived accounts keep theirs", async context => {
  const db = await isolatedDatabase(context);
  const now = Temporal.Instant.from("2026-06-30T12:00:00Z");
  const { id: card } = await createManualAccount({
    name: "Card statement",
    kind: "checking",
    currency: "EUR",
    balance: "-350.00"
  }, now);
  const { id: wallet } = await createManualAccount({
    name: "Wallet",
    kind: "checking",
    currency: "EUR",
    balance: "80.00"
  }, now);

  await db.insert(schema.accounts).values([{
    id: "synced-type",
    name: "Bank account",
    kind: "checking",
    currency: "EUR",
    provider: "enable_banking",
    balance_minor: -500
  }, {
    id: "archived-type",
    name: "Old account",
    kind: "checking",
    currency: "EUR",
    archived_at: "2026-01-01T00:00:00Z"
  }]);
  const kindOf = async (id: string) => (await listAccounts()).find(account => account.id === id)?.kind;

  await updateAccount(card, {
    name: "Travel card",
    kind: "loan"
  });
  assert.equal(await kindOf(card), "loan");
  assert.equal((await listAccounts()).find(account => account.id === card)?.name, "Travel card");

  await updateAccount(card, {
    name: "Travel card",
    kind: "credit_card"
  });
  assert.equal(await kindOf(card), "credit_card");

  // A loan is debt still owed, so a positive balance does not fit it; the name stays unchanged with the refused type.
  await assert.rejects(updateAccount(wallet, {
    name: "Renamed wallet",
    kind: "loan"
  }), ValidationError);
  assert.equal(await kindOf(wallet), "checking");
  assert.equal((await listAccounts()).find(account => account.id === wallet)?.name, "Wallet");

  await assert.rejects(updateAccount("synced-type", {
    name: "Bank account",
    kind: "loan"
  }), {
    status: 409
  });
  await updateAccount("synced-type", {
    name: "Household",
    kind: "checking"
  });
  assert.equal(await kindOf("synced-type"), "checking");

  await assert.rejects(updateAccount("archived-type", {
    name: "Old account",
    kind: "savings"
  }), {
    status: 409
  });
  assert.equal(await kindOf("archived-type"), "checking");

  await assert.rejects(updateAccount(wallet, {
    name: "Wallet",
    kind: "pension"
  }), ValidationError);
});

test("sync and reconnect retain a custom account name while refreshing the separate provider label", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.requisitions).values([{
    id: "first-name",
    bank_name: "Bank",
    bank_country: "AT",
    status: "EXCHANGING"
  }, {
    id: "renewed-name",
    bank_name: "Bank",
    bank_country: "AT",
    status: "EXCHANGING"
  }]);
  await saveSessionAccounts("first-name", "Bank", "2099-01-01T00:00:00Z", [{
    uid: "old-uid",
    identification_hash: "stable-name-hash",
    currency: "EUR",
    name: "Original bank account"
  }]);
  const initial = (await listAccounts())[0];

  assert.equal(initial.provider_name, "Original bank account");
  await updateAccount(initial.id, {
    name: "My household account"
  });
  await saveAccountSync(syncRun("2026-01-01T10:00:00.000Z"), initial.id, "EUR", [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "125.00",
      currency: "EUR"
    },
    reference_date: "2026-01-01"
  }], [], []);
  assert.equal((await listAccounts())[0].name, "My household account");
  await saveSessionAccounts("renewed-name", "Bank", "2099-01-01T00:00:00Z", [{
    uid: "renewed-uid",
    identification_hash: "stable-name-hash",
    currency: "EUR",
    name: "Updated bank account"
  }]);
  const reconnected = (await listAccounts())[0];

  assert.equal(reconnected.id, initial.id);
  assert.equal(reconnected.name, "My household account");
  assert.equal(reconnected.provider_name, "Updated bank account");
  assert.equal(reconnected.balance_minor, 12500);
  assert.equal((await db.select().from(schema.accountIdentifiers))[0].account_id, initial.id);
});
