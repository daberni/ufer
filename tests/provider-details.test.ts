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
import { dashboardFilters } from "../src/features/dashboard/server/dashboard-filters";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import type { BankTransaction } from "../src/features/banking/server/enable-banking-client";
import type { ProviderDetails } from "../src/features/transactions/server/transaction-entry";
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

// Every optional field the bank can deliver, with synthetic values; the debtor side is the booked account itself.
const complete: BankTransaction = {
  ...basic,
  value_date: "2026-11-13",
  transaction_date: "2026-11-11",
  bank_transaction_code: {
    code: "CCRD",
    sub_code: "POSD",
    description: "Card payment"
  },
  merchant_category_code: "5411",
  exchange_rate: {
    unit_currency: "USD",
    exchange_rate: "1.0720",
    rate_type: "SPOT",
    instructed_amount: {
      amount: "13.40",
      currency: "USD"
    }
  },
  balance_after_transaction: {
    amount: "-40.25",
    currency: "EUR"
  },
  reference_number: "RF18 5390 0754 7034",
  creditor_account: {
    iban: "de89 3704 0044 0532 0130 00",
    other: {
      identification: "MERCHANT-ACCOUNT-1",
      scheme_name: "BBAN"
    }
  },
  creditor_agent: {
    bic_fi: "cobadeffxxx"
  },
  debtor_account: {
    iban: "AT611904300234573201"
  },
  debtor_agent: {
    bic_fi: "BKAUATWW"
  }
};

const completeDetails: Required<Omit<ProviderDetails, "payload">> = {
  valueDate: "2026-11-13",
  transactionDate: "2026-11-11",
  bankTransactionCode: "CCRD",
  bankTransactionSubCode: "POSD",
  bankTransactionDescription: "Card payment",
  merchantCategoryCode: "5411",
  exchangeRate: "1.0720",
  exchangeRateUnitCurrency: "USD",
  exchangeRateType: "SPOT",
  instructedAmount: -1340,
  instructedCurrency: "USD",
  balanceAfter: -4025,
  balanceAfterCurrency: "EUR",
  referenceNumber: "RF18 5390 0754 7034",
  counterpartyIban: "DE89370400440532013000",
  counterpartyAccountId: "MERCHANT-ACCOUNT-1",
  counterpartyAccountScheme: "BBAN",
  counterpartyBic: "COBADEFFXXX"
};

// Which stored details disappear when the bank omits a provider field.
const detailsByField: Partial<Record<keyof BankTransaction, (keyof ProviderDetails)[]>> = {
  value_date: ["valueDate"],
  transaction_date: ["transactionDate"],
  bank_transaction_code: ["bankTransactionCode", "bankTransactionSubCode", "bankTransactionDescription"],
  merchant_category_code: ["merchantCategoryCode"],
  exchange_rate: ["exchangeRate", "exchangeRateUnitCurrency", "exchangeRateType", "instructedAmount", "instructedCurrency"],
  balance_after_transaction: ["balanceAfter", "balanceAfterCurrency"],
  reference_number: ["referenceNumber"],
  creditor_account: ["counterpartyIban", "counterpartyAccountId", "counterpartyAccountScheme"],
  creditor_agent: ["counterpartyBic"]
};

function normalized(transaction: BankTransaction) {
  return normalizeTransactions([transaction], new Set())[0];
}

function withoutPayload(details: ProviderDetails | undefined) {
  const {
    payload,
    ...fields
  } = details ?? {};

  assert.equal(typeof payload, "string");

  return fields;
}

function omitted(field: keyof BankTransaction): BankTransaction {
  const transaction = structuredClone(complete);

  delete transaction[field];

  return transaction;
}

test("every optional provider field is kept, the counterparty is the side opposite the booked account and the raw transaction is stored", () => {
  const entry = normalized(complete);

  assert.deepEqual(withoutPayload(entry.provider), completeDetails);
  assert.deepEqual(JSON.parse(entry.provider?.payload ?? ""), complete);
  assert.equal(entry.amount, -1250);
  assert.equal(entry.currency, "EUR");

  const incoming = normalized({
    ...complete,
    credit_debit_indicator: "CRDT"
  });

  assert.equal(incoming.provider?.instructedAmount, 1340);
  assert.equal(incoming.provider?.counterpartyIban, "AT611904300234573201");
  assert.equal(incoming.provider?.counterpartyBic, "BKAUATWW");
  assert.equal(incoming.provider?.counterpartyAccountId, undefined);
});

test("omitting any optional provider field drops only the details derived from it", () => {
  for (const [field, removed] of Object.entries(detailsByField) as [keyof BankTransaction, (keyof ProviderDetails)[]][]) {
    const expected: ProviderDetails = {
      ...completeDetails
    };

    for (const key of removed) {
      delete expected[key];
    }

    assert.deepEqual(withoutPayload(normalized(omitted(field)).provider), expected, `without ${field}`);
  }

  assert.deepEqual(withoutPayload(normalized(basic).provider), {});
});

test("malformed optional fields are dropped without stopping the import of the transaction", () => {
  const malformed = {
    ...complete,
    value_date: "2026-02-30",
    transaction_date: 20261111,
    bank_transaction_code: {
      code: "",
      sub_code: "POSD",
      description: "x".repeat(501)
    },
    merchant_category_code: "54A1",
    exchange_rate: {
      unit_currency: "usd",
      exchange_rate: "1,0720",
      rate_type: "FIXED",
      instructed_amount: {
        amount: "13.40",
        currency: "XXX"
      }
    },
    balance_after_transaction: {
      amount: "-40.255",
      currency: "EUR"
    },
    reference_number: "x".repeat(141),
    creditor_account: {
      iban: "not an IBAN",
      other: {
        identification: "MERCHANT-ACCOUNT-1"
      }
    },
    creditor_agent: "COBADEFFXXX"
  } as unknown as BankTransaction;
  const entry = normalized(malformed);

  assert.deepEqual(withoutPayload(entry.provider), {
    bankTransactionSubCode: "POSD"
  });
  assert.equal(entry.amount, -1250);
  assert.equal(entry.reference, "bank:synthetic-1");

  const negativeInstructed = normalized({
    ...complete,
    exchange_rate: {
      ...complete.exchange_rate,
      instructed_amount: {
        amount: "-13.40",
        currency: "USD"
      }
    }
  });

  assert.equal(negativeInstructed.provider?.instructedAmount, undefined);
  assert.equal(negativeInstructed.provider?.exchangeRate, "1.0720");

  const oversized = normalized({
    ...complete,
    remittance_information: ["x".repeat(maximumPayloadBytes)]
  });

  assert.equal(oversized.provider?.payload, undefined);
  assert.equal(oversized.provider?.merchantCategoryCode, "5411");
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
    environment: "SANDBOX",
    startedAt
  };
}

async function storedDetails(db: Database) {
  const rows = await db.$client.execute("SELECT provider_reference,category_id,category_source,merchant_category_code,instructed_amount_minor,instructed_currency,value_date,provider_payload FROM transactions ORDER BY provider_reference");

  return rows.rows.map(row => ({
    reference: row.provider_reference,
    category: row.category_id,
    source: row.category_source,
    merchantCategoryCode: row.merchant_category_code,
    instructedAmount: row.instructed_amount_minor,
    instructedCurrency: row.instructed_currency,
    valueDate: row.value_date,
    payload: row.provider_payload === null ? null : JSON.parse(String(row.provider_payload)).merchant_category_code ?? "absent"
  }));
}

test("a resync refreshes provider details and the raw payload of rule-sourced and manual rows without changing manual categories", async context => {
  const db = await isolatedDatabase(context);

  await db.$client.execute("INSERT INTO accounts(id,environment,name,institution,kind,currency) VALUES('a','SANDBOX','Synthetic checking','Example Bank','checking','EUR')");
  const first = normalizeTransactions([complete, {
    ...basic,
    entry_reference: "synthetic-2"
  }], new Set());

  await saveAccountSync(db, syncRun("2026-11-12T08:00:00.000Z"), "a", "EUR", balances, first, rules);
  assert.deepEqual(await storedDetails(db), [{
    reference: "bank:synthetic-1",
    category: "groceries",
    source: "rule",
    merchantCategoryCode: "5411",
    instructedAmount: -1340,
    instructedCurrency: "USD",
    valueDate: "2026-11-13",
    payload: "5411"
  }, {
    reference: "bank:synthetic-2",
    category: "groceries",
    source: "rule",
    merchantCategoryCode: null,
    instructedAmount: null,
    instructedCurrency: null,
    valueDate: null,
    payload: "absent"
  }]);

  await db.$client.execute("UPDATE transactions SET category_id='leisure',category_source='manual' WHERE provider_reference='bank:synthetic-1'");
  const second = normalizeTransactions([{
    ...omitted("exchange_rate"),
    merchant_category_code: "5812"
  }, {
    ...basic,
    entry_reference: "synthetic-2",
    merchant_category_code: "5999",
    value_date: "2026-11-14"
  }], new Set());

  await saveAccountSync(db, syncRun("2026-11-13T08:00:00.000Z"), "a", "EUR", balances, second, rules);
  assert.deepEqual(await storedDetails(db), [{
    reference: "bank:synthetic-1",
    category: "leisure",
    source: "manual",
    merchantCategoryCode: "5812",
    instructedAmount: null,
    instructedCurrency: null,
    valueDate: "2026-11-13",
    payload: "5812"
  }, {
    reference: "bank:synthetic-2",
    category: "groceries",
    source: "rule",
    merchantCategoryCode: "5999",
    instructedAmount: null,
    instructedCurrency: null,
    valueDate: "2026-11-14",
    payload: "5999"
  }]);
});

test("the transaction list returns the original amount and currency only for bookings that carry one", async context => {
  const db = await isolatedDatabase(context);

  await db.$client.execute("INSERT INTO accounts(id,environment,name,institution,kind,currency) VALUES('a','SANDBOX','Synthetic checking','Example Bank','checking','EUR')");
  await saveAccountSync(db, syncRun("2026-11-12T08:00:00.000Z"), "a", "EUR", balances, normalizeTransactions([complete, {
    ...basic,
    entry_reference: "synthetic-2"
  }], new Set()), rules);
  const page = await readTransactionPage(dashboardFilters(new URLSearchParams({
    period: "2026-11"
  })));
  const originals = page.transactions.map(transaction => [transaction.instructed_amount_minor, transaction.instructed_currency]);

  assert.deepEqual(originals.sort(), [[null, null], [-1340, "USD"]]);
});
