import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { initializeDatabase } from "../src/server/database/migrations";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { minorUnits, validDate, viennaMonth } from "../src/lib/money";
import { categorize, validatePattern, type Rule } from "../src/lib/rules";
import { acquireLease, releaseLease } from "../src/server/jobs/lease-repository";
import { normalizeTransactions } from "../src/features/banking/server/bank-data";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { saveSessionAccounts } from "../src/features/banking/server/bank-account-repository";
import { parseBalancesCsv, parseTransactionsCsv } from "../src/lib/import";
import { encrypt, decrypt } from "../src/server/security/secret-box";
import { hash } from "../src/server/security/tokens";
import { requireOrigin } from "../src/server/http/origin";
import { checkPassword } from "../src/features/auth/server/password-auth-service";
import { completeAuthorization } from "../src/features/banking/server/authorization-service";
import { syncAccounts } from "../src/features/banking/server/sync-service";
import { applicationToken, fetchTransactions, type BankTransaction } from "../src/features/banking/server/enable-banking-client";
import { jwtVerify } from "jose";
import { generateKeyPairSync } from "node:crypto";

const rules: Rule[] = [{
  id: "generic",
  name: "General",
  pattern: "MARKET",
  mode: "keyword",
  category_id: "groceries",
  priority: 100,
  enabled: 1
}, {
  id: "specific",
  name: "Housing",
  pattern: "MARKET.*Rent",
  mode: "regex",
  category_id: "home",
  priority: 10,
  enabled: 1
}];
const bankTransaction: BankTransaction = {
  entry_reference: "unique-1",
  transaction_id: "not-unique",
  status: "BOOK",
  booking_date: "2026-11-12",
  transaction_amount: {
    amount: "12.50",
    currency: "EUR"
  },
  credit_debit_indicator: "DBIT",
  creditor: {
    name: "MARKET"
  },
  remittance_information: ["Purchase"]
};

test("provider JWTs carry the required claims and support standard RSA PEM encodings", async context => {
  const previousId = process.env.ENABLE_BANKING_APP_ID;
  const previousKey = process.env.ENABLE_BANKING_PRIVATE_KEY;
  const {
    privateKey,
    publicKey
  } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });

  context.after(() => {
    if (previousId === undefined) {
      delete process.env.ENABLE_BANKING_APP_ID;
    } else {
      process.env.ENABLE_BANKING_APP_ID = previousId;
    }

    if (previousKey === undefined) {
      delete process.env.ENABLE_BANKING_PRIVATE_KEY;
    } else {
      process.env.ENABLE_BANKING_PRIVATE_KEY = previousKey;
    }
  });

  process.env.ENABLE_BANKING_APP_ID = "synthetic-application";

  for (const type of ["pkcs1", "pkcs8"] as const) {
    process.env.ENABLE_BANKING_PRIVATE_KEY = privateKey.export({
      type,
      format: "pem"
    }).toString();
    const token = await applicationToken();
    const {
      payload,
      protectedHeader
    } = await jwtVerify(token, publicKey, {
      algorithms: ["RS256"],
      issuer: "enablebanking.com",
      audience: "api.enablebanking.com"
    });

    assert.equal(protectedHeader.kid, "synthetic-application");
    assert.equal(protectedHeader.typ, "JWT");
    assert.equal(Number(payload.exp) - Number(payload.iat), 300);
  }
});

test("amounts keep exact decimal cents, direction and currency precision", () => {
  assert.equal(minorUnits("0.29"), 29);
  assert.equal(minorUnits("-1250.01"), -125001);
  assert.equal(minorUnits("12", "JPY"), 12);
  assert.equal(minorUnits("1.234", "KWD"), 1234);
  assert.throws(() => minorUnits("0.005"));
  assert.throws(() => minorUnits("1,000.00"));
  assert.throws(() => minorUnits("900719925474099.91"));
  assert.throws(() => minorUnits("1.00", "XXX"));
});
test("monthly accounting uses Vienna time at UTC month boundary", () => {
  assert.equal(viennaMonth(new Date("2026-10-31T23:30:00Z")), "2026-11");
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2024-02-29"), true);
});
test("rule priority and disabled rules follow explicit precedence", () => {
  assert.equal(categorize("MARKET", "Rent", rules), "home");
  assert.equal(categorize("market", "Groceries", rules), "groceries");
  assert.equal(categorize("MARKET", "Rent", rules.map(rule => ({
    ...rule,
    enabled: 0
  }))), null);
  assert.throws(() => validatePattern("(?<=secret)test", "regex"));
});
test("only booked transactions enter cashflow; non-unique transaction_id does not collapse payments", () => {
  const entries = normalizeTransactions([bankTransaction, {
    ...bankTransaction,
    entry_reference: "unique-2"
  }, {
    ...bankTransaction,
    entry_reference: undefined,
    status: "PDNG"
  }], new Set());

  assert.equal(entries.length, 2);
  assert.equal(entries[0].amount, -1250);
  assert.notEqual(entries[0].reference, entries[1].reference);
  assert.throws(() => normalizeTransactions([{
    ...bankTransaction,
    entry_reference: undefined
  }], new Set()), /stable entry_reference/);
  assert.throws(() => normalizeTransactions([bankTransaction, {
    ...bankTransaction,
    transaction_amount: {
      amount: "13",
      currency: "EUR"
    }
  }], new Set()), /different transactions/);
});
test("transfers to owned accounts are excluded through their category", () => {
  const entry = normalizeTransactions([{
    ...bankTransaction,
    creditor_account: {
      iban: "AT12 3456"
    }
  }], new Set(["AT123456"]));

  assert.equal(entry[0].transfer, true);
});
test("CSV rejects unstable IDs, duplicate valuations and mismatching currencies before import", () => {
  const entries = parseTransactionsCsv("id;date;amount;currency;counterparty;description\na;2026-11-12;-12,50;EUR;MARKET;Purchase", "EUR");

  assert.equal(entries[0].amount, -1250);
  assert.throws(() => parseTransactionsCsv("id,date,amount,currency\na,2026-11-12,1,EUR\na,2026-11-13,1,EUR", "EUR"), /duplicate ID/);
  assert.throws(() => parseTransactionsCsv("date,amount,currency\n2026-11-12,1,EUR", "EUR"));
  assert.throws(() => parseBalancesCsv("date,balance,currency\n2026-11-12,1,USD", "EUR"));
  assert.throws(() => parseBalancesCsv("date,balance,currency\n2026-11-12,1,EUR\n2026-11-12,2,EUR", "EUR"), /multiple balances/);
  assert.deepEqual(parseBalancesCsv("date,balance,currency\n2026-11-12,2,EUR\n2026-11-11,1,EUR", "EUR").map(row => row.amount), [100, 200]);
});
test("repeated sync preserves manual category corrections including deliberately uncategorized", async () => {
  const client = await initializeDatabase(createClient({
    url: ":memory:"
  }));
  const db = drizzle(client, {
    schema
  });

  try {
    await client.execute("INSERT INTO accounts(id,environment,name,institution,kind,currency) VALUES('a','SANDBOX','Test','Test Bank','checking','EUR')");
    const balances = [{
      balance_type: "CLBD",
      balance_amount: {
        amount: "500.00",
        currency: "EUR"
      },
      reference_date: "2026-11-12"
    }];
    const entries = normalizeTransactions([bankTransaction], new Set());

    assert.equal(await saveAccountSync(db, "a", "EUR", balances, entries, rules), 1);
    await client.execute("UPDATE transactions SET category_id='leisure',category_source='manual'");
    assert.equal(await saveAccountSync(db, "a", "EUR", balances, entries, rules), 0);
    assert.equal((await client.execute("SELECT category_id FROM transactions")).rows[0].category_id, "leisure");
    await client.execute("UPDATE transactions SET category_id=NULL,category_source='manual'");
    await saveAccountSync(db, "a", "EUR", balances, entries, rules);
    assert.equal((await client.execute("SELECT category_id FROM transactions")).rows[0].category_id, null);
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM balance_snapshots")).rows[0].n, 1);
    await assert.rejects(saveAccountSync(db, "a", "EUR", balances, [{
      ...entries[0],
      currency: "USD"
    }], rules));
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM transactions")).rows[0].n, 1);
  } finally {
    client.close();
  }
});
test("reauthorization matches alternative identification hashes while sandbox and production remain isolated", async () => {
  const client = await initializeDatabase(createClient({
    url: ":memory:"
  }));
  const db = drizzle(client, {
    schema
  });

  try {
    await client.batch(["INSERT INTO requisitions(id,environment,bank_name,bank_country,status) VALUES('old','SANDBOX','Test','AT','EXCHANGING')", "INSERT INTO requisitions(id,environment,bank_name,bank_country,status) VALUES('new','SANDBOX','Test','AT','EXCHANGING')", "INSERT INTO requisitions(id,environment,bank_name,bank_country,status) VALUES('prod','PRODUCTION','Test','AT','EXCHANGING')"], "write");
    await saveSessionAccounts(db, "SANDBOX", "old", "Test", [{
      uid: "uid-old",
      identification_hash: "iban-hash",
      currency: "EUR"
    }]);
    const initial = (await client.execute("SELECT id FROM accounts")).rows[0].id;

    await saveSessionAccounts(db, "SANDBOX", "new", "Test", [{
      uid: "uid-new",
      identification_hash: "new-hash",
      identification_hashes: ["iban-hash"],
      currency: "EUR"
    }]);
    assert.equal((await client.execute("SELECT id FROM accounts")).rows[0].id, initial);
    assert.equal((await client.execute("SELECT provider_uid FROM accounts")).rows[0].provider_uid, "uid-new");
    assert.equal((await client.execute("SELECT status FROM requisitions WHERE id='old'")).rows[0].status, "SUPERSEDED");
    await saveSessionAccounts(db, "PRODUCTION", "prod", "Test", [{
      uid: "uid-prod",
      identification_hash: "iban-hash",
      currency: "EUR"
    }]);
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM accounts")).rows[0].n, 2);
  } finally {
    client.close();
  }
});
test("a second sync cannot acquire an active lease and a previous owner cannot release its replacement", async () => {
  const client = await initializeDatabase(createClient({
    url: ":memory:"
  }));
  const db = drizzle(client, {
    schema
  });

  try {
    const now = new Date("2026-11-12T00:00:00Z");

    assert.equal(await acquireLease(db, "sync", "first", now), true);
    assert.equal(await acquireLease(db, "sync", "second", now), false);
    assert.equal(await acquireLease(db, "sync", "second", new Date("2026-11-12T00:13:00Z")), true);
    await releaseLease(db, "sync", "first");
    assert.equal((await client.execute("SELECT owner FROM leases")).rows[0].owner, "second");
  } finally {
    client.close();
  }
});
test("cross-site writes are rejected and stored bank secrets authenticate their contents", () => {
  process.env.SESSION_SECRET = "test-only-secret-with-at-least-32-characters";
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.APP_URL = "http://localhost:3000";
  assert.throws(() => requireOrigin(new Request("http://localhost:3000/api/accounts", {
    headers: {
      origin: "https://other.example"
    }
  })));
  requireOrigin(new Request("http://localhost:3000/api/accounts", {
    headers: {
      origin: "http://localhost:3000"
    }
  }));
  const encrypted = encrypt("session-test-only");

  assert.equal(decrypt("AQEBAQEBAQEBAQEB.RUfDdyMvYrXRs3-x1NR15g.XozfVCGnrMutkA5M2aoHrWUGrrfveHIojhkDwjM"), "synthetic-stored-bank-session");
  assert.equal(decrypt(encrypted), "session-test-only");
  const parts = encrypted.split(".");

  parts[1] = Buffer.alloc(16).toString("base64url");
  assert.throws(() => decrypt(parts.join(".")));
});
test("empty transaction pages continue pagination and preserve original date filters", async () => {
  const originalFetch = globalThis.fetch;
  const originalId = process.env.ENABLE_BANKING_APP_ID;
  const originalKey = process.env.ENABLE_BANKING_PRIVATE_KEY;
  const key = generateKeyPairSync("rsa", {
    modulusLength: 2048
  }).privateKey.export({
    type: "pkcs8",
    format: "pem"
  });

  process.env.ENABLE_BANKING_APP_ID = "test-app";
  process.env.ENABLE_BANKING_PRIVATE_KEY = key.toString();
  const calls: URL[] = [];

  globalThis.fetch = async input => {
    calls.push(new URL(String(input)));

    return Response.json(calls.length === 1 ? {
      transactions: [],
      continuation_key: "page2"
    } : {
      transactions: [bankTransaction],
      continuation_key: null
    });
  };

  try {
    const entries = await fetchTransactions("test-account", "2026-11-01");

    assert.equal(entries.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].searchParams.get("date_from"), "2026-11-01");
    assert.equal(calls[1].searchParams.get("date_from"), "2026-11-01");
    assert.equal(calls[1].searchParams.get("continuation_key"), "page2");
  } finally {
    globalThis.fetch = originalFetch;

    if (originalId === undefined) {
      delete process.env.ENABLE_BANKING_APP_ID;
    } else {
      process.env.ENABLE_BANKING_APP_ID = originalId;
    }

    if (originalKey === undefined) {
      delete process.env.ENABLE_BANKING_PRIVATE_KEY;
    } else {
      process.env.ENABLE_BANKING_PRIVATE_KEY = originalKey;
    }
  }
});
test("bank callbacks are browser-bound, single-use and persist encrypted session data before account retrieval", async () => {
  const client = await initializeDatabase(createClient({
    url: ":memory:"
  }));
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>;
  };
  const previousDb = globals.budgetDb;
  const previousFetch = globalThis.fetch;

  globals.budgetDb = Promise.resolve(drizzle(client, {
    schema
  }));
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";
  process.env.ENABLE_BANKING_APP_ID = "test-app";
  process.env.ENABLE_BANKING_PRIVATE_KEY = generateKeyPairSync("rsa", {
    modulusLength: 2048
  }).privateKey.export({
    type: "pkcs8",
    format: "pem"
  }).toString();
  process.env.DATA_ENCRYPTION_KEY = "cd".repeat(32);
  let requests = 0;

  globalThis.fetch = async () => {
    requests++;

    return Response.json({
      session_id: "test-session",
      aspsp: {
        name: "Mock",
        country: "AT"
      },
      access: {
        valid_until: "2099-01-01T00:00:00Z"
      },
      accounts: [{
        uid: "test-uid",
        identification_hash: "stable",
        currency: "EUR"
      }]
    });
  };

  try {
    await client.execute({
      sql: "INSERT INTO requisitions(id,environment,bank_name,bank_country,state_hash,browser_hash,state_expires_at) VALUES('flow','SANDBOX','Mock','AT',?,?,?)",
      args: [hash("state"), hash("browser"), "2099-01-01T00:00:00Z"]
    });
    await assert.rejects(completeAuthorization("state", "wrong-browser", "code"), /another browser/);
    assert.equal(requests, 0);
    assert.deepEqual(await completeAuthorization("state", "browser", "code"), {
      accounts: 1
    });
    const row = (await client.execute("SELECT session_cipher,status FROM requisitions WHERE id='flow'")).rows[0];

    assert.equal(row.status, "LINKED");
    assert.notEqual(row.session_cipher, "test-session");
    assert.equal(decrypt(String(row.session_cipher)), "test-session");
    await assert.rejects(completeAuthorization("state", "browser", "code"), /already been used/);
    assert.equal(requests, 1);
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM accounts")).rows[0].n, 1);
  } finally {
    globals.budgetDb = previousDb;
    globalThis.fetch = previousFetch;
    delete process.env.ENABLE_BANKING_PRIVATE_KEY;
    client.close();
  }
});
test("login throttling is shared across requests and resets after successful authentication", async () => {
  const client = await initializeDatabase(createClient({
    url: ":memory:"
  }));
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>;
  };
  const previousDb = globals.budgetDb;
  const previousPassword = process.env.APP_PASSWORD;

  globals.budgetDb = Promise.resolve(drizzle(client, {
    schema
  }));
  process.env.APP_PASSWORD = "test-password";
  process.env.SESSION_SECRET = "test-only-secret-with-at-least-32-characters";

  try {
    await assert.rejects(checkPassword("incorrect"), error => (error as {
      status: number;
    }).status === 401);
    await checkPassword("test-password");
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM login_attempts")).rows[0].n, 0);

    for (let index = 0; index < 10; index++) {
      await assert.rejects(checkPassword("incorrect"), error => (error as {
        status: number;
      }).status === 401);
    }

    await assert.rejects(checkPassword("test-password"), error => (error as {
      status: number;
    }).status === 429);
  } finally {
    globals.budgetDb = previousDb;

    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }

    client.close();
  }
});
test("sync refuses mismatching application environments before fetching financial data and releases its lease", async () => {
  const client = await initializeDatabase(createClient({
    url: ":memory:"
  }));
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>;
  };
  const previousDb = globals.budgetDb;
  const previousFetch = globalThis.fetch;

  globals.budgetDb = Promise.resolve(drizzle(client, {
    schema
  }));
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";
  process.env.ENABLE_BANKING_APP_ID = "test-app";
  process.env.ENABLE_BANKING_PRIVATE_KEY = generateKeyPairSync("rsa", {
    modulusLength: 2048
  }).privateKey.export({
    type: "pkcs8",
    format: "pem"
  }).toString();
  const requests: string[] = [];

  globalThis.fetch = async input => {
    requests.push(new URL(String(input)).pathname);

    return Response.json({
      environment: "PRODUCTION",
      redirect_urls: []
    });
  };

  try {
    await client.execute("INSERT INTO requisitions(id,environment,bank_name,bank_country,status,valid_until) VALUES('flow','SANDBOX','Mock','AT','LINKED','2099-01-01T00:00:00Z')");
    await client.execute("INSERT INTO accounts(id,environment,name,institution,kind,provider,provider_uid,requisition_id) VALUES('a','SANDBOX','Test','Mock','checking','enable_banking','uid','flow')");
    await assert.rejects(syncAccounts(), /application environment/);
    assert.deepEqual(requests, ["/application"]);
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM leases")).rows[0].n, 0);
    assert.equal((await client.execute("SELECT status FROM sync_runs")).rows[0].status, "FAILED");
    assert.equal((await client.execute("SELECT balance_minor FROM accounts")).rows[0].balance_minor, null);
  } finally {
    globals.budgetDb = previousDb;
    globalThis.fetch = previousFetch;
    delete process.env.ENABLE_BANKING_PRIVATE_KEY;
    client.close();
  }
});
