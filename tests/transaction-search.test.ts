import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";

// More distinct case-mapped letters than the search folds; SQLite cannot nest one replace() for each of them.
const manyLetters = "абвгдежзийклмнопрстуфхцчшщ αβγδεζηθσ ss";

const bookings = {
  "upper-umlaut": ["MÜLLER GMBH", "Invoice 4711"],
  "mixed-umlaut": ["Müller Bäckerei", ""],
  "rail": ["ÖBB-Personenverkehr AG", "Ticket Wien"],
  "apples": ["", "ÄPFEL vom Markt"],
  "street-upper": ["Hausverwaltung", "HAUPTSTRASSE 12"],
  "street-sharp": ["Bäckerei an der Straße", ""],
  "street-capital": ["STRAẞENBAHN", ""],
  "accentless": ["Muller Transport", ""],
  "grocery": ["SPAR Filiale", "Card payment"],
  "online": ["Example Store", "order spar-2026"],
  "greek-upper": ["ΚΟΣΜΟΣ ΤΑΒΕΡΝΑ", ""],
  "greek-lower": ["", "ταβερνα κοσμος"],
  "many-letters": ["", `alphabet ${manyLetters}`]
};

async function seedSearchableTransactions(context: TestContext) {
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
    institution: "Example institution",
    kind: "checking"
  });
  await db.insert(schema.transactions).values(Object.entries(bookings).map(([id, [counterparty, description]], index) => ({
    id,
    account_id: "checking",
    provider_reference: `synthetic-${index}`,
    booking_date: "2026-01-15",
    amount_minor: -1000,
    currency: "EUR",
    type: "expense" as const,
    counterparty,
    description
  })));
}

async function matches(search: string) {
  const query = new URLSearchParams({
    period: "all",
    search
  });
  const page = await readTransactionPage(dashboardFilters(query));
  const ids = page.transactions.map(item => item.id).sort();

  assert.equal(page.transactionCount, ids.length);

  return ids;
}

test("search ignores the case of German umlauts in payees and descriptions", async context => {
  await seedSearchableTransactions(context);

  assert.deepEqual(await matches("müller"), ["mixed-umlaut", "upper-umlaut"]);
  assert.deepEqual(await matches("MÜLLER"), ["mixed-umlaut", "upper-umlaut"]);
  assert.deepEqual(await matches("öbb"), ["rail"]);
  assert.deepEqual(await matches("äpfel"), ["apples"]);
  assert.deepEqual(await matches("bÄcKeRei"), ["mixed-umlaut", "street-sharp"]);
});

test("search treats ß, capital ẞ and ss as the same letters", async context => {
  await seedSearchableTransactions(context);
  const streets = ["street-capital", "street-sharp", "street-upper"];

  assert.deepEqual(await matches("straße"), streets);
  assert.deepEqual(await matches("STRASSE"), streets);
  assert.deepEqual(await matches("Strasse"), streets);
  assert.deepEqual(await matches("STRAẞE"), streets);
  assert.deepEqual(await matches("straßenbahn"), ["street-capital"]);
});

test("search keeps matching ASCII text regardless of case and does not ignore accents", async context => {
  await seedSearchableTransactions(context);

  assert.deepEqual(await matches("spar"), ["grocery", "online"]);
  assert.deepEqual(await matches("SPAR-2026"), ["online"]);
  assert.deepEqual(await matches("invoice 4711"), ["upper-umlaut"]);
  assert.deepEqual(await matches("muller"), ["accentless"]);
  assert.deepEqual(await matches("unknown payee"), []);
});

test("search treats Greek σ, final ς and Σ as one letter", async context => {
  await seedSearchableTransactions(context);

  assert.deepEqual(await matches("κοσμος"), ["greek-lower", "greek-upper"]);
  assert.deepEqual(await matches("ΚΟΣΜΟΣ"), ["greek-lower", "greek-upper"]);
  assert.deepEqual(await matches("ος"), ["greek-lower", "greek-upper"]);
});

test("a search with many distinct non-ASCII letters still returns its matches", async context => {
  await seedSearchableTransactions(context);

  assert.deepEqual(await matches(manyLetters), ["many-letters"]);
});
