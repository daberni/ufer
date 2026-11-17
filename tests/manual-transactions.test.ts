import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { createManualAccount, updateManualValuation } from "../src/features/accounts/server/account-service";
import { listAccounts } from "../src/features/accounts/server/account-queries";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { importValuations } from "../src/features/imports/server/import-service";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { editManualTransaction, enterManualTransaction, removeManualTransaction, updateTransactionType } from "../src/features/transactions/server/transaction-service";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { monthPeriod } from "../src/lib/period";
import { HttpError, ValidationError } from "../src/lib/errors";

const now = Temporal.Instant.from("2026-10-31T12:00:00Z");

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
  await db.insert(schema.accounts).values({
    id: "checking",
    environment: "SANDBOX",
    name: "Synthetic checking",
    institution: "Example bank",
    kind: "checking",
    provider: "enable_banking"
  });

  return db;
}

async function manualAccount(name: string, balance: string, date = "2026-09-01") {
  const { id } = await createManualAccount({
    name,
    institution: "Example institution",
    kind: "savings",
    currency: "EUR",
    balance,
    date
  }, now);

  return id;
}

async function balanceOf(accountId: string) {
  return (await listAccounts()).find(account => account.id === accountId)?.balance_minor;
}

function enter(accountId: string, entry: Record<string, unknown>) {
  return enterManualTransaction(accountId, entry, now);
}

function edit(id: string, entry: Record<string, unknown>) {
  return editManualTransaction(id, entry, now);
}

async function row(db: Database, id: string) {
  return db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get();
}

/** The bookings of an account as [date, type, amount, counterparty, description], oldest first. */
async function bookings(db: Database, accountId: string) {
  const rows = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, accountId)).orderBy(schema.transactions.booking_date, schema.transactions.amount_minor);

  return rows.map(item => [item.booking_date, item.type, item.amount_minor, item.counterparty, item.description]);
}

async function transferLeg(db: Database, accountId: string) {
  const leg = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, accountId)).all();
  const transfer = leg.find(item => item.type === "transfer");

  assert.ok(transfer, accountId);

  return transfer;
}

/** A synced booking on the checking account, as a sync stores it. */
async function syncBooking(db: Database, reference: string, date: string, amount: number) {
  await saveAccountSync(db, {
    environment: "SANDBOX",
    startedAt: `${date}T08:00:00.000Z`
  }, "checking", "EUR", [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "1000.00",
      currency: "EUR"
    },
    reference_date: date
  }], [{
    reference: `bank:${reference}`,
    date,
    amount,
    currency: "EUR",
    counterparty: "Example counterparty",
    description: `Synthetic ${reference}`
  }], []);

  const booking = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, `bank:${reference}`)).get();

  assert.ok(booking);

  return booking;
}

test("a manual account's balance is its opening balance plus every transaction, including transfers and adjustments", async context => {
  const db = await isolatedDatabase(context);
  const cash = await manualAccount("Synthetic cash", "100.00");
  const purchase = await syncBooking(db, "purchase", "2026-09-10", -40000);

  await enter(cash, {
    booking_date: "2026-09-05",
    amount: "-12.50",
    counterparty: "Example bakery",
    type: "expense"
  });
  // The synced booking moved money into the cash account; its counterpart is created there.
  await updateTransactionType(purchase.id, {
    type: "transfer",
    transfer: {
      account_id: cash
    }
  });
  await updateManualValuation(cash, {
    balance: "500.00",
    date: "2026-09-20"
  }, now);

  assert.deepEqual(await bookings(db, cash), [
    ["2026-09-01", "opening_balance", 10000, "", ""],
    ["2026-09-05", "expense", -1250, "Example bakery", ""],
    ["2026-09-10", "transfer", 40000, "Synthetic checking", "Synthetic purchase"],
    ["2026-09-20", "adjustment", 1250, "", ""]
  ]);
  assert.equal(await balanceOf(cash), 50000);
  // A synced account keeps its provider balance.
  assert.equal(await balanceOf("checking"), 100000);
});

test("opening balances, adjustments and transfers stay out of income and spending; manual income and expenses count", async context => {
  const db = await isolatedDatabase(context);
  const cash = await manualAccount("Synthetic cash", "1000.00");
  const savings = await manualAccount("Synthetic savings", "0.00");

  await enter(cash, {
    booking_date: "2026-09-05",
    amount: "-30.00",
    type: "expense"
  });
  await enter(cash, {
    booking_date: "2026-09-06",
    amount: "15.00",
    type: "income"
  });
  await enter(cash, {
    booking_date: "2026-09-07",
    amount: "-200.00",
    type: "transfer",
    transfer: {
      account_id: savings
    }
  });
  await updateManualValuation(savings, {
    balance: "260.00",
    date: "2026-09-30"
  }, now);
  await updateManualValuation(cash, {
    balance: "700.00",
    date: "2026-09-30"
  }, now);

  const flow = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-09")), "EUR");

  assert.deepEqual([flow.income, flow.expenses], [1500, 3000]);
  assert.equal(await balanceOf(savings), 26000);
  assert.equal(await balanceOf(cash), 70000);
  assert.equal((await db.select().from(schema.transactions)).length, 8);
});

test("an entered transaction can be edited and deleted; imported bookings and future dates are refused", async context => {
  const db = await isolatedDatabase(context);
  const cash = await manualAccount("Synthetic cash", "100.00");
  const { id } = await enter(cash, {
    booking_date: "2026-09-05",
    amount: "-12.50",
    counterparty: "Example bakery",
    type: "expense"
  });

  await edit(id, {
    booking_date: "2026-09-06",
    amount: "-20.00",
    counterparty: "Example cafe",
    description: "Breakfast",
    type: "expense"
  });
  assert.deepEqual(await bookings(db, cash), [
    ["2026-09-01", "opening_balance", 10000, "", ""],
    ["2026-09-06", "expense", -2000, "Example cafe", "Breakfast"]
  ]);
  assert.equal(await balanceOf(cash), 8000);

  await assert.rejects(edit(id, {
    booking_date: "2026-11-01",
    amount: "-20.00",
    type: "expense"
  }), ValidationError);

  const synced = await syncBooking(db, "groceries", "2026-09-08", -4500);

  await assert.rejects(edit(synced.id, {
    booking_date: "2026-09-08",
    amount: "-1.00",
    type: "expense"
  }), ValidationError);
  await assert.rejects(removeManualTransaction(synced.id), ValidationError);
  await assert.rejects(removeManualTransaction("missing"), HttpError);

  await removeManualTransaction(id);
  assert.equal(await row(db, id), undefined);
  assert.equal(await balanceOf(cash), 10000);
  assert.ok(await row(db, synced.id));
});

test("a transfer between two manual accounts is edited from either side and the other side mirrors it", async context => {
  const db = await isolatedDatabase(context);
  const cash = await manualAccount("Synthetic cash", "1000.00");
  const savings = await manualAccount("Synthetic savings", "0.00");
  const { id } = await enter(cash, {
    booking_date: "2026-09-07",
    amount: "-200.00",
    counterparty: "Ignored for a transfer between own accounts",
    description: "Monthly saving",
    type: "transfer",
    transfer: {
      account_id: savings
    }
  });
  const created = await transferLeg(db, savings);

  assert.deepEqual([created.amount_minor, created.counterparty, created.description, created.booking_date], [20000, "Synthetic cash", "Monthly saving", "2026-09-07"]);
  assert.equal((await row(db, id))?.counterparty, "Synthetic savings");

  // From the source side: date, amount and description reach the other side.
  await edit(id, {
    booking_date: "2026-09-08",
    amount: "-250.00",
    description: "Saving September",
    type: "transfer",
    transfer: {
      account_id: savings
    }
  });
  // From the created side, including a change of direction, which the unique transfer-side index allows only once both sides are updated.
  await edit(created.id, {
    booking_date: "2026-09-09",
    amount: "-50.00",
    description: "Back to cash",
    type: "transfer",
    transfer: {
      account_id: cash
    }
  });

  assert.deepEqual(await bookings(db, cash), [
    ["2026-09-01", "opening_balance", 100000, "", ""],
    ["2026-09-09", "transfer", 5000, "Synthetic savings", "Back to cash"]
  ]);
  assert.deepEqual(await bookings(db, savings), [
    ["2026-09-01", "opening_balance", 0, "", ""],
    ["2026-09-09", "transfer", -5000, "Synthetic cash", "Back to cash"]
  ]);
  assert.equal((await row(db, id))?.transfer_id, (await row(db, created.id))?.transfer_id);
  assert.equal(await balanceOf(cash), 105000);
  assert.equal(await balanceOf(savings), -5000);

  const page = await readTransactionPage(dashboardFilters(new URLSearchParams({
    period: "2026-09"
  })));

  assert.ok(page.transactions.filter(item => item.type === "transfer").every(item => item.entered && !item.follows_import));
});

test("changing the other account from either side moves the other side of a manual transfer", async context => {
  const db = await isolatedDatabase(context);
  const cash = await manualAccount("Synthetic cash", "1000.00");
  const savings = await manualAccount("Synthetic savings", "0.00");
  const broker = await manualAccount("Synthetic broker", "0.00");
  const { id } = await enter(cash, {
    booking_date: "2026-09-07",
    amount: "-200.00",
    type: "transfer",
    transfer: {
      account_id: savings
    }
  });
  const created = await transferLeg(db, savings);

  // From the source side the created side moves to the broker.
  await updateTransactionType(id, {
    type: "transfer",
    transfer: {
      account_id: broker
    }
  });
  assert.deepEqual(await bookings(db, savings), [["2026-09-01", "opening_balance", 0, "", ""]]);
  const moved = await transferLeg(db, broker);

  assert.equal(moved.amount_minor, 20000);
  assert.equal((await row(db, id))?.counterparty, "Synthetic broker");

  // From the moved side the source moves from the cash account to savings; the booking keeps its identity.
  await edit(moved.id, {
    booking_date: "2026-09-07",
    amount: "200.00",
    type: "transfer",
    transfer: {
      account_id: savings
    }
  });

  const source = await row(db, id);

  assert.equal(source?.account_id, savings);
  assert.equal(source?.counterparty, "Synthetic broker");
  assert.equal((await row(db, moved.id))?.counterparty, "Synthetic savings");
  assert.deepEqual(await bookings(db, cash), [["2026-09-01", "opening_balance", 100000, "", ""]]);
  assert.equal(await balanceOf(savings), -20000);
  assert.equal(await balanceOf(broker), 20000);
  assert.equal(moved.id, created.id);

  await assert.rejects(edit(moved.id, {
    booking_date: "2026-09-07",
    amount: "200.00",
    type: "transfer",
    transfer: {
      account_id: broker
    }
  }), /two different accounts/);
});

test("removing a manual transfer from either side removes both sides; leaving it removes the other side", async context => {
  const db = await isolatedDatabase(context);
  const cash = await manualAccount("Synthetic cash", "1000.00");
  const savings = await manualAccount("Synthetic savings", "0.00");

  async function transfer() {
    const { id } = await enter(cash, {
      booking_date: "2026-09-07",
      amount: "-200.00",
      type: "transfer",
      transfer: {
        account_id: savings
      }
    });

    const transferId = (await row(db, id))?.transfer_id;
    const created = (await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, savings))).find(item => item.transfer_id === transferId);

    assert.ok(transferId && created);

    return {
      source: id,
      created: created.id
    };
  }

  const first = await transfer();

  await removeManualTransaction(first.created);
  assert.equal(await row(db, first.source), undefined);
  assert.equal(await row(db, first.created), undefined);

  const second = await transfer();

  await removeManualTransaction(second.source);
  assert.equal(await row(db, second.created), undefined);

  // Choosing no other account on the created side keeps it as a transfer to an untracked account and removes the source; it becomes an ordinary entry.
  const third = await transfer();

  await updateTransactionType(third.created, {
    type: "transfer",
    transfer: null
  });
  const remaining = await row(db, third.created);

  assert.equal(await row(db, third.source), undefined);
  assert.deepEqual([remaining?.type, remaining?.transfer_id, remaining?.provider_reference], ["transfer", null, `manual:${third.created}`]);

  // Another type on either side removes the other side as well.
  const fourth = await transfer();

  await edit(fourth.source, {
    booking_date: "2026-09-07",
    amount: "-200.00",
    type: "expense"
  });
  assert.equal(await row(db, fourth.created), undefined);
  assert.deepEqual([(await row(db, fourth.source))?.type, (await row(db, fourth.source))?.transfer_id], ["expense", null]);
  assert.equal(await balanceOf(cash), 100000 - 20000);
  assert.equal(await balanceOf(savings), 20000);
});

test("an entered booking linked with a synced booking follows its date and amount, and a counterpart created for it is only removed", async context => {
  const db = await isolatedDatabase(context);
  const cash = await manualAccount("Synthetic cash", "0.00");
  const withdrawal = await syncBooking(db, "withdrawal", "2026-09-10", -10000);
  const { id } = await enter(cash, {
    booking_date: "2026-09-10",
    amount: "100.00",
    type: "transfer",
    transfer: {
      counterpart_id: withdrawal.id
    }
  });

  assert.equal((await row(db, id))?.transfer_id, (await row(db, withdrawal.id))?.transfer_id);
  await assert.rejects(edit(id, {
    booking_date: "2026-09-10",
    amount: "90.00",
    type: "transfer"
  }), /keeps its date and amount/);
  await edit(id, {
    booking_date: "2026-09-10",
    amount: "100.00",
    counterparty: "Cash machine",
    description: "Withdrawal",
    type: "transfer"
  });
  assert.equal((await row(db, id))?.description, "Withdrawal");

  // Deleting the entered side leaves the synced booking a transfer without a counterpart.
  await removeManualTransaction(id);
  assert.deepEqual([(await row(db, withdrawal.id))?.type, (await row(db, withdrawal.id))?.transfer_id], ["transfer", null]);

  // A counterpart Ufer created for a synced booking follows it: it cannot be edited as an entry, only removed.
  const purchase = await syncBooking(db, "deposit", "2026-09-12", -5000);

  await updateTransactionType(purchase.id, {
    type: "transfer",
    transfer: {
      account_id: cash
    }
  });
  const created = await transferLeg(db, cash);

  await assert.rejects(edit(created.id, {
    booking_date: "2026-09-12",
    amount: "50.00",
    type: "transfer"
  }), /entered in Ufer/);
  await assert.rejects(updateTransactionType(created.id, {
    type: "transfer",
    transfer: {
      account_id: "checking"
    }
  }), ValidationError);
  await removeManualTransaction(created.id);
  assert.deepEqual([(await row(db, purchase.id))?.type, (await row(db, purchase.id))?.transfer_id], ["transfer", null]);
});

test("imported balances become adjustments for the difference on their date, and importing them again books nothing", async context => {
  const db = await isolatedDatabase(context);
  const fund = await manualAccount("Synthetic fund", "1000.00", "2026-01-01");
  const csv = "date,balance,currency\n2026-03-31,1100.00,EUR\n2026-06-30,1050.00,EUR\n2026-09-30,1200.00,EUR";

  await enter(fund, {
    booking_date: "2026-05-15",
    amount: "100.00",
    type: "transfer",
    transfer: null
  });
  await importValuations({
    account_id: fund,
    csv
  });
  await importValuations({
    account_id: fund,
    csv
  });

  assert.deepEqual(await bookings(db, fund), [
    ["2026-01-01", "opening_balance", 100000, "", ""],
    ["2026-03-31", "adjustment", 10000, "", ""],
    ["2026-05-15", "transfer", 10000, "", ""],
    ["2026-06-30", "adjustment", -15000, "", ""],
    ["2026-09-30", "adjustment", 15000, "", ""]
  ]);
  assert.equal(await balanceOf(fund), 120000);
  assert.equal((await db.select().from(schema.balanceSnapshots)).length, 0);
});
