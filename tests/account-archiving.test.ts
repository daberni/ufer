import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { act, fireEvent, render, within } from "@testing-library/react";
import { drizzle } from "drizzle-orm/libsql";
import { createElement, type ReactNode } from "react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AppStoreProvider } from "../src/client/app-store";
import { Temporal } from "temporal-polyfill";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { allMonthsPeriod } from "../src/lib/period";
import { listAccounts, readBalanceHistory, readNetWorth } from "../src/features/accounts/server/account-queries";
import { setAccountArchived, updateManualValuation } from "../src/features/accounts/server/account-service";
import { enterManualTransaction } from "../src/features/transactions/server/transaction-service";
import { importTransactions, importValuations } from "../src/features/imports/server/import-service";
import { readAccountCashFlow, readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { accountGroups } from "../src/features/accounts/queries";
import type { Account } from "../src/features/accounts/types";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
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
    environment: "SANDBOX",
    name: "Synthetic closed account",
    institution: "Example institution",
    kind: "checking"
  }, {
    id: "open",
    environment: "SANDBOX",
    name: "Synthetic open account",
    institution: "Example institution",
    kind: "savings"
  }, {
    id: "other-environment",
    environment: "PRODUCTION",
    name: "Synthetic production account",
    institution: "Example institution",
    kind: "checking"
  }]);
  await db.insert(schema.transactions).values([{
    id: "opening",
    account_id: "closed",
    provider_reference: "manual:opening",
    booking_date: "2026-01-01",
    amount_minor: 100000,
    currency: "EUR",
    type: "opening_balance"
  }, {
    id: "salary",
    account_id: "closed",
    provider_reference: "manual:salary",
    booking_date: "2026-01-05",
    amount_minor: 250000,
    currency: "EUR",
    type: "income"
  }, {
    id: "groceries",
    account_id: "closed",
    provider_reference: "manual:groceries",
    booking_date: "2026-01-06",
    amount_minor: -4000,
    currency: "EUR",
    category_id: "groceries",
    type: "expense"
  }, {
    id: "savings",
    account_id: "open",
    provider_reference: "manual:savings",
    booking_date: "2026-01-02",
    amount_minor: 50000,
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

  assert.deepEqual(await setAccountArchived("closed", true), {
    ok: true
  });
  const archived = await listAccounts();
  const closed = archived.find(account => account.id === "closed");

  assert.ok(closed?.archived_at);
  assert.equal(closed.balance_minor, 346000);
  assert.deepEqual(await reports(), before);

  const groups = accountGroups(archived as Account[], "EUR");

  assert.deepEqual(groups.currencyAccounts.map(account => account.id), ["open"]);
  assert.deepEqual(groups.manualAccounts.map(account => account.id), ["open"]);

  await setAccountArchived("closed", false);
  assert.equal((await listAccounts()).find(account => account.id === "closed")?.archived_at, null);
  assert.deepEqual(accountGroups(await listAccounts() as Account[], "EUR").currencyAccounts.map(account => account.id), ["closed", "open"]);
  assert.deepEqual(await reports(), before);
});

test("an archived account rejects balance updates, manual entries and CSV imports until it is restored", async context => {
  const db = await seededDatabase(context);

  await setAccountArchived("closed", true);
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
    booking_date: "2026-01-10",
    type: "expense"
  }), archived);
  await assert.rejects(importTransactions({
    account_id: "closed",
    csv: "id,date,amount,currency,counterparty,description\nentry-1,2026-01-10,-5.00,EUR,Example payee,Synthetic"
  }), archived);
  await assert.rejects(importValuations({
    account_id: "closed",
    csv: "date,balance,currency\n2026-01-10,10.00,EUR"
  }), archived);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);

  await setAccountArchived("closed", false);
  await updateManualValuation("closed", {
    balance: "10.00",
    date: "2026-01-10"
  });
  assert.equal((await db.select().from(schema.transactions)).length, bookingsBefore.length + 1);
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

test("archiving an unknown account or one of another banking environment is not found", async context => {
  await seededDatabase(context);

  await assert.rejects(setAccountArchived("unknown", true), {
    status: 404
  });
  await assert.rejects(setAccountArchived("other-environment", true), {
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
  const screen = render(environment.routed(createElement(AccountDetails, {
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
  })));

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

test("a bank-synced account offers archiving but no manual balance update", async context => {
  const bank = await renderDetails(context, {
    ...manualAccount,
    provider: "enable_banking"
  });

  assert.equal(bank.screen.queryByRole("button", {
    name: /Update balance/
  }), null);
  act(() => fireEvent.click(bank.screen.getByRole("button", {
    name: "Archive account"
  })));
  await wait(0);
  assert.equal(bank.requests("accounts/manual%2Fcash/archive")[0].method, "PUT");
});

test("an archived account offers restore and no balance update", async context => {
  const archived = await renderDetails(context, {
    ...manualAccount,
    archived_at: "2026-11-01T00:00:00.000Z"
  });

  assert.equal(archived.screen.queryByRole("button", {
    name: /Update balance/
  }), null);
  act(() => fireEvent.click(archived.screen.getByRole("button", {
    name: "Restore account"
  })));
  await wait(0);
  const [restore] = archived.requests("accounts/manual%2Fcash/archive");

  assert.equal(restore.method, "DELETE");
  await respond(restore, Response.json({
    ok: true
  }));
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

  assert.ok(screen.getByText("1 ACCOUNTS & ASSETS"));
  const archivedSection = screen.getByText("Archived accounts (1)").closest("details")!;

  assert.ok(within(archivedSection as HTMLElement).getByRole("link", {
    name: "Synthetic archived"
  }));
  assert.equal(within(archivedSection as HTMLElement).queryByRole("link", {
    name: "Synthetic cash"
  }), null);
});
