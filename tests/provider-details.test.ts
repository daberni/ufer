import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { normalizeTransactions } from "../src/features/banking/server/bank-data";
import { maximumPayloadBytes } from "../src/features/banking/server/provider-details";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import type { BankTransaction } from "../src/features/banking/server/enable-banking-client";
import type { Rule } from "../src/lib/rules";

const basic: BankTransaction = {
  entry_reference: "synthetic-1",
  status: "BOOK",
  booking_date: "2026-11-12",
  transaction_amount: {
    amount: "12.50",
    currency: "EUR"
  },
  credit_debit_indicator: "DBIT",
  creditor: {
    name: "Example Market"
  },
  remittance_information: ["Synthetic purchase"]
};

const instructedRate = {
  instructed_amount: {
    amount: "13.40",
    currency: "USD"
  }
};

// A foreign-currency card payment as a bank may deliver it; fields Ufer does not read are kept only in the raw JSON.
const foreign: BankTransaction = {
  ...basic,
  exchange_rate: instructedRate
};

const delivered = {
  ...foreign,
  value_date: "2026-11-13",
  bank_transaction_code: {
    code: "CCRD",
    sub_code: "POSD"
  },
  merchant_category_code: "5411",
  exchange_rate: {
    ...instructedRate,
    exchange_rate: "1.0720",
    rate_type: "SPOT"
  }
} as BankTransaction;

function normalized(transaction: BankTransaction) {
  return normalizeTransactions([transaction], new Set())[0];
}

function withExchangeRate(exchangeRate: unknown) {
  return {
    ...basic,
    exchange_rate: exchangeRate
  } as BankTransaction;
}

test("the original amount is signed by the booking direction and the complete provider transaction is stored as JSON", () => {
  const outgoing = normalized(delivered);
  const incoming = normalized({
    ...delivered,
    credit_debit_indicator: "CRDT"
  });

  assert.equal(outgoing.amount, -1250);
  assert.equal(outgoing.provider?.instructedAmount, -1340);
  assert.equal(outgoing.provider?.instructedCurrency, "USD");
  assert.deepEqual(JSON.parse(outgoing.provider?.payload ?? ""), delivered);
  assert.equal(incoming.amount, 1250);
  assert.equal(incoming.provider?.instructedAmount, 1340);
});

test("a booking without an instructed amount keeps only its raw JSON", () => {
  for (const transaction of [basic, withExchangeRate({}), withExchangeRate({
    exchange_rate: "1.0720"
  })]) {
    const provider = normalized(transaction).provider;

    assert.deepEqual(Object.keys(provider ?? {}), ["payload"]);
    assert.deepEqual(JSON.parse(provider?.payload ?? ""), transaction);
  }
});

test("a malformed instructed amount is dropped without stopping the import of the transaction", () => {
  const malformed = [withExchangeRate("13.40 USD"), withExchangeRate({
    instructed_amount: "13.40"
  }), withExchangeRate({
    instructed_amount: {
      amount: 13.4,
      currency: "USD"
    }
  }), withExchangeRate({
    instructed_amount: {
      amount: "13,40",
      currency: "USD"
    }
  }), withExchangeRate({
    instructed_amount: {
      amount: "13.405",
      currency: "USD"
    }
  }), withExchangeRate({
    instructed_amount: {
      amount: "-13.40",
      currency: "USD"
    }
  }), withExchangeRate({
    instructed_amount: {
      amount: "13.40",
      currency: "XXX"
    }
  })];

  for (const transaction of malformed) {
    const entry = normalized(transaction);

    assert.equal(entry.amount, -1250, JSON.stringify(transaction.exchange_rate));
    assert.equal(entry.reference, "bank:synthetic-1");
    assert.deepEqual(Object.keys(entry.provider ?? {}), ["payload"], JSON.stringify(transaction.exchange_rate));
  }
});

test("a provider transaction above the size limit keeps its original amount but not its raw JSON", () => {
  const oversized = normalized({
    ...foreign,
    remittance_information: ["x".repeat(maximumPayloadBytes)]
  });

  assert.equal(oversized.provider?.payload, undefined);
  assert.equal(oversized.provider?.instructedAmount, -1340);
});

async function isolatedDatabase(context: TestContext) {
  const client = await initializeDatabase(createClient({
    url: ":memory:"
  }));
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousEnvironment = process.env.ENABLE_BANKING_ENVIRONMENT;
  const db = drizzle(client, {
    schema
  });

  context.after(() => {
    globals.budgetDb = previousDatabase;

    if (previousEnvironment === undefined) {
      delete process.env.ENABLE_BANKING_ENVIRONMENT;
    } else {
      process.env.ENABLE_BANKING_ENVIRONMENT = previousEnvironment;
    }

    client.close();
  });

  globals.budgetDb = Promise.resolve(db);
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";

  return db;
}

const balances = [{
  balance_type: "CLBD",
  balance_amount: {
    amount: "100.00",
    currency: "EUR"
  },
  reference_date: "2026-11-12"
}];

const rules: Rule[] = [{
  id: "market",
  name: "Market",
  pattern: "Market",
  mode: "keyword",
  category_id: "groceries",
  priority: 100,
  enabled: 1
}];

function syncRun(startedAt: string) {
  return {
    startedAt
  };
}

async function storedDetails(db: Database) {
  const rows = await db.$client.execute("SELECT provider_reference,category_id,category_source,instructed_amount_minor,instructed_currency,provider_payload FROM transactions ORDER BY provider_reference");

  return rows.rows.map(row => ({
    reference: row.provider_reference,
    category: row.category_id,
    source: row.category_source,
    instructedAmount: row.instructed_amount_minor,
    instructedCurrency: row.instructed_currency,
    merchantCategoryCode: row.provider_payload === null ? null : JSON.parse(String(row.provider_payload)).merchant_category_code ?? "absent"
  }));
}

test("a resync refreshes the original amount and raw JSON of rule-sourced and manual rows without changing manual categories", async context => {
  const db = await isolatedDatabase(context);

  await db.$client.execute("INSERT INTO accounts(id,name,institution,kind,currency) VALUES('a','Synthetic checking','Example Bank','checking','EUR')");
  const first = normalizeTransactions([delivered, {
    ...basic,
    entry_reference: "synthetic-2"
  }], new Set());

  await saveAccountSync(db, syncRun("2026-11-12T08:00:00.000Z"), "a", "EUR", balances, first, rules);
  assert.deepEqual(await storedDetails(db), [{
    reference: "bank:synthetic-1",
    category: "groceries",
    source: "rule",
    instructedAmount: -1340,
    instructedCurrency: "USD",
    merchantCategoryCode: "5411"
  }, {
    reference: "bank:synthetic-2",
    category: "groceries",
    source: "rule",
    instructedAmount: null,
    instructedCurrency: null,
    merchantCategoryCode: "absent"
  }]);

  await db.$client.execute("UPDATE transactions SET category_id='leisure',category_source='manual' WHERE provider_reference='bank:synthetic-1'");
  const second = normalizeTransactions([{
    ...basic,
    merchant_category_code: "5812"
  } as BankTransaction, {
    ...foreign,
    entry_reference: "synthetic-2",
    merchant_category_code: "5999"
  } as BankTransaction], new Set());

  await saveAccountSync(db, syncRun("2026-11-13T08:00:00.000Z"), "a", "EUR", balances, second, rules);
  assert.deepEqual(await storedDetails(db), [{
    reference: "bank:synthetic-1",
    category: "leisure",
    source: "manual",
    instructedAmount: null,
    instructedCurrency: null,
    merchantCategoryCode: "5812"
  }, {
    reference: "bank:synthetic-2",
    category: "groceries",
    source: "rule",
    instructedAmount: -1340,
    instructedCurrency: "USD",
    merchantCategoryCode: "5999"
  }]);
});

test("the transaction list returns the original amount and currency only for bookings that carry one", async context => {
  const db = await isolatedDatabase(context);

  await db.$client.execute("INSERT INTO accounts(id,name,institution,kind,currency) VALUES('a','Synthetic checking','Example Bank','checking','EUR')");
  await saveAccountSync(db, syncRun("2026-11-12T08:00:00.000Z"), "a", "EUR", balances, normalizeTransactions([foreign, {
    ...basic,
    entry_reference: "synthetic-2"
  }], new Set()), rules);
  const page = await readTransactionPage(dashboardFilters(new URLSearchParams({
    period: "2026-11"
  })));
  const originals = page.transactions.map(transaction => [transaction.instructed_amount_minor, transaction.instructed_currency]);

  assert.deepEqual(originals.sort(), [[null, null], [-1340, "USD"]]);
});

test("an original amount in a currency outside the pinned list is kept", () => {
  const entry = normalized(withExchangeRate({
    instructed_amount: {
      amount: "18.20",
      currency: "CAD"
    }
  }));

  assert.equal(entry.provider?.instructedAmount, -1820);
  assert.equal(entry.provider?.instructedCurrency, "CAD");
});
