import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { act, fireEvent, render, within } from "@testing-library/react";
import { and, eq } from "drizzle-orm";
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
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { ValidationError } from "../src/lib/errors";
import { listAccounts, readBalanceHistory, readNetWorth } from "../src/features/accounts/server/account-queries";
import { archiveAccount, restoreAccount, updateManualValuation } from "../src/features/accounts/server/account-service";
import { editManualTransaction, enterManualTransaction, removeManualTransaction, transferOptions, updateTransactionCategory, updateTransactionType } from "../src/features/transactions/server/transaction-service";
import { applyRulesToUncorrectedTransactions } from "../src/features/categorization/server/categorization-service";
import { pairTransfersInEnvironment } from "../src/features/transactions/server/transfer-repository";
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
    id: "target",
    environment: "SANDBOX",
    name: "Synthetic target account",
    institution: "Example institution",
    kind: "checking"
  }, {
    id: "dollars",
    environment: "SANDBOX",
    name: "Synthetic dollar account",
    institution: "Example institution",
    kind: "checking",
    currency: "USD"
  }, {
    id: "bank",
    environment: "SANDBOX",
    name: "Synthetic bank account",
    institution: "Example institution",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: "uid-bank",
    balance_minor: 7000,
    balance_date: "2026-01-31"
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
  }, {
    id: "settled",
    account_id: "closed",
    provider_reference: "manual:settled",
    booking_date: "2026-01-20",
    amount_minor: -346000,
    currency: "EUR",
    type: "adjustment"
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
    booking_date: "2026-01-06",
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
    booking_date: "2026-01-05",
    amount: "1.00"
  }), archived);
  await assert.rejects(removeManualTransaction("salary"), archived);
  await assert.rejects(updateTransactionType("groceries", {
    type: "transfer",
    transfer: {
      counterpart_id: "refund"
    }
  }), archived);
  assert.deepEqual(await candidates(), []);
  // The list offers no entry editing or deletion for bookings on the archived account.
  const page = await readTransactionPage(dashboardFilters(new URLSearchParams({
    period: "2026-01"
  })));

  assert.equal(page.transactions.find(item => item.id === "salary")?.entered, false);
  assert.equal(page.transactions.find(item => item.id === "refund")?.entered, true);
  await assert.rejects(updateTransactionType("refund", {
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

test("categories of bookings on an archived account change neither manually nor by applying rules", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.transactions).values({
    id: "shop",
    account_id: "closed",
    provider_reference: "manual:shop",
    booking_date: "2026-01-07",
    amount_minor: 0,
    currency: "EUR",
    counterparty: "Synthetic shop",
    type: "expense"
  });
  await db.insert(schema.categorizationRules).values({
    id: "shop-rule",
    name: "Synthetic shop",
    pattern: "Synthetic shop",
    mode: "keyword",
    category_id: "groceries"
  });
  await archiveAccount("closed", {});
  const bookingsBefore = await db.select().from(schema.transactions);

  await assert.rejects(updateTransactionCategory("groceries", {
    category_id: null
  }), {
    status: 409,
    message: "This account is archived. Restore the account first."
  });
  await applyRulesToUncorrectedTransactions();
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);

  await restoreAccount("closed");
  await applyRulesToUncorrectedTransactions();
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "shop")).get())?.category_id, "groceries");
});

test("automatic pairing never links a booking on an archived account", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.transactions).values([{
    id: "outgoing",
    account_id: "closed",
    provider_reference: "csv:outgoing",
    booking_date: "2026-01-08",
    amount_minor: -2500,
    currency: "EUR",
    type: "transfer"
  }, {
    id: "incoming",
    account_id: "target",
    provider_reference: "csv:incoming",
    booking_date: "2026-01-08",
    amount_minor: 2500,
    currency: "EUR",
    type: "income"
  }]);
  await archiveAccount("closed", {
    closing: {
      date: "2026-01-31"
    }
  });
  const bookingsBefore = await db.select().from(schema.transactions);

  assert.equal(await pairTransfersInEnvironment("SANDBOX"), 0);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);

  await restoreAccount("closed");
  assert.equal(await pairTransfersInEnvironment("SANDBOX"), 1);
});

test("changing a booking linked to a counterpart on an archived account is refused before the counterpart changes", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.transactions).values({
    id: "imported",
    account_id: "bank",
    provider_reference: "bank:imported",
    booking_date: "2026-01-08",
    amount_minor: -2500,
    currency: "EUR",
    type: "expense"
  });
  await updateTransactionType("imported", {
    type: "transfer",
    transfer: {
      account_id: "closed"
    }
  });
  const counterpart = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, "transfer:imported")).get();

  assert.equal(counterpart?.account_id, "closed");
  await archiveAccount("closed", {
    closing: {
      date: "2026-01-31"
    }
  });
  const bookingsBefore = await db.select().from(schema.transactions);

  await assert.rejects(updateTransactionType("imported", {
    type: "expense"
  }), {
    status: 409
  });
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);
});

test("a booking on an archived account shows its category as a label instead of a picker", async context => {
  browser(context);
  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const screen = render(createElement(TransactionCategory, {
    categories: [{
      id: "groceries",
      name: "Groceries",
      color: "#3f8f5a",
      icon: null
    }] as never,
    transaction: {
      id: "archived-booking",
      category_id: "groceries",
      counterparty: "Example payee",
      description: "",
      type: "expense",
      account_archived: true
    } as never
  }));

  assert.ok(screen.getByText("Groceries"));
  assert.equal(screen.queryByRole("combobox"), null);
  assert.equal(screen.queryAllByRole("button").length, 0);
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
      date: "2026-02-01"
    }
  }), refused);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);
  assert.equal((await listAccounts()).filter(account => account.archived_at).length, 0);

  await db.update(schema.accounts).set({
    balance_minor: 0
  }).where(eq(schema.accounts.id, "bank"));
  await archiveAccount("bank", {});
  assert.ok((await listAccounts()).find(account => account.id === "bank")?.archived_at);
});

test("closing a manual account books its balance away as an adjustment on the chosen date and archives it", async context => {
  const db = await seededDatabase(context);
  const cashFlowBefore = await readCashFlow(allMonthsPeriod, "EUR");

  await archiveAccount("open", {
    closing: {
      date: "2026-01-15"
    }
  });
  const open = (await listAccounts()).find(account => account.id === "open");
  const closing = await db.select().from(schema.transactions).where(and(eq(schema.transactions.account_id, "open"), eq(schema.transactions.type, "adjustment"))).get();

  assert.ok(open?.archived_at);
  assert.equal(open.balance_minor, 0);
  assert.equal(closing?.amount_minor, -50000);
  assert.equal(closing?.booking_date, "2026-01-15");
  assert.deepEqual(await readCashFlow(allMonthsPeriod, "EUR"), cashFlowBefore);
});

test("closing a manual account can transfer its balance to another active manual account in the same currency", async context => {
  const db = await seededDatabase(context);

  await archiveAccount("open", {
    closing: {
      date: "2026-01-15",
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
        transfer_account_id: target
      }
    }), ValidationError, target);
  }

  await assert.rejects(archiveAccount("open", {
    closing: {
      date: "2999-01-01"
    }
  }), ValidationError);
  assert.deepEqual(await db.select().from(schema.transactions), bookingsBefore);
  assert.equal((await listAccounts()).find(account => account.id === "open")?.archived_at, null);
});

test("archiving an unknown account or one of another banking environment is not found", async context => {
  await seededDatabase(context);

  await assert.rejects(archiveAccount("unknown", {}), {
    status: 404
  });
  await assert.rejects(archiveAccount("other-environment", {}), {
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

test("a bank-synced account with a balance of 0 is archived directly and offers no manual balance update", async context => {
  const bank = await renderDetails(context, {
    ...manualAccount,
    provider: "enable_banking",
    balance_minor: 0
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

test("a manual account with a remaining balance is closed through a dialog that cancel leaves unchanged", async context => {
  const {
    screen,
    requests
  } = await renderDetails(context, manualAccount);
  const openDialog = () => act(() => fireEvent.click(screen.getByRole("button", {
    name: "Archive account"
  })));

  openDialog();
  act(() => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {
    name: "Cancel"
  })));
  await wait(0);
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(requests("accounts/manual%2Fcash/archive").length, 0);

  openDialog();
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

  act(() => fireEvent.click(screen.getByRole("button", {
    name: "Archive account"
  })));
  const dialog = within(screen.getByRole("dialog"));

  assert.ok(dialog.getByText(/balance comes from the bank/));
  assert.deepEqual(dialog.getAllByRole("button").map(button => button.textContent).filter(text => text !== ""), ["Cancel"]);
  assert.equal(requests("accounts/manual%2Fcash/archive").length, 0);
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
