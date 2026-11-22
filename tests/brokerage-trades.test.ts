import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { createManualAccount, deleteAccount } from "../src/features/accounts/server/account-service";
import { listAccounts } from "../src/features/accounts/server/account-queries";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { enterManualTransaction, hideTransaction, removeManualTransaction, updateTransactionDetails } from "../src/features/transactions/server/transaction-service";
import { createBrokerageAccount, createSecurity, readBrokerageTrades, recordTrade, removeTrade, settlementCandidates } from "../src/features/securities/server/security-service";
import { monthPeriod } from "../src/lib/period";
import { HttpError, ValidationError } from "../src/lib/errors";

const now = Temporal.Instant.from("2026-10-31T12:00:00Z");

async function isolatedDatabase(context: TestContext, queries?: string[]) {
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
    schema,
    logger: queries ? {
      logQuery: query => queries.push(query)
    } : undefined
  });

  globals.budgetDb = Promise.resolve(db);
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";
  await db.insert(schema.accounts).values({
    id: "checking",
    name: "Synthetic checking",
    kind: "checking",
    provider: "enable_banking"
  });

  return db;
}

async function settlementAccount(currency = "EUR") {
  const { id } = await createManualAccount({
    name: "Synthetic settlement",
    kind: "checking",
    currency,
    balance: "5000.00",
    date: "2026-09-01"
  }, now);

  return id;
}

async function depot(currency = "EUR") {
  const { id } = await createBrokerageAccount({
    name: "Synthetic depot",
    currency
  });

  return id;
}

async function security(currency = "EUR", symbol: string | null = "SYN.XETRA") {
  const { id } = await createSecurity({
    name: "Synthetic World ETF",
    currency,
    isin: "XS0000000001",
    provider_symbol: symbol
  });

  return id;
}

function trade(accountId: string, input: Record<string, unknown>) {
  return recordTrade(accountId, input, now);
}

async function bookingsOf(db: Database, accountId: string) {
  const rows = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, accountId)).orderBy(schema.transactions.date, schema.transactions.amount_minor);

  return rows.map(row => [row.date, row.type, row.amount_minor]);
}

async function balanceOf(accountId: string) {
  return (await listAccounts()).find(account => account.id === accountId)?.balance_minor;
}

async function rejectsWith(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, error => error instanceof HttpError && error.status === status);
}

/** A synced booking on the checking account, as a sync stores it. */
async function syncBooking(db: Database, reference: string, date: string, amount: number) {
  await saveAccountSync({
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

test("a buy on a manual settlement account books its cash side as a buy that counts toward no income or spending", async context => {
  const db = await isolatedDatabase(context);
  const cash = await settlementAccount();
  const account = await depot();
  const etf = await security();

  const { id } = await trade(account, {
    security_id: etf,
    date: "2026-09-10",
    side: "buy",
    quantity: "10",
    price: "100.25",
    fee: "4.90",
    settlement: {
      account_id: cash
    }
  });

  const stored = await db.select().from(schema.securityTrades).where(eq(schema.securityTrades.id, id)).get();

  assert.equal(stored?.gross_minor, 1002_50);
  assert.equal(stored?.fee_minor, 4_90);
  assert.equal(stored?.sequence, 1);
  assert.deepEqual(await bookingsOf(db, cash), [["2026-09-01", "opening_balance", 5000_00], ["2026-09-10", "buy", -1007_40]]);
  assert.equal(await balanceOf(cash), 5000_00 - 1007_40);
  assert.deepEqual(await bookingsOf(db, account), []);

  const flow = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-09")), "EUR");

  assert.deepEqual([flow.income, flow.expenses], [0, 0]);
});

test("a partial sale keeps the moving-average cost of the rest and realizes its gain; sale taxes move cash only", async context => {
  const db = await isolatedDatabase(context);
  const cash = await settlementAccount();
  const account = await depot();
  const etf = await security();
  const settlement = {
    account_id: cash
  };

  await trade(account, {
    security_id: etf,
    date: "2026-09-01",
    side: "buy",
    quantity: "10",
    price: "100",
    fee: "5",
    settlement
  });
  await trade(account, {
    security_id: etf,
    date: "2026-09-15",
    side: "buy",
    quantity: "10",
    price: "120",
    fee: "5",
    settlement
  });
  await trade(account, {
    security_id: etf,
    date: "2026-10-01",
    side: "sell",
    quantity: "5",
    price: "140",
    fee: "4",
    tax: "20",
    settlement
  });

  const {
    positions,
    trades
  } = await readBrokerageTrades(account, now);

  assert.deepEqual(trades.map(item => item.sequence), [1, 2, 3]);
  assert.deepEqual(positions, [{
    security_id: etf,
    security_name: "Synthetic World ETF",
    quantity_micros: 15_000_000,
    cost_minor: 1657_50,
    realized_minor: 700_00 - 4_00 - 552_50
  }]);
  assert.deepEqual((await bookingsOf(db, cash)).at(-1), ["2026-10-01", "sell", 700_00 - 4_00 - 20_00]);
});

test("a sale beyond the held quantity and a deletion that would cause one are refused without writing anything", async context => {
  const db = await isolatedDatabase(context);
  const cash = await settlementAccount();
  const account = await depot();
  const etf = await security();
  const settlement = {
    account_id: cash
  };
  const buy = await trade(account, {
    security_id: etf,
    date: "2026-09-01",
    side: "buy",
    quantity: "3",
    price: "100",
    settlement
  });

  await assert.rejects(trade(account, {
    security_id: etf,
    date: "2026-09-02",
    side: "sell",
    quantity: "4",
    price: "100",
    settlement
  }), ValidationError);
  // A sale dated before the buy is checked in replay order too.
  await assert.rejects(trade(account, {
    security_id: etf,
    date: "2026-08-31",
    side: "sell",
    quantity: "1",
    price: "100",
    settlement
  }), ValidationError);
  assert.equal((await db.select().from(schema.securityTrades)).length, 1);
  assert.equal((await bookingsOf(db, cash)).length, 2);

  const sell = await trade(account, {
    security_id: etf,
    date: "2026-09-05",
    side: "sell",
    quantity: "3",
    price: "110",
    settlement
  });

  await assert.rejects(removeTrade(buy.id), ValidationError);
  await removeTrade(sell.id);
  await removeTrade(buy.id);
  assert.deepEqual(await bookingsOf(db, cash), [["2026-09-01", "opening_balance", 5000_00]]);
  assert.equal((await db.select().from(schema.securityTrades)).length, 0);
});

test("a bank booking becomes a trade's cash side, keeps that type across a resync and returns to its own type when the trade is deleted", async context => {
  const db = await isolatedDatabase(context);
  const account = await depot();
  const etf = await security();
  const booking = await syncBooking(db, "broker-debit", "2026-09-12", -1007_40);
  const input = {
    security_id: etf,
    date: "2026-09-10",
    side: "buy",
    quantity: "10",
    price: "100.25",
    fee: "4.90",
    settlement: {
      transaction_id: booking.id
    }
  };

  assert.deepEqual((await settlementCandidates(account, new URLSearchParams({
    date: "2026-09-10",
    amount_minor: "-100740"
  }))).map(candidate => candidate.id), [booking.id]);
  await assert.rejects(trade(account, {
    ...input,
    fee: "4.80"
  }), ValidationError);
  await assert.rejects(trade(account, {
    ...input,
    settlement: {
      account_id: "checking"
    }
  }), ValidationError);

  const { id } = await trade(account, input);
  let stored = await db.select().from(schema.transactions).where(eq(schema.transactions.id, booking.id)).get();

  assert.deepEqual([stored?.type, stored?.type_source, stored?.amount_minor], ["buy", "manual", -1007_40]);
  assert.deepEqual(await settlementCandidates(account, new URLSearchParams({
    date: "2026-09-10",
    amount_minor: "-100740"
  })), []);

  await syncBooking(db, "broker-debit", "2026-09-12", -1007_40);
  stored = await db.select().from(schema.transactions).where(eq(schema.transactions.id, booking.id)).get();
  assert.equal(stored?.type, "buy");

  const flow = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-09")), "EUR");

  assert.equal(flow.expenses, 0);

  await removeTrade(id);
  stored = await db.select().from(schema.transactions).where(eq(schema.transactions.id, booking.id)).get();
  assert.deepEqual([stored?.type, stored?.type_source], ["expense", "auto"]);
});

test("a trade's cash side cannot be edited, retyped, hidden, linked or deleted on its own", async context => {
  const db = await isolatedDatabase(context);
  const cash = await settlementAccount();
  const other = await settlementAccount();
  const account = await depot();
  const etf = await security();
  const booking = await syncBooking(db, "broker-debit", "2026-09-12", -500_00);

  await trade(account, {
    security_id: etf,
    date: "2026-09-10",
    side: "buy",
    quantity: "5",
    price: "100",
    settlement: {
      transaction_id: booking.id
    }
  });
  await trade(account, {
    security_id: etf,
    date: "2026-09-11",
    side: "buy",
    quantity: "1",
    price: "100",
    settlement: {
      account_id: cash
    }
  });

  const [entered] = (await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, cash))).filter(row => row.type === "buy");

  await rejectsWith(updateTransactionDetails(booking.id, {
    type: "expense"
  }), 409);
  await rejectsWith(updateTransactionDetails(booking.id, {
    type: "transfer",
    transfer: {
      account_id: other
    }
  }), 409);
  await rejectsWith(hideTransaction(booking.id, true, now), 409);
  await rejectsWith(removeManualTransaction(entered.id), 409);

  // A transfer of the opposite amount on another account must not link with the trade's cash side.
  const { id: incoming } = await enterManualTransaction(other, {
    date: "2026-09-12",
    amount: "500.00",
    type: "income"
  }, now);

  await assert.rejects(updateTransactionDetails(incoming, {
    type: "transfer",
    transfer: {
      counterpart_id: booking.id
    }
  }), ValidationError);
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, booking.id)).get())?.type, "buy");
});

test("a brokerage account takes no bookings, balances or transfers, and is deleted only without trades", async context => {
  await isolatedDatabase(context);
  const cash = await settlementAccount();
  const account = await depot();
  const etf = await security();

  await rejectsWith(enterManualTransaction(account, {
    date: "2026-09-12",
    amount: "10.00",
    type: "income"
  }, now), 404);

  const { id: payment } = await enterManualTransaction(cash, {
    date: "2026-09-12",
    amount: "-10.00",
    type: "expense"
  }, now);

  await assert.rejects(updateTransactionDetails(payment, {
    type: "transfer",
    transfer: {
      account_id: account
    }
  }), ValidationError);

  const { id } = await trade(account, {
    security_id: etf,
    date: "2026-09-10",
    side: "buy",
    quantity: "1",
    price: "10",
    settlement: {
      account_id: cash
    }
  });

  await rejectsWith(deleteAccount(account, {
    name: "Synthetic depot"
  }), 409);
  await removeTrade(id);
  await deleteAccount(account, {
    name: "Synthetic depot"
  });
});

test("trades refuse other currencies, future dates and a missing security", async context => {
  await isolatedDatabase(context);
  const cash = await settlementAccount();
  const usd = await settlementAccount("USD");
  const account = await depot();
  const etf = await security();
  const dollarEtf = await security("USD", "SYN.US");
  const base = {
    security_id: etf,
    date: "2026-09-10",
    side: "buy",
    quantity: "1",
    price: "10",
    settlement: {
      account_id: cash
    }
  };

  await assert.rejects(trade(account, {
    ...base,
    security_id: dollarEtf
  }), ValidationError);
  await assert.rejects(trade(account, {
    ...base,
    settlement: {
      account_id: usd
    }
  }), ValidationError);
  await assert.rejects(trade(account, {
    ...base,
    date: "2026-11-01"
  }), ValidationError);
  await assert.rejects(trade(account, {
    ...base,
    security_id: "missing"
  }), ValidationError);
  await assert.rejects(trade(account, {
    ...base,
    quantity: "0.0000001"
  }), ValidationError);
  await assert.rejects(createSecurity({
    name: "Duplicate listing",
    currency: "EUR",
    provider_symbol: "SYN.XETRA"
  }), HttpError);
});
