import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { act, fireEvent, render, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
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
import { ValidationError } from "../src/lib/errors";
import { acquireLease } from "../src/server/jobs/lease-repository";
import { listAccounts, readBalanceHistory, readNetWorth } from "../src/features/accounts/server/account-queries";
import { convertToManualAccount, deleteAccount, updateAccount, updateManualValuation } from "../src/features/accounts/server/account-service";
import { readAccountCashFlow, readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { pairAllTransfers } from "../src/features/transactions/server/transfer-pairing-repository";
import { deleteUnlinkedAccount } from "../src/features/accounts/server/account-repository";
import { updateRule } from "../src/features/categorization/server/rule-repository";
import { createRule, updateRuleDetails } from "../src/features/categorization/server/categorization-service";
import { syncLease } from "../src/server/jobs/lease";
import type { Account } from "../src/features/accounts/types";
import { browser, wait, withQueryClient } from "./fixtures/browser";
import { chooseMenuItem, menuItem, queryMenuItem } from "./fixtures/action-menu";
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
  await db.insert(schema.categories).values({
    id: "synthetic-rent",
    name: "Synthetic rent",
    color: "#888888"
  });
  await db.insert(schema.requisitions).values({
    id: "linked",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "LINKED",
    valid_until: "2099-01-01T00:00:00Z"
  });
  await db.insert(schema.accounts).values([{
    id: "cash",
    name: "Synthetic cash",
    kind: "checking"
  }, {
    id: "wallet",
    name: "Synthetic wallet",
    kind: "checking"
  }, {
    id: "detached",
    name: "Synthetic detached account",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: "uid-detached",
    last_synced_at: "2026-02-28T10:00:00Z"
  }, {
    id: "linked-bank",
    name: "Synthetic linked account",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: "uid-linked",
    requisition_id: "linked"
  }]);
  await db.insert(schema.accountIdentifiers).values({
    identification_hash: "hash-detached",
    account_id: "detached"
  });
  await db.insert(schema.balanceSnapshots).values([{
    id: "detached-january",
    account_id: "detached",
    observed_at: "2026-01-31",
    amount_minor: 100000,
    source: "sync"
  }, {
    id: "detached-february",
    account_id: "detached",
    observed_at: "2026-02-28",
    amount_minor: 120000,
    bank_balance_type: "CLBD",
    source: "sync"
  }]);
  // Each bank account's first sync booked the opening balance: the reported balance minus the bookings it received.
  await db.insert(schema.transactions).values([{
    id: "detached-opening",
    account_id: "detached",
    provider_reference: "manual:detached-opening",
    date: "2026-01-04",
    amount_minor: 34000,
    currency: "EUR",
    type: "opening_balance"
  }, {
    id: "linked-opening",
    account_id: "linked-bank",
    provider_reference: "manual:linked-opening",
    date: "2026-01-01",
    amount_minor: 5000,
    currency: "EUR",
    type: "opening_balance"
  }, {
    id: "cash-opening",
    account_id: "cash",
    provider_reference: "manual:cash-opening",
    date: "2026-01-01",
    amount_minor: 50000,
    currency: "EUR",
    type: "opening_balance"
  }, {
    id: "cash-rent",
    account_id: "cash",
    provider_reference: "manual:cash-rent",
    date: "2026-01-03",
    amount_minor: -20000,
    currency: "EUR",
    category_id: "synthetic-rent",
    category_source: "manual",
    type: "expense"
  }, {
    id: "cash-to-wallet",
    account_id: "cash",
    provider_reference: "manual:cash-to-wallet",
    date: "2026-01-04",
    amount_minor: -3000,
    currency: "EUR",
    type: "transfer",
    transfer_id: "pair-wallet",
    transfer_source: "manual"
  }, {
    id: "wallet-from-cash",
    account_id: "wallet",
    provider_reference: "transfer:cash-to-wallet",
    date: "2026-01-04",
    amount_minor: 3000,
    currency: "EUR",
    type: "transfer",
    transfer_id: "pair-wallet",
    transfer_source: "manual"
  }, {
    id: "cash-from-bank",
    account_id: "cash",
    provider_reference: "manual:cash-from-bank",
    date: "2026-01-05",
    amount_minor: 4000,
    currency: "EUR",
    type: "transfer",
    transfer_id: "pair-bank",
    transfer_source: "auto"
  }, {
    id: "bank-to-cash",
    account_id: "detached",
    provider_reference: "bank-ref-1",
    date: "2026-01-05",
    amount_minor: -4000,
    currency: "EUR",
    type: "transfer",
    type_source: "auto",
    type_rule_id: "rule-to-cash",
    type_transfer_account_id: "cash",
    transfer_id: "pair-bank",
    transfer_source: "auto"
  }, {
    id: "bank-salary",
    account_id: "detached",
    provider_reference: "bank-ref-2",
    date: "2026-01-25",
    amount_minor: 90000,
    currency: "EUR",
    type: "income"
  }]);
  await db.insert(schema.transactionSplits).values([{
    id: "rent-part-1",
    transaction_id: "cash-rent",
    position: 0,
    amount_minor: -15000,
    category_id: "synthetic-rent"
  }, {
    id: "rent-part-2",
    transaction_id: "cash-rent",
    position: 1,
    amount_minor: -5000,
    category_id: null
  }]);
  await db.insert(schema.categorizationRules).values({
    id: "rule-to-cash",
    name: "Synthetic cash withdrawals",
    pattern: "ATM",
    mode: "keyword",
    category_id: "synthetic-rent",
    transaction_type: "transfer",
    transfer_account_id: "cash"
  });

  return db;
}

async function reports(accountId: string) {
  return {
    cashFlow: await readCashFlow(allMonthsPeriod, "EUR"),
    accountCashFlow: await readAccountCashFlow(accountId, allMonthsPeriod),
    netWorth: await readNetWorth("EUR")
  };
}

test("converting a disconnected bank account keeps its balance, history and every report, and makes it a manual account", async context => {
  const db = await seededDatabase(context);
  const before = await reports("detached");
  const listedBefore = (await listAccounts()).find(account => account.id === "detached");

  assert.deepEqual(await convertToManualAccount("detached"), {
    ok: true
  });

  const converted = (await listAccounts()).find(account => account.id === "detached");

  assert.equal(converted?.provider, "manual");
  assert.equal(listedBefore?.balance_minor, 120000);
  assert.equal(converted?.balance_minor, 120000);
  assert.equal(converted?.reported_balance_minor, null);
  assert.equal(converted?.reported_difference_minor, null);
  assert.deepEqual(await reports("detached"), before);

  // The balance already is the sum of its bookings, so converting books nothing.
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "detached"))).length, 3);
  assert.equal((await db.select().from(schema.balanceSnapshots).where(eq(schema.balanceSnapshots.account_id, "detached"))).length, 2);
  assert.deepEqual(await db.select().from(schema.accountIdentifiers).where(eq(schema.accountIdentifiers.account_id, "detached")), []);
  assert.equal((await db.select().from(schema.accounts).where(eq(schema.accounts.id, "detached")).get())?.provider_uid, null);
  assert.equal((await readBalanceHistory("detached")).balances.at(-1)?.amount_minor, 120000);

  // It now accepts what any manual account accepts.
  await updateManualValuation("detached", {
    balance: "1250",
    date: "2026-03-01"
  }, Temporal.Instant.from("2026-03-02T00:00:00Z"));
  await updateAccount("detached", {
    name: "Synthetic detached account",
    kind: "savings"
  });
  const updated = (await listAccounts()).find(account => account.id === "detached");

  assert.equal(updated?.balance_minor, 125000);
  assert.equal(updated?.kind, "savings");
});

test("converting books nothing when bookings are dated after the last reported bank balance", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.transactions).values({
    id: "bank-later",
    account_id: "detached",
    provider_reference: "bank-ref-later",
    date: "2026-03-02",
    amount_minor: 10000,
    currency: "EUR",
    type: "income"
  });
  const netWorthBefore = await readNetWorth("EUR");

  await convertToManualAccount("detached");

  const converted = (await listAccounts()).find(account => account.id === "detached");

  assert.equal(converted?.balance_minor, 130000);
  assert.deepEqual(await readNetWorth("EUR"), netWorthBefore);
  assert.equal(await db.select().from(schema.transactions).where(eq(schema.transactions.type, "adjustment")).get(), undefined);
  assert.equal((await readBalanceHistory("detached")).balances.at(-1)?.amount_minor, 130000);
});

test("a bank account with an active connection, a manual account or an unknown account is not converted", async context => {
  const db = await seededDatabase(context);
  const accountsBefore = await db.select().from(schema.accounts);

  await assert.rejects(convertToManualAccount("linked-bank"), {
    status: 409,
    message: "Disconnect the bank before converting this account to a manual account."
  });
  await assert.rejects(convertToManualAccount("missing"), {
    status: 404
  });
  assert.deepEqual(await convertToManualAccount("cash"), {
    ok: true
  });
  assert.deepEqual(await db.select().from(schema.accounts), accountsBefore);
});

test("converting waits for a running sync", async context => {
  const db = await seededDatabase(context);

  await acquireLease(syncLease, "sync");
  await assert.rejects(convertToManualAccount("detached"), {
    status: 409,
    message: "A sync is running. Convert the account after it has finished."
  });
  assert.equal((await db.select().from(schema.accounts).where(eq(schema.accounts.id, "detached")).get())?.provider, "enable_banking");
});

test("deleting a manual account removes its bookings, splits and report contributions, and leaves linked bookings on other accounts as unpaired transfers", async context => {
  const db = await seededDatabase(context);
  const walletBefore = await reports("wallet");
  const netWorthBefore = await readNetWorth("EUR");
  const cashFlowBefore = await readCashFlow(allMonthsPeriod, "EUR");

  assert.deepEqual(await deleteAccount("cash", {
    name: "Synthetic cash"
  }), {
    ok: true
  });

  assert.equal((await listAccounts()).some(account => account.id === "cash"), false);
  assert.deepEqual(await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "cash")), []);
  assert.deepEqual(await db.select().from(schema.transactionSplits), []);

  // The deleted account's balance of 31000 leaves net worth; other balances stay.
  const netWorth = await readNetWorth("EUR");

  assert.equal(netWorth.netWorth, netWorthBefore.netWorth - 31000);
  assert.deepEqual((await reports("wallet")).accountCashFlow, walletBefore.accountCashFlow);

  // The deleted rent expense leaves cash flow; the bank income stays.
  const cashFlow = await readCashFlow(allMonthsPeriod, "EUR");

  assert.equal(cashFlow.expenses, cashFlowBefore.expenses - 20000);
  assert.equal(cashFlow.income, cashFlowBefore.income);

  // A counterpart Ufer created becomes an ordinary manual entry; an imported counterpart keeps its reference. Both stay transfers without a link.
  const wallet = await db.select().from(schema.transactions).where(eq(schema.transactions.id, "wallet-from-cash")).get();
  const bank = await db.select().from(schema.transactions).where(eq(schema.transactions.id, "bank-to-cash")).get();

  assert.equal(wallet?.provider_reference, "manual:wallet-from-cash");
  assert.equal(wallet?.amount_minor, 3000);
  assert.equal(wallet?.type, "transfer");
  assert.equal(wallet?.transfer_id, null);
  assert.equal(wallet?.transfer_source, "manual");
  assert.equal(bank?.provider_reference, "bank-ref-1");
  assert.equal(bank?.type, "transfer");
  assert.equal(bank?.transfer_id, null);
  assert.equal(bank?.type_transfer_account_id, null);
  assert.equal(bank?.transfer_source, "manual");

  const rule = await db.select().from(schema.categorizationRules).where(eq(schema.categorizationRules.id, "rule-to-cash")).get();

  assert.equal(rule?.transaction_type, "transfer");
  assert.equal(rule?.transfer_account_id, "removed:cash");
});

test("a rule-typed transfer to a deleted account is not paired with an opposite booking on another account afterwards", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.transactions).values([{
    id: "bank-to-cash-later",
    account_id: "detached",
    provider_reference: "bank-ref-3",
    date: "2026-02-10",
    amount_minor: -7000,
    currency: "EUR",
    type: "transfer",
    type_rule_id: "rule-to-cash",
    type_transfer_account_id: "cash"
  }, {
    id: "wallet-income",
    account_id: "wallet",
    provider_reference: "wallet-ref-1",
    date: "2026-02-10",
    amount_minor: 7000,
    currency: "EUR",
    type: "income"
  }]);
  await deleteAccount("cash", {
    name: "Synthetic cash"
  });
  await pairAllTransfers();

  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "bank-to-cash-later")).get())?.transfer_id, null);
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "wallet-income")).get())?.transfer_id, null);
});

test("a rule whose transfer account was deleted can still be edited and keeps its target, while no rule can newly name that target", async context => {
  const db = await seededDatabase(context);

  await deleteAccount("cash", {
    name: "Synthetic cash"
  });
  const details = {
    name: "Synthetic cash withdrawals",
    pattern: "CASH ATM",
    mode: "keyword",
    category_id: "synthetic-rent",
    transaction_type: "transfer",
    transfer_account_id: "removed:cash"
  };

  await updateRuleDetails("rule-to-cash", details);
  const rule = await db.select().from(schema.categorizationRules).where(eq(schema.categorizationRules.id, "rule-to-cash")).get();

  assert.equal(rule?.pattern, "CASH ATM");
  assert.equal(rule?.transfer_account_id, "removed:cash");
  await assert.rejects(createRule({
    ...details,
    name: "Synthetic new rule"
  }), new ValidationError("Choose one of your active accounts for the transfer."));
});

test("a rule edit keeps a removed transfer target only while the stored rule still names it", async context => {
  const db = await seededDatabase(context);

  await deleteAccount("cash", {
    name: "Synthetic cash"
  });
  const details = {
    name: "Synthetic cash withdrawals",
    pattern: "CASH ATM",
    mode: "keyword" as const,
    category_id: "synthetic-rent",
    transaction_type: "transfer" as const,
    transfer_account_id: "wallet"
  };

  // Another edit retargets the rule after this one read the removed target.
  assert.equal(await updateRule("rule-to-cash", details), "saved");
  assert.equal(await updateRule("rule-to-cash", {
    ...details,
    transfer_account_id: "removed:cash"
  }), "inactive_target");
  assert.equal((await db.select().from(schema.categorizationRules).where(eq(schema.categorizationRules.id, "rule-to-cash")).get())?.transfer_account_id, "wallet");
});

test("deleting a disconnected bank account removes its balance history and bank identifiers", async context => {
  const db = await seededDatabase(context);

  await deleteAccount("detached", {
    name: "Synthetic detached account"
  });

  assert.equal((await db.select().from(schema.accounts).where(eq(schema.accounts.id, "detached")).get()), undefined);
  assert.deepEqual(await db.select().from(schema.balanceSnapshots), []);
  assert.deepEqual(await db.select().from(schema.accountIdentifiers), []);
  assert.equal((await readNetWorth("EUR")).netWorth, 31000 + 3000 + 5000);
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "cash-from-bank")).get())?.transfer_id, null);
});

test("deletion without the exact account name, of a bank-linked account or of an unknown account changes nothing", async context => {
  const db = await seededDatabase(context);
  const accountsBefore = await db.select().from(schema.accounts);
  const transactionsBefore = await db.select().from(schema.transactions);

  await assert.rejects(deleteAccount("cash", {
    name: "synthetic cash"
  }), new ValidationError("Enter the account's name to confirm the deletion."));
  await assert.rejects(deleteAccount("cash", {}));
  await assert.rejects(deleteAccount("linked-bank", {
    name: "Synthetic linked account"
  }), {
    status: 409,
    message: "Disconnect the bank before deleting this account; a sync would otherwise restore it."
  });
  await assert.rejects(deleteAccount("missing", {
    name: "Synthetic cash"
  }), {
    status: 404
  });

  assert.deepEqual(await db.select().from(schema.accounts), accountsBefore);
  assert.deepEqual(await db.select().from(schema.transactions), transactionsBefore);
});

const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {}
} as unknown as AppRouterInstance;

const detachedAccount: Account = {
  id: "bank/old",
  name: "Synthetic old bank account",
  provider_name: null,
  institution: "Example institution",
  kind: "checking",
  currency: "EUR",
  balance_minor: 120000,
  balance_date: "2026-02-28",
  last_booking_date: "2026-01-25",
  reported_balance_minor: null,
  reported_balance_date: null,
  reported_difference_minor: null,
  provider: "enable_banking",
  requisition_id: null,
  last_synced_at: null,
  valid_until: null,
  sync_error: null,
  archived_at: null
};

async function renderDetails(context: TestContext, account: Account) {
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
  const { AccountDetails } = await import("../src/features/accounts/components/account-details");
  const { AccountMenu } = await import("../src/features/accounts/components/account-menu");
  const screen = render(routed(createElement(Fragment, null, createElement(AccountMenu, {
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
        balances: []
      },
      status: "ready"
    }
  }))));

  return {
    ...environment,
    screen
  };
}

test("a deletion confirmed with the name read before a rename keeps the renamed account", async context => {
  const db = await seededDatabase(context);

  await updateAccount("wallet", {
    name: "Renamed wallet"
  });

  assert.equal(await deleteUnlinkedAccount("wallet", "Synthetic wallet"), false);
  assert.equal((await db.select().from(schema.accounts).where(eq(schema.accounts.id, "wallet")).get())?.name, "Renamed wallet");
});

test("deleting an account sends no request until its exact name is typed", async context => {
  const {
    screen,
    requests
  } = await renderDetails(context, detachedAccount);

  await chooseMenuItem(screen, "Delete account");
  const dialog = within(screen.getByRole("dialog"));
  const typeName = (value: string) => act(() => fireEvent.change(dialog.getByLabelText("Type the account name to confirm"), {
    target: {
      value
    }
  }));
  const confirm = () => act(() => fireEvent.submit(dialog.getByRole("button", {
    name: "Delete permanently"
  })));

  typeName("Synthetic old bank");
  confirm();
  await wait(0);
  assert.deepEqual(requests("accounts/bank%2Fold"), []);
  assert.ok(dialog.getByText("Enter the account's exact name to confirm the deletion."));

  typeName("Synthetic old bank account");
  confirm();
  await wait(0);

  const [request] = requests("accounts/bank%2Fold");

  assert.equal(request.method, "DELETE");
  assert.deepEqual(request.body, {
    name: "Synthetic old bank account"
  });
});

test("a disconnected bank account offers conversion, which converts it after confirmation", async context => {
  const {
    screen,
    requests
  } = await renderDetails(context, detachedAccount);

  await chooseMenuItem(screen, "Convert to manual account");
  assert.deepEqual(requests("accounts/bank%2Fold/manual"), []);
  act(() => fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button", {
    name: "Convert"
  })));
  await wait(0);
  assert.equal(requests("accounts/bank%2Fold/manual")[0].method, "PUT");
  assert.ok(await menuItem(screen, "Delete account"));
});

test("a manual account offers deletion but no conversion", async context => {
  const { screen } = await renderDetails(context, {
    ...detachedAccount,
    provider: "manual"
  });

  assert.equal(await queryMenuItem(screen, "Convert to manual account"), null);
  assert.ok(await menuItem(screen, "Delete account"));
});

test("a bank account with an active connection offers neither deletion nor conversion", async context => {
  const { screen } = await renderDetails(context, {
    ...detachedAccount,
    requisition_id: "linked"
  });

  assert.equal(await queryMenuItem(screen, "Delete account"), null);
  assert.equal(await queryMenuItem(screen, "Convert to manual account"), null);
});
