import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient, type InArgs, type InStatement } from "@libsql/client";
import { act, fireEvent, render, within } from "@testing-library/react";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createElement, Fragment, type ReactNode } from "react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AppStoreProvider } from "../src/client/app-store";
import { Temporal } from "temporal-polyfill";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { allMonthsPeriod } from "../src/lib/period";
import { readSyncRunTransactionPage } from "../src/features/banking/server/banking-queries";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { ValidationError } from "../src/lib/errors";
import { listAccounts, readBalanceHistory, readNetWorth } from "../src/features/accounts/server/account-queries";
import { archiveAccount, restoreAccount, updateManualValuation } from "../src/features/accounts/server/account-service";
import { editManualTransaction, enterManualTransaction, hideTransaction, removeManualTransaction, transferOptions, updateTransactionCategory, updateTransactionDetails } from "../src/features/transactions/server/transaction-service";
import { deleteCategory } from "../src/features/categorization/server/categorization-service";
import { applyRulesToUncorrectedTransactions, createRule, updateRuleDetails } from "../src/features/transactions/server/rule-application-service";
import { splitTransaction, unsplitTransaction } from "../src/features/transactions/server/split-service";
import { pairAllTransfers } from "../src/features/transactions/server/transfer-pairing-repository";
import { acquireLease } from "../src/server/jobs/lease-repository";
import { removeConnection } from "../src/features/banking/server/connection-repository";
import { queryKeys } from "../src/client/query-keys";
import { readAccountCashFlow, readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { accountGroups, showsCurrencySelect } from "../src/features/accounts/queries";
import { showsSync } from "../src/features/dashboard/sync-visibility";
import type { Account } from "../src/features/accounts/types";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { chooseMenuItem } from "./fixtures/action-menu";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

async function seededDatabase(context: TestContext) {
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
    id: "closed",
    name: "Synthetic closed account",
    kind: "checking"
  }, {
    id: "open",
    name: "Synthetic open account",
    kind: "savings"
  }, {
    id: "target",
    name: "Synthetic target account",
    kind: "checking"
  }, {
    id: "dollars",
    name: "Synthetic dollar account",
    kind: "checking",
    currency: "USD"
  }, {
    id: "bank",
    name: "Synthetic bank account",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: "uid-bank"
  }]);
  await db.insert(schema.transactions).values([{
    id: "opening",
    account_id: "closed",
    provider_reference: "manual:opening",
    date: "2026-01-01",
    amount_minor: 100000,
    currency: "EUR",
    type: "opening_balance"
  }, {
    id: "salary",
    account_id: "closed",
    provider_reference: "manual:salary",
    date: "2026-01-05",
    amount_minor: 250000,
    currency: "EUR",
    type: "income"
  }, {
    id: "groceries",
    account_id: "closed",
    provider_reference: "manual:groceries",
    date: "2026-01-06",
    amount_minor: -4000,
    currency: "EUR",
    category_id: "groceries",
    type: "expense"
  }, {
    id: "savings",
    account_id: "open",
    provider_reference: "manual:savings",
    date: "2026-01-02",
    amount_minor: 50000,
    currency: "EUR",
    type: "opening_balance"
  }, {
    id: "settled",
    account_id: "closed",
    provider_reference: "manual:settled",
    date: "2026-01-20",
    amount_minor: -346000,
    currency: "EUR",
    type: "adjustment"
  }, {
    id: "bank-opening",
    account_id: "bank",
    provider_reference: "manual:bank-opening",
    date: "2026-01-31",
    amount_minor: 7000,
    currency: "EUR",
    type: "opening_balance"
  }]);

  return db;
}

async function reports() {
  const period = allMonthsPeriod;

  return {
    cashFlow: await readCashFlow(period, "EUR"),
    accountCashFlow: await readAccountCashFlow("closed", period),
    netWorth: await readNetWorth("EUR"),
    history: await readBalanceHistory("closed")
  };
}

test("archiving hides an account from lists while its history and every report stay unchanged, and restoring shows it again", async context => {
  await seededDatabase(context);
  const before = await reports();

  assert.deepEqual(await archiveAccount("closed", {}), {
    ok: true
  });
  const archived = await listAccounts();
  const closed = archived.find(account => account.id === "closed");

  assert.ok(closed?.archived_at);
  assert.equal(closed.balance_minor, 0);
  assert.deepEqual(await reports(), before);

  const groups = accountGroups(archived as Account[], "EUR");

  assert.equal(groups.currencyAccounts.some(account => account.id === "closed"), false);
  assert.equal(groups.manualAccounts.some(account => account.id === "closed"), false);

  await restoreAccount("closed");
  assert.equal((await listAccounts()).find(account => account.id === "closed")?.archived_at, null);
  assert.ok(accountGroups(await listAccounts() as Account[], "EUR").currencyAccounts.some(account => account.id === "closed"));
  assert.deepEqual(await reports(), before);
});

test("an archived account rejects balance updates, manual entries and CSV imports until it is restored", async context => {
  const db = await seededDatabase(context);

  await archiveAccount("closed", {});
  const bookingsBefore = await db.select().from(schema.transactions);
  const archived = {
    status: 409,
    message: "This account is archived. Restore the account first."
  };

  await assert.rejects(updateManualValuation("closed", {
    balance: "10.00",
    date: "2026-01-10"
  }), archived);
  await assert.rejects(enterManualTransaction("closed", {
    amount: "-5.00",
    date: "2026-01-10",
    type: "expense"
  }), archived);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);

  await restoreAccount("closed");
  await updateManualValuation("closed", {
    balance: "10.00",
    date: "2026-01-10"
  });
  assert.equal((await db.select().from(schema.transactions)).length, bookingsBefore.length + 1);
});

test("bookings on an archived account cannot be edited, deleted or linked, and are not offered as link candidates", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.transactions).values({
    id: "refund",
    account_id: "target",
    provider_reference: "manual:refund",
    date: "2026-01-06",
    amount_minor: 4000,
    currency: "EUR",
    type: "income"
  });
  const candidates = async () => (await transferOptions("refund")).candidates.map(candidate => candidate.id);

  assert.deepEqual(await candidates(), ["groceries"]);
  await archiveAccount("closed", {});
  const bookingsBefore = await db.select().from(schema.transactions);
  const archived = {
    status: 409,
    message: "This account is archived. Restore the account first."
  };

  await assert.rejects(editManualTransaction("salary", {
    type: "income",
    date: "2026-01-05",
    amount: "1.00"
  }), archived);
  await assert.rejects(removeManualTransaction("salary"), archived);
  await assert.rejects(updateTransactionDetails("groceries", {
    type: "transfer",
    transfer: {
      counterpart_id: "refund"
    }
  }), archived);
  assert.deepEqual(await candidates(), []);
  // The list keeps the entry state and marks the account archived, which freezes entry editing and deletion in the dialog.
  const page = await readSyncRunTransactionPage(dashboardFilters(new URLSearchParams({
    period: "2026-01"
  })));
  const salary = page.transactions.find(item => item.id === "salary");

  assert.equal(salary?.entered, true);
  assert.equal(salary?.account_archived, true);
  assert.equal(page.transactions.find(item => item.id === "refund")?.entered, true);
  await assert.rejects(updateTransactionDetails("refund", {
    type: "transfer",
    transfer: {
      counterpart_id: "groceries"
    }
  }), ValidationError);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);

  await restoreAccount("closed");
  await removeManualTransaction("salary");
  assert.equal((await db.select().from(schema.transactions)).length, bookingsBefore.length - 1);
});

async function archivedImports(db: Database) {
  // Two imported bookings that cancel out, so the account can be archived at a balance of 0.
  await db.insert(schema.transactions).values([{
    id: "shop",
    account_id: "closed",
    provider_reference: "csv:shop",
    date: "2026-01-07",
    amount_minor: -1500,
    currency: "EUR",
    counterparty: "Synthetic shop",
    type: "expense"
  }, {
    id: "shop-refund",
    account_id: "closed",
    provider_reference: "csv:shop-refund",
    date: "2026-01-08",
    amount_minor: 1500,
    currency: "EUR",
    counterparty: "Synthetic shop refund",
    type: "income",
    category_id: "leisure",
    category_source: "manual"
  }]);
  await archiveAccount("closed", {});
}

async function balances() {
  return {
    accounts: (await listAccounts()).map(account => [account.id, account.balance_minor]),
    netWorth: await readNetWorth("EUR"),
    history: await readBalanceHistory("closed")
  };
}

function typesOf(rows: (typeof schema.transactions.$inferSelect)[]) {
  return rows.map(row => [row.id, row.type, row.type_source, row.type_rule_id, row.transfer_id, row.suppressed_at, row.amount_minor, row.date]);
}

test("categories, splits and payee and description overrides of an archived account's bookings change and reach the reports, while balances stay", async context => {
  const db = await seededDatabase(context);

  await archivedImports(db);
  const balancesBefore = await balances();
  const typesBefore = typesOf(await db.select().from(schema.transactions));

  assert.equal((await updateTransactionCategory("shop", {
    category_id: "groceries"
  }))?.category_id, "groceries");
  assert.equal((await readCashFlow(allMonthsPeriod, "EUR")).expenseBreakdown.find(item => item.categoryId === "groceries")?.amount, 5500);

  await updateTransactionDetails("shop", {
    type: "expense",
    counterparty: "Synthetic corner shop",
    description: "Synthetic snacks"
  });
  const listed = (await readSyncRunTransactionPage(dashboardFilters(new URLSearchParams({
    period: "2026-01"
  })))).transactions.find(item => item.id === "shop");

  assert.equal(listed?.counterparty, "Synthetic corner shop");
  assert.equal(listed?.description, "Synthetic snacks");

  await splitTransaction("shop", {
    parts: [{
      amount: "-10.00",
      category_id: "groceries",
      note: ""
    }, {
      amount: "-5.00",
      category_id: "leisure",
      note: ""
    }]
  });
  assert.equal((await readCashFlow(allMonthsPeriod, "EUR")).expenseBreakdown.find(item => item.categoryId === "leisure")?.amount, 500);
  await unsplitTransaction("shop");
  assert.equal((await db.select().from(schema.transactionSplits)).length, 0);

  // Returning a manual category to the rules assigns only the category.
  await db.insert(schema.categorizationRules).values({
    id: "refund-rule",
    name: "Synthetic refund",
    pattern: "Synthetic shop refund",
    mode: "keyword",
    category_id: "groceries",
    transaction_type: "transfer"
  });
  assert.equal((await updateTransactionCategory("shop-refund", {
    automatic: true
  }))?.category_rule_id, "refund-rule");

  assert.deepEqual(await balances(), balancesBefore);
  assert.deepEqual(typesOf(await db.select().from(schema.transactions)), typesBefore);
});

test("rules categorize bookings on an archived account when applied, created or edited, without changing their type", async context => {
  const db = await seededDatabase(context);

  await archivedImports(db);
  await db.update(schema.transactions).set({
    category_id: null,
    category_source: "rule"
  }).where(eq(schema.transactions.id, "shop-refund"));
  await db.insert(schema.categorizationRules).values({
    id: "shop-rule",
    name: "Synthetic shop",
    pattern: "Synthetic shop",
    mode: "keyword",
    category_id: "groceries",
    transaction_type: "transfer"
  });
  const balancesBefore = await balances();
  const typesBefore = typesOf(await db.select().from(schema.transactions));
  const category = async (id: string) => {
    const row = await db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get();

    return `${row?.category_id ?? "none"}/${row?.category_source}/${row?.category_rule_id ?? "none"}`;
  };

  await applyRulesToUncorrectedTransactions();
  assert.equal(await category("shop"), "groceries/rule/shop-rule");

  assert.equal(await category("shop-refund"), "groceries/rule/shop-rule");

  // Creating a rule applies it to uncategorized bookings and adopts chosen manual ones on archived accounts too.
  await db.update(schema.transactions).set({
    category_id: null,
    category_rule_id: null
  }).where(eq(schema.transactions.id, "shop-refund"));
  await db.update(schema.transactions).set({
    category_id: "leisure",
    category_source: "manual",
    category_rule_id: null
  }).where(eq(schema.transactions.id, "shop"));
  await createRule({
    name: "Synthetic refund",
    pattern: "Synthetic shop refund",
    mode: "keyword",
    category_id: "leisure",
    priority: 1,
    transaction_type: "transfer",
    apply_to_uncategorized: true
  });
  assert.match(await category("shop-refund"), /^leisure\/rule\/[0-9a-f-]{36}$/);
  await updateRuleDetails("shop-rule", {
    name: "Synthetic shop",
    pattern: "Synthetic shop",
    mode: "keyword",
    category_id: "groceries",
    transaction_type: "transfer",
    adopt_manual: true
  });
  assert.equal(await category("shop"), "groceries/rule/shop-rule");

  assert.deepEqual(await balances(), balancesBefore);
  assert.deepEqual(typesOf(await db.select().from(schema.transactions)), typesBefore);
});

test("an imported booking on an archived account links with and unlinks from existing bookings, but no counterpart is created", async context => {
  const db = await seededDatabase(context);

  await archivedImports(db);
  await db.insert(schema.transactions).values({
    id: "card-payment",
    account_id: "target",
    provider_reference: "csv:card-payment",
    date: "2026-01-08",
    amount_minor: 1500,
    currency: "EUR",
    type: "income"
  });
  await db.insert(schema.transactions).values({
    id: "entered-payment",
    account_id: "open",
    provider_reference: "manual:entered-payment",
    date: "2026-01-09",
    amount_minor: 1500,
    currency: "EUR",
    type: "income"
  });
  const balancesBefore = await balances();
  const archived = {
    status: 409,
    message: "This account is archived. Restore the account first."
  };
  const linked = async () => (await db.select().from(schema.transactions).where(eq(schema.transactions.id, "shop")).get())?.transfer_id;

  const enteredBefore = await db.select().from(schema.transactions).where(eq(schema.transactions.id, "entered-payment")).get();

  // An entered booking on an active account would follow the imported booking's date, so it is neither offered nor accepted.
  assert.deepEqual((await transferOptions("shop")).candidates.map(candidate => candidate.id), ["card-payment"]);
  await assert.rejects(updateTransactionDetails("shop", {
    type: "transfer",
    transfer: {
      counterpart_id: "entered-payment"
    }
  }), archived);
  assert.deepEqual(await db.select().from(schema.transactions).where(eq(schema.transactions.id, "entered-payment")).get(), enteredBefore);
  await assert.rejects(updateTransactionDetails("shop", {
    type: "transfer",
    transfer: {
      account_id: "open"
    }
  }), archived);
  await assert.rejects(updateTransactionDetails("shop", {
    type: "transfer"
  }), archived);

  await updateTransactionDetails("shop", {
    type: "transfer",
    transfer: {
      counterpart_id: "card-payment"
    }
  });
  assert.ok(await linked());
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "card-payment")).get())?.type, "transfer");

  await assert.rejects(updateTransactionDetails("shop", {
    type: "income"
  }), archived);
  await updateTransactionDetails("shop", {
    type: "expense"
  });
  assert.equal(await linked(), null);
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "card-payment")).get())?.type, "income");
  assert.equal((await db.select().from(schema.transactions)).length, 10);
  assert.deepEqual(await balances(), balancesBefore);
});

test("automatic pairing never links a booking on an archived account", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.transactions).values([{
    id: "outgoing",
    account_id: "closed",
    provider_reference: "csv:outgoing",
    date: "2026-01-08",
    amount_minor: -2500,
    currency: "EUR",
    type: "transfer"
  }, {
    id: "incoming",
    account_id: "target",
    provider_reference: "csv:incoming",
    date: "2026-01-08",
    amount_minor: 2500,
    currency: "EUR",
    type: "income"
  }]);
  await archiveAccount("closed", {
    closing: {
      date: "2026-01-31",
      balance_minor: -2500
    }
  });
  const bookingsBefore = await db.select().from(schema.transactions);

  assert.equal(await pairAllTransfers(), 0);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);

  await restoreAccount("closed");
  assert.equal(await pairAllTransfers(), 1);
});

test("changing a booking linked to a counterpart on an archived account is refused before the counterpart changes", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.transactions).values({
    id: "imported",
    account_id: "bank",
    provider_reference: "bank:imported",
    date: "2026-01-08",
    amount_minor: -2500,
    currency: "EUR",
    type: "expense"
  });
  await updateTransactionDetails("imported", {
    type: "transfer",
    transfer: {
      account_id: "closed"
    }
  });
  const counterpart = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, "transfer:imported")).get();

  assert.equal(counterpart?.account_id, "closed");
  await archiveAccount("closed", {
    closing: {
      date: "2026-01-31",
      balance_minor: 2500
    }
  });
  const bookingsBefore = await db.select().from(schema.transactions);

  await assert.rejects(updateTransactionDetails("imported", {
    type: "expense"
  }), {
    status: 409
  });
  const listed = (await readSyncRunTransactionPage(dashboardFilters(new URLSearchParams({
    period: "2026-01"
  })))).transactions.find(item => item.id === "imported");

  assert.equal(listed?.account_archived, false);
  assert.equal(listed?.counterpart_archived, true);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);
});

test("an account archived after the request's check but before the write receives no entry or balance", async context => {
  const db = await seededDatabase(context);
  const execute = db.$client.execute.bind(db.$client);
  let archiveNext = false;
  let interleaved = 0;

  context.mock.method(db.$client, "execute", async (statement: InStatement, args?: InArgs) => {
    const result = typeof statement === "string" ? await execute(statement, args) : await execute(statement);
    const text = typeof statement === "string" ? statement : statement.sql;

    if (archiveNext && /^select /i.test(text) && text.includes('from "accounts"')) {
      archiveNext = false;
      interleaved++;
      await execute("UPDATE accounts SET archived_at='2026-11-01T00:00:00.000Z' WHERE id='open'");
    }

    return result;
  });
  const bookingsBefore = await db.select().from(schema.transactions);
  const archived = {
    status: 409,
    message: "This account is archived. Restore the account first."
  };

  archiveNext = true;
  await assert.rejects(enterManualTransaction("open", {
    amount: "-5.00",
    date: "2026-01-10",
    type: "expense"
  }), archived);
  await db.update(schema.accounts).set({
    archived_at: null
  }).where(eq(schema.accounts.id, "open"));
  archiveNext = true;
  await assert.rejects(updateManualValuation("open", {
    balance: "10.00",
    date: "2026-01-10"
  }), archived);
  assert.equal(interleaved, 2);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);
});

test("an archived account's bookings keep their type, link and, where it counts toward a balance, their visibility", async context => {
  const db = await seededDatabase(context);

  await archivedImports(db);
  await db.insert(schema.transactions).values({
    id: "bank-fee",
    account_id: "bank",
    provider_reference: "bank:fee",
    date: "2026-01-09",
    amount_minor: -300,
    currency: "EUR",
    counterparty: "Example bank",
    type: "expense"
  });
  await db.update(schema.accounts).set({
    archived_at: "2026-02-01T00:00:00.000Z"
  }).where(eq(schema.accounts.id, "bank"));
  const balancesBefore = await balances();
  const archived = {
    status: 409,
    message: "This account is archived. Restore the account first."
  };

  await assert.rejects(updateTransactionDetails("shop", {
    type: "income"
  }), archived);
  await assert.rejects(updateTransactionDetails("shop", {
    type: "transfer",
    transfer: {
      account_id: "target"
    }
  }), archived);
  // A manual account's balance sums its shown bookings, so hiding one would change it.
  await assert.rejects(hideTransaction("shop", true), archived);
  await assert.rejects(splitTransaction("salary", {
    parts: [{
      amount: "1.00",
      category_id: null,
      note: ""
    }]
  }), ValidationError);
  assert.deepEqual(await balances(), balancesBefore);

  // A bank account's balance is the sum of its shown bookings too, so their visibility is frozen as well.
  await assert.rejects(hideTransaction("bank-fee", true), archived);
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "bank-fee")).get())?.suppressed_at, null);
  assert.deepEqual(await balances(), balancesBefore);
});

test("archiving uses the displayed balance, which leaves hidden bookings out", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.transactions).values([{
    id: "hidden-target",
    account_id: "target",
    provider_reference: "csv:hidden-target",
    date: "2026-01-04",
    amount_minor: 900,
    currency: "EUR",
    type: "income",
    suppressed_at: "2026-01-05T00:00:00.000Z"
  }, {
    id: "hidden-open",
    account_id: "open",
    provider_reference: "csv:hidden-open",
    date: "2026-01-04",
    amount_minor: 900,
    currency: "EUR",
    type: "income",
    suppressed_at: "2026-01-05T00:00:00.000Z"
  }]);
  const listed = await listAccounts();

  assert.equal(listed.find(account => account.id === "target")?.balance_minor ?? 0, 0);
  assert.equal(listed.find(account => account.id === "open")?.balance_minor, 50000);

  await archiveAccount("target", {});
  await archiveAccount("open", {
    closing: {
      date: "2026-01-15",
      balance_minor: 50000
    }
  });
  const archived = await listAccounts();

  assert.ok(archived.find(account => account.id === "target")?.archived_at);
  assert.ok(archived.find(account => account.id === "open")?.archived_at);
  assert.equal(archived.find(account => account.id === "open")?.balance_minor, 0);
});

test("deleting a category also reassigns bookings on archived accounts, leaving no deleted category behind", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.categories).values({
    id: "replacement",
    name: "Synthetic replacement",
    color: "#3f8f5a"
  });
  await archiveAccount("closed", {});
  await deleteCategory("groceries", {
    replacement_id: "replacement"
  });
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "groceries")).get())?.category_id, "replacement");
});

test("a currency choice is offered only when accounts use several currencies or none uses the selected one", () => {
  const currenciesFor = (currencies: string[], selected: string) => accountGroups(currencies.map(currency => ({
    ...manualAccount,
    currency
  })), selected).currencies;

  assert.deepEqual(currenciesFor(["USD", "USD"], "USD"), ["USD"]);
  assert.equal(showsCurrencySelect(currenciesFor(["USD"], "USD")), false);
  assert.equal(showsCurrencySelect(currenciesFor([], "EUR")), false);
  assert.deepEqual(currenciesFor(["USD"], "EUR"), ["EUR", "USD"]);
  assert.deepEqual(currenciesFor(["USD", "EUR", "CHF"], "EUR"), ["CHF", "EUR", "USD"]);
  assert.equal(showsCurrencySelect(currenciesFor(["USD", "EUR"], "EUR")), true);
});

test("a currency whose accounts are all archived still reports its figures on the overview", () => {
  const archivedOnly = accountGroups([{
    ...manualAccount,
    currency: "USD",
    archived_at: "2026-11-01T00:00:00.000Z"
  }], "USD");

  assert.deepEqual(archivedOnly.currencyAccounts, []);
  assert.equal(archivedOnly.reportedAccounts.length, 1);
});

test("archiving an account whose balance is not 0 is refused without changes", async context => {
  const db = await seededDatabase(context);
  const bookingsBefore = await db.select().from(schema.transactions);
  const refused = {
    status: 409,
    message: "Bring the balance to 0 before archiving."
  };

  await assert.rejects(archiveAccount("open", {}), refused);
  // A bank-linked balance comes from the bank and cannot be booked away.
  await assert.rejects(archiveAccount("bank", {
    closing: {
      date: "2026-02-01",
      balance_minor: 7000
    }
  }), refused);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);
  assert.equal((await listAccounts()).filter(account => account.archived_at).length, 0);

  await db.delete(schema.transactions).where(eq(schema.transactions.account_id, "bank"));
  await archiveAccount("bank", {});
  assert.ok((await listAccounts()).find(account => account.id === "bank")?.archived_at);
});

test("closing a manual account books its balance away as an adjustment on the chosen date and archives it", async context => {
  const db = await seededDatabase(context);
  const cashFlowBefore = await readCashFlow(allMonthsPeriod, "EUR");

  await archiveAccount("open", {
    closing: {
      date: "2026-01-15",
      balance_minor: 50000
    }
  });
  const open = (await listAccounts()).find(account => account.id === "open");
  const closing = await db.select().from(schema.transactions).where(and(eq(schema.transactions.account_id, "open"), eq(schema.transactions.type, "adjustment"))).get();

  assert.ok(open?.archived_at);
  assert.equal(open.balance_minor, 0);
  assert.equal(closing?.amount_minor, -50000);
  assert.equal(closing?.date, "2026-01-15");
  assert.deepEqual(await readCashFlow(allMonthsPeriod, "EUR"), cashFlowBefore);
});

test("closing refuses a balance that changed after the user saw it, also between the check and the booking", async context => {
  const db = await seededDatabase(context);
  const changed = {
    status: 409,
    message: "The balance changed meanwhile. Review it and try again."
  };

  // The dialog showed 500.00; a booking arrived before the submit.
  await db.insert(schema.transactions).values({
    id: "arrived",
    account_id: "open",
    provider_reference: "manual:arrived",
    date: "2026-01-20",
    amount_minor: 700,
    currency: "EUR",
    type: "income"
  });
  const bookingsBefore = await db.select().from(schema.transactions);

  await assert.rejects(archiveAccount("open", {
    closing: {
      date: "2026-01-31",
      balance_minor: 50000
    }
  }), changed);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);

  // The confirmed balance matches when read, and a booking lands before the closing transaction.
  const execute = db.$client.execute.bind(db.$client);
  let interleaved = false;

  context.mock.method(db.$client, "execute", async (statement: InStatement, args?: InArgs) => {
    const result = typeof statement === "string" ? await execute(statement, args) : await execute(statement);
    const text = typeof statement === "string" ? statement : statement.sql;

    if (!interleaved && /^select /i.test(text) && text.includes('from "accounts"')) {
      interleaved = true;
      await execute("INSERT INTO transactions(id,account_id,provider_reference,date,amount_minor,currency,type,type_source) VALUES('late','open','manual:late','2026-01-21',300,'EUR','income','manual')");
    }

    return result;
  });
  await assert.rejects(archiveAccount("open", {
    closing: {
      date: "2026-01-31",
      balance_minor: 50700
    }
  }), changed);
  assert.ok(interleaved);
  assert.deepEqual((await db.select().from(schema.transactions)).filter(booking => booking.account_id === "open" && booking.type === "adjustment"), []);
  assert.equal((await listAccounts()).find(account => account.id === "open")?.archived_at, null);
});

test("closing a manual account can transfer its balance to another active manual account in the same currency", async context => {
  const db = await seededDatabase(context);

  await archiveAccount("open", {
    closing: {
      date: "2026-01-15",
      balance_minor: 50000,
      transfer_account_id: "target"
    }
  });
  const accountsAfter = await listAccounts();
  const legs = await db.select().from(schema.transactions).where(eq(schema.transactions.type, "transfer"));

  assert.equal(accountsAfter.find(account => account.id === "open")?.balance_minor, 0);
  assert.equal(accountsAfter.find(account => account.id === "target")?.balance_minor, 50000);
  assert.equal(accountsAfter.find(account => account.id === "target")?.archived_at, null);
  assert.deepEqual(legs.map(leg => [leg.account_id, leg.amount_minor]).sort(), [["open", -50000], ["target", 50000]]);
  assert.equal(new Set(legs.map(leg => leg.transfer_id)).size, 1);
});

test("a closing transfer to an archived, foreign-currency or bank account rolls back without booking or archiving", async context => {
  const db = await seededDatabase(context);

  await archiveAccount("closed", {});
  const bookingsBefore = await db.select().from(schema.transactions);

  for (const target of ["closed", "dollars", "bank", "open"]) {
    await assert.rejects(archiveAccount("open", {
      closing: {
        date: "2026-01-15",
        balance_minor: 50000,
        transfer_account_id: target
      }
    }), ValidationError, target);
  }

  await assert.rejects(archiveAccount("open", {
    closing: {
      date: "2999-01-01",
      balance_minor: 50000
    }
  }), ValidationError);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);
  assert.equal((await listAccounts()).find(account => account.id === "open")?.archived_at, null);
});

test("a booking written between the balance check and the archive update keeps the account active", async context => {
  const db = await seededDatabase(context);
  const execute = db.$client.execute.bind(db.$client);
  let interleaved = false;

  context.mock.method(db.$client, "execute", async (statement: InStatement, args?: InArgs) => {
    const result = typeof statement === "string" ? await execute(statement, args) : await execute(statement);
    const text = typeof statement === "string" ? statement : statement.sql;

    if (!interleaved && /^select /i.test(text) && text.includes('from "accounts"')) {
      interleaved = true;
      await execute("INSERT INTO transactions(id,account_id,provider_reference,date,amount_minor,currency,type,type_source) VALUES('late','closed','manual:late','2026-01-21',700,'EUR','income','manual')");
    }

    return result;
  });

  await assert.rejects(archiveAccount("closed", {}), {
    status: 409
  });
  assert.ok(interleaved);
  assert.equal((await listAccounts()).find(account => account.id === "closed")?.archived_at, null);
});

test("a bank account with a balance of 0 is not archived while a sync holds the lease", async context => {
  const db = await seededDatabase(context);

  await db.delete(schema.transactions).where(eq(schema.transactions.account_id, "bank"));
  assert.equal(await acquireLease("sync", "synthetic-sync"), true);
  await assert.rejects(archiveAccount("bank", {}), {
    status: 409,
    message: "A sync is running. Archive the account after it has finished."
  });
  assert.equal((await listAccounts()).find(account => account.id === "bank")?.archived_at, null);
});

test("accounts without bookings have a balance of 0 and are archived directly or when their bank is disconnected", async context => {
  const db = await seededDatabase(context);

  // A manual and a bank-linked account without any booking.
  await db.delete(schema.transactions).where(eq(schema.transactions.account_id, "target"));
  await db.delete(schema.transactions).where(eq(schema.transactions.account_id, "bank"));
  await archiveAccount("target", {});
  assert.ok((await listAccounts()).find(account => account.id === "target")?.archived_at);

  await db.insert(schema.requisitions).values({
    id: "connection",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "LINKED"
  });
  await db.update(schema.accounts).set({
    requisition_id: "connection"
  }).where(eq(schema.accounts.id, "bank"));
  const removal = await removeConnection("connection", Temporal.Now.instant(), null, "2026-11-01T00:00:00.000Z");

  assert.deepEqual(removal, {
    outcome: "removed",
    retainedAccounts: 1,
    notArchived: []
  });
  const bank = (await listAccounts()).find(account => account.id === "bank");

  assert.equal(bank?.balance_minor ?? 0, 0);
  assert.ok(bank?.archived_at);
});

test("the closing date cannot precede the account's last booking", async context => {
  const db = await seededDatabase(context);
  const bookingsBefore = await db.select().from(schema.transactions);

  await assert.rejects(archiveAccount("open", {
    closing: {
      date: "2026-01-01",
      balance_minor: 50000
    }
  }), {
    message: "Choose a date on or after the last booking (Jan 2, 2026)."
  });
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);
  assert.equal((await listAccounts()).find(account => account.id === "open")?.archived_at, null);

  await archiveAccount("open", {
    closing: {
      date: "2026-01-02",
      balance_minor: 50000
    }
  });
  assert.ok((await listAccounts()).find(account => account.id === "open")?.archived_at);
});

test("the sync control and reminders cover only active, connected bank accounts", () => {
  const connected = {
    provider: "enable_banking",
    archived_at: null,
    requisition_id: "connection"
  };

  assert.equal(showsSync("account", connected), true);
  assert.equal(showsSync("account", {
    ...connected,
    archived_at: "2026-11-01T00:00:00.000Z"
  }), false);
  // Restored after its connection was removed: detached, so nothing to sync.
  assert.equal(showsSync("account", {
    ...connected,
    requisition_id: null
  }), false);
  assert.equal(showsSync("account", {
    ...connected,
    provider: "manual",
    requisition_id: null
  }), false);
  assert.equal(showsSync("accounts", undefined), true);
  assert.equal(showsSync("rules", undefined), false);

  const bank: Account = {
    ...manualAccount,
    id: "connected-bank",
    provider: "enable_banking",
    requisition_id: "connection"
  };

  assert.deepEqual(accountGroups([bank, {
    ...bank,
    id: "detached-bank",
    requisition_id: null
  }, {
    ...bank,
    id: "archived-bank",
    archived_at: "2026-11-01T00:00:00.000Z"
  }], "EUR").bankAccounts.map(account => account.id), ["connected-bank"]);
});

test("archiving an unknown account is not found", async context => {
  await seededDatabase(context);

  await assert.rejects(archiveAccount("unknown", {}), {
    status: 404
  });
});

const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {}
} as unknown as AppRouterInstance;

// Account links need the app router contexts, and Next.js links schedule prefetching through the browser's global `self`.
function routedBrowser(context: TestContext) {
  const environment = browser(context, "http://localhost/accounts");

  Object.assign(globalThis, {
    self: window
  });
  context.after(() => {
    Reflect.deleteProperty(globalThis, "self");
  });

  window.HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  window.HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const routed = (element: ReactNode) => withQueryClient(environment.queryClient, createElement(AppStoreProvider, {
    locked: false
  }, createElement(AppRouterContext, {
    value: router
  }, createElement(PathnameContext, {
    value: window.location.pathname
  }, createElement(SearchParamsContext, {
    value: new URLSearchParams(window.location.search)
  }, element)))));

  return {
    ...environment,
    routed
  };
}

const manualAccount: Account = {
  id: "manual/cash",
  name: "Synthetic cash",
  provider_name: null,
  institution: "Example institution",
  kind: "checking",
  currency: "EUR",
  balance_minor: 10000,
  balance_date: "2026-09-01",
  last_booking_date: null,
  reported_balance_minor: null,
  reported_balance_date: null,
  reported_difference_minor: null,
  provider: "manual",
  requisition_id: null,
  last_synced_at: null,
  valid_until: null,
  sync_error: null,
  archived_at: null
};

async function renderDetails(context: TestContext, account: Account) {
  const environment = routedBrowser(context);
  const { AccountDetails } = await import("../src/features/accounts/components/account-details");
  const { AccountMenu } = await import("../src/features/accounts/components/account-menu");
  const screen = render(environment.routed(createElement(Fragment, null, createElement(AccountMenu, {
    account
  }), createElement(AccountDetails, {
    account: {
      data: account,
      status: "ready"
    },
    back: {
      href: "/accounts",
      label: "Accounts"
    },
    connections: {
      data: [],
      status: "ready"
    },
    history: {
      data: {
        currency: "EUR",
        balances: [],
        reported: []
      },
      status: "ready"
    }
  }))));

  return {
    ...environment,
    screen
  };
}

test("a manual account's balance has a labelled edit button that opens the balance dialog for that account", async context => {
  const {
    screen,
    requests
  } = await renderDetails(context, manualAccount);
  const edit = screen.getByRole("button", {
    name: "Update balance of Synthetic cash"
  });

  assert.equal(edit.getAttribute("title"), "Update balance");
  act(() => fireEvent.click(edit));
  const dialog = within(screen.getByRole("dialog"));

  act(() => {
    fireEvent.change(dialog.getByRole("textbox", {
      name: "New balance"
    }), {
      target: {
        value: "150.00"
      }
    });
    fireEvent.submit(dialog.getByRole("button", {
      name: "Save balance"
    }).closest("form")!);
  });
  await wait(0);
  assert.equal(requests("accounts/manual%2Fcash/balance").length, 1);
});

test("a bank-synced account with a balance of 0 is archived directly and offers no manual balance update", async context => {
  const bank = await renderDetails(context, {
    ...manualAccount,
    provider: "enable_banking",
    balance_minor: 0
  });

  assert.equal(bank.screen.queryByRole("button", {
    name: /Update balance/
  }), null);
  await chooseMenuItem(bank.screen, "Archive account");
  await wait(0);
  assert.equal(bank.requests("accounts/manual%2Fcash/archive")[0].method, "PUT");
});

test("a manual account with a remaining balance is closed through a dialog that cancel leaves unchanged", async context => {
  const {
    screen,
    requests
  } = await renderDetails(context, manualAccount);
  const openDialog = () => chooseMenuItem(screen, "Archive account");

  await openDialog();
  act(() => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {
    name: "Cancel"
  })));
  await wait(0);
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(requests("accounts/manual%2Fcash/archive").length, 0);

  await openDialog();
  const dialog = within(screen.getByRole("dialog"));

  act(() => {
    fireEvent.change(dialog.getByLabelText("Closing date"), {
      target: {
        value: "2026-01-15"
      }
    });
    fireEvent.submit(dialog.getByRole("button", {
      name: "Close and archive"
    }).closest("form")!);
  });
  await wait(0);
  assert.deepEqual(requests("accounts/manual%2Fcash/archive")[0].body, {
    closing: {
      date: "2026-01-15",
      balance_minor: 10000,
      transfer_account_id: null
    }
  });
});

test("a bank-linked account with a remaining balance explains why it cannot be archived and offers only cancel", async context => {
  const {
    screen,
    requests
  } = await renderDetails(context, {
    ...manualAccount,
    provider: "enable_banking"
  });

  await chooseMenuItem(screen, "Archive account");
  const dialog = within(screen.getByRole("dialog"));

  assert.ok(dialog.getByText(/follows its bank bookings/));
  assert.deepEqual(dialog.getAllByRole("button").map(button => button.textContent).filter(text => text !== ""), ["Cancel"]);
  assert.equal(requests("accounts/manual%2Fcash/archive").length, 0);
});

test("a manual account without bookings is archived directly", async context => {
  const {
    screen,
    requests
  } = await renderDetails(context, {
    ...manualAccount,
    balance_minor: null
  });

  await chooseMenuItem(screen, "Archive account");
  await wait(0);
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(requests("accounts/manual%2Fcash/archive")[0].method, "PUT");
});

test("an archived account offers restore and no balance update", async context => {
  const archived = await renderDetails(context, {
    ...manualAccount,
    archived_at: "2026-11-01T00:00:00.000Z"
  });

  archived.queryClient.setQueryData(queryKeys.transactions.all(), []);

  assert.equal(archived.screen.queryByRole("button", {
    name: /Update balance/
  }), null);
  await chooseMenuItem(archived.screen, "Restore account");
  await wait(0);
  const [restore] = archived.requests("accounts/manual%2Fcash/archive");

  assert.equal(restore.method, "DELETE");
  await respond(restore, Response.json({
    ok: true
  }));
  await wait(0);
  // Listed transactions carry the archived flag, so restoring refreshes them.
  assert.equal(archived.queryClient.getQueryState(queryKeys.transactions.all())?.isInvalidated, true);
});

test("the accounts view lists archived accounts apart and does not count them", async context => {
  const environment = routedBrowser(context);
  const { AccountsView } = await import("../src/features/accounts/components/accounts-view");
  const screen = render(environment.routed(createElement(AccountsView, {
    accounts: {
      data: [manualAccount, {
        ...manualAccount,
        id: "archived",
        name: "Synthetic archived",
        archived_at: Temporal.Now.instant().toString()
      }],
      status: "ready"
    }
  })));

  assert.ok(screen.getByRole("heading", {
    name: "Accounts & assets 1"
  }));
  const archivedSection = screen.getByText("Archived accounts (1)").closest("details")!;

  assert.ok(within(archivedSection as HTMLElement).getByRole("link", {
    name: "Synthetic archived"
  }));
  assert.equal(within(archivedSection as HTMLElement).queryByRole("link", {
    name: "Synthetic cash"
  }), null);
});

test("the archived accounts section stays open through the URL, which toggling replaces without a history entry", async context => {
  const environment = routedBrowser(context);

  window.history.replaceState(null, "", "/accounts?archived=open");
  const { AccountsView } = await import("../src/features/accounts/components/accounts-view");
  const historyLength = window.history.length;
  const screen = render(environment.routed(createElement(AccountsView, {
    accounts: {
      data: [manualAccount, {
        ...manualAccount,
        id: "archived",
        name: "Synthetic archived",
        archived_at: Temporal.Now.instant().toString()
      }],
      status: "ready"
    }
  })));
  const section = screen.getByText("Archived accounts (1)").closest("details")!;

  assert.equal(section.open, true);

  act(() => {
    section.open = false;
    fireEvent(section, new window.Event("toggle"));
  });

  assert.equal(window.location.search, "");
  assert.equal(window.history.length, historyLength);

  act(() => {
    section.open = true;
    fireEvent(section, new window.Event("toggle"));
  });

  assert.equal(window.location.search, "?archived=open");
  assert.equal(window.history.length, historyLength);
});
