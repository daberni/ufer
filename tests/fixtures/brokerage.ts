import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../../src/server/database/connection";
import { initializeDatabase } from "../../src/server/database/migrations";
import * as schema from "../../src/server/database/schema";
import { createManualAccount } from "../../src/features/accounts/server/account-service";
import { listAccounts } from "../../src/features/accounts/server/account-queries";
import { saveAccountSync } from "../../src/features/banking/server/account-sync-service";
import { createBrokerageAccount, createSecurity, recordTrade } from "../../src/features/securities/server/security-service";
import { HttpError } from "../../src/lib/errors";

// Shared setup for brokerage tests: an isolated database with a bank-linked "checking" account, synthetic settlement and brokerage accounts and securities.
export const now = Temporal.Instant.from("2026-10-31T12:00:00Z");

export async function isolatedDatabase(context: TestContext, queries?: string[]) {
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

export async function settlementAccount(currency = "EUR") {
  const { id } = await createManualAccount({
    name: "Synthetic settlement",
    kind: "checking",
    currency,
    balance: "5000.00",
    date: "2026-09-01"
  }, now);

  return id;
}

export async function depot(currency = "EUR") {
  const { id } = await createBrokerageAccount({
    name: "Synthetic depot",
    currency
  });

  return id;
}

export async function security(currency = "EUR", symbol: string | null = "SYN.XETRA", isin = "XS0000000009") {
  const { id } = await createSecurity({
    name: "Synthetic World ETF",
    currency,
    isin,
    provider_symbol: symbol
  });

  return id;
}

export function trade(accountId: string, input: Record<string, unknown>) {
  return recordTrade(accountId, input, now);
}

export async function bookingsOf(db: Database, accountId: string) {
  const rows = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, accountId)).orderBy(schema.transactions.date, schema.transactions.amount_minor);

  return rows.map(row => [row.date, row.type, row.amount_minor]);
}

export async function balanceOf(accountId: string) {
  return (await listAccounts(now)).find(account => account.id === accountId)?.balance_minor;
}

export async function rejectsWith(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, error => error instanceof HttpError && error.status === status);
}

/** A synced booking on the checking account, as a sync stores it. */
export async function syncBooking(db: Database, reference: string, date: string, amount: number) {
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
