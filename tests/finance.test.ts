import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { initializeDatabase } from "../src/server/database/migrations";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { Temporal } from "temporal-polyfill";
import { minorUnits } from "../src/lib/money";
import { validDate } from "../src/lib/time";
import { ValidationError } from "../src/lib/errors";
import { categorize, prepareRules, validatePattern, type Rule } from "../src/lib/rules";
import { acquireLease, releaseLease } from "../src/server/jobs/lease-repository";
import { normalizeTransactions } from "../src/features/banking/server/bank-data";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { saveSessionAccounts } from "../src/features/banking/server/bank-account-repository";
import { parseBalancesCsv, parseTransactionsCsv } from "../src/lib/import";
import { encrypt, decrypt } from "../src/server/security/secret-box";
import { hash } from "../src/server/security/tokens";
import { requireOrigin } from "../src/server/http/origin";
import { seedActor } from "./fixtures/auth";
import { completeAuthorization } from "../src/features/banking/server/authorization-service";
import { syncAccounts } from "../src/features/banking/server/sync-service";
import { applicationToken, availableBanks, listBanks, fetchTransactions, type BankTransaction } from "../src/features/banking/server/enable-banking-client";
import { connectBank } from "../src/features/banking/server/connect-bank";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
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

function syncRun(startedAt: string) {
  return {
    environment: "SANDBOX",
    startedAt
  };
}

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

function syntheticProviderEnvironment(context: TestContext, variables: Record<string, string>) {
  const names = ["ENABLE_BANKING_APP_ID", "ENABLE_BANKING_PRIVATE_KEY", "ENABLE_BANKING_ENVIRONMENT", "ENABLE_BANKING_REDIRECT_URL"];
  const previous = new Map(names.map(name => [name, process.env[name]]));

  context.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  process.env.ENABLE_BANKING_PRIVATE_KEY = generateKeyPairSync("rsa", {
    modulusLength: 2048
  }).privateKey.export({
    type: "pkcs8",
    format: "pem"
  }).toString();
  Object.assign(process.env, variables);
}

test("provider requests reuse one JWT until a minute before it expires and sign a new one for another application", async context => {
  syntheticProviderEnvironment(context, {
    ENABLE_BANKING_APP_ID: "synthetic-application"
  });
  let now = Temporal.Instant.from("2026-11-16T10:00:00Z");

  context.mock.method(Temporal.Now, "instant", () => now);
  const first = await applicationToken();

  now = now.add({
    minutes: 3,
    seconds: 59
  });
  assert.equal(await applicationToken(), first);
  now = now.add({
    seconds: 1
  });
  const renewed = await applicationToken();

  assert.notEqual(renewed, first);
  assert.equal(decodeJwt(renewed).iat, now.epochMilliseconds / 1000);
  assert.equal(decodeJwt(renewed).exp, now.epochMilliseconds / 1000 + 300);
  process.env.ENABLE_BANKING_APP_ID = "another-application";
  const switched = await applicationToken();

  assert.notEqual(switched, renewed);
  assert.equal(decodeProtectedHeader(switched).kid, "another-application");
});

test("listing banks and starting a bank connection check the provider application once", async context => {
  const client = await initializeDatabase(createClient({
    url: ":memory:"
  }));
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>;
  };
  const previousDb = globals.budgetDb;
  const callback = "https://ufer.example/api/banking/callback";
  const requests: string[] = [];

  const db = drizzle(client, {
    schema
  });

  context.after(() => {
    globals.budgetDb = previousDb;
    client.close();
  });
  globals.budgetDb = Promise.resolve(db);
  syntheticProviderEnvironment(context, {
    ENABLE_BANKING_APP_ID: "synthetic-application",
    ENABLE_BANKING_ENVIRONMENT: "SANDBOX",
    ENABLE_BANKING_REDIRECT_URL: callback
  });
  const providerResponses: Record<string, unknown> = {
    "/application": {
      environment: "SANDBOX",
      redirect_urls: [callback]
    },
    "/aspsps": {
      aspsps: [{
        name: "Example Bank",
        country: "AT",
        maximum_consent_validity: 86_400
      }]
    },
    "/auth": {
      url: "https://bank.example/authorize",
      authorization_id: "synthetic-authorization"
    }
  };

  context.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const path = new URL(String(input)).pathname;

    requests.push(path);

    return Response.json(providerResponses[path]);
  });
  const actor = await seedActor(db);

  assert.deepEqual((await availableBanks("AT")).map(bank => bank.name), ["Example Bank"]);
  assert.deepEqual(requests, ["/aspsps"]);
  requests.length = 0;
  assert.equal((await connectBank({
    bank: "Example Bank",
    country: "AT"
  }, actor)).url, "https://bank.example/authorize");
  assert.deepEqual(requests.toSorted(), ["/application", "/aspsps", "/auth"]);
  requests.length = 0;
  assert.deepEqual((await listBanks("AT")).map(bank => bank.name), ["Example Bank"]);
  assert.deepEqual(requests.toSorted(), ["/application", "/aspsps"]);
  providerResponses["/application"] = {
    environment: "PRODUCTION",
    redirect_urls: [callback]
  };
  await assert.rejects(listBanks("AT"), {
    status: 409
  });
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

test("currencies outside the pinned list take their decimal places from the runtime, and pinned ones keep theirs", () => {
  assert.equal(minorUnits("39.67", "CAD"), 3967);
  assert.equal(minorUnits("1250", "CLP"), 1250);
  assert.equal(minorUnits("1.234", "TND"), 1234);
  assert.equal(minorUnits("1500.50", "HUF"), 150050);
  assert.throws(() => minorUnits("1.00", "ZZZ"));

  for (const inherited of ["toString", "constructor", "__proto__"]) {
    assert.throws(() => minorUnits("1.00", inherited), ValidationError);
  }
});
test("booking dates must be real calendar dates in exactly YYYY-MM-DD form", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2025-02-29"), false);

  for (const otherForm of ["", "20260301", "2026-3-1", "2026-03-01T10:00", "2026-03-01Z", "2026-03-01[u-ca=iso8601]", "+002026-03-01", " 2026-03-01"]) {
    assert.equal(validDate(otherForm), false, otherForm);
  }
});
test("rule priority and disabled rules follow explicit precedence", () => {
  assert.equal(categorize("MARKET", "Rent", prepareRules(rules)), "home");
  assert.equal(categorize("market", "Groceries", prepareRules(rules)), "groceries");
  assert.equal(categorize("MARKET", "Rent", prepareRules(rules.map(rule => ({
    ...rule,
    enabled: 0
  })))), null);
  assert.throws(() => validatePattern("(?<=secret)test", "regex"), ValidationError);
  assert.throws(() => validatePattern("   ", "keyword"), ValidationError);
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
test("CSV balances dated today in Vienna are accepted before UTC reaches that day", () => {
  const viennaAfterMidnight = Temporal.Instant.from("2026-03-01T23:30:00Z");

  assert.deepEqual(parseBalancesCsv("date,balance,currency\n2026-03-02,1,EUR", "EUR", viennaAfterMidnight).map(row => row.date), ["2026-03-02"]);
  assert.throws(() => parseBalancesCsv("date,balance,currency\n2026-03-03,1,EUR", "EUR", viennaAfterMidnight), /invalid date/);
});
test("CSV amount errors name the row in both imports", () => {
  assert.throws(() => parseBalancesCsv("date,balance,currency\n2026-11-11,1,EUR\n2026-11-12,1.234,EUR", "EUR"), /CSV row 3: .*decimal/);
  assert.throws(() => parseTransactionsCsv("id,date,amount,currency\na,2026-11-12,1,EUR\nb,2026-11-12,abc,EUR", "EUR"), /CSV row 3: Invalid amount/);
});
test("CSV transactions dated after today in Vienna are rejected with their row", () => {
  const viennaAfterMidnight = Temporal.Instant.from("2026-03-01T23:30:00Z");

  assert.deepEqual(parseTransactionsCsv("id,date,amount,currency\na,2026-03-02,1,EUR", "EUR", viennaAfterMidnight).map(row => row.date), ["2026-03-02"]);
  assert.throws(() => parseTransactionsCsv("id,date,amount,currency\na,2026-03-02,1,EUR\nb,2026-03-03,1,EUR", "EUR", viennaAfterMidnight), /CSV row 3: .*future/);
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

    assert.equal(await saveAccountSync(db, syncRun("2026-11-12T08:00:00.000Z"), "a", "EUR", balances, entries, rules), 1);
    await client.execute("UPDATE transactions SET category_id='leisure',category_source='manual'");
    assert.equal(await saveAccountSync(db, syncRun("2026-11-12T09:00:00.000Z"), "a", "EUR", balances, entries, rules), 0);
    assert.equal((await client.execute("SELECT category_id FROM transactions")).rows[0].category_id, "leisure");
    await client.execute("UPDATE transactions SET category_id=NULL,category_source='manual'");
    await saveAccountSync(db, syncRun("2026-11-12T10:00:00.000Z"), "a", "EUR", balances, entries, rules);
    assert.equal((await client.execute("SELECT category_id FROM transactions")).rows[0].category_id, null);
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM balance_snapshots")).rows[0].n, 1);
    await assert.rejects(saveAccountSync(db, syncRun("2026-11-12T11:00:00.000Z"), "a", "EUR", balances, [{
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
    const now = Temporal.Instant.from("2026-11-12T00:00:00Z");

    assert.equal(await acquireLease(db, "sync", "first", now), true);
    assert.equal((await client.execute("SELECT expires_at FROM leases")).rows[0].expires_at, "2026-11-12T00:12:00.000Z");
    assert.equal(await acquireLease(db, "sync", "second", Temporal.Instant.from("2026-11-12T00:11:59.999Z")), false);
    assert.equal(await acquireLease(db, "sync", "second", Temporal.Instant.from("2026-11-12T00:13:00Z")), true);
    await releaseLease(db, "sync", "first");
    assert.equal((await client.execute("SELECT owner FROM leases")).rows[0].owner, "second");
  } finally {
    client.close();
  }
});
test("cross-site writes are rejected and stored bank secrets authenticate their contents", () => {
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
    const actor = await seedActor(await globals.budgetDb);

    await client.execute({
      sql: "INSERT INTO requisitions(id,environment,bank_name,bank_country,state_hash,browser_hash,state_expires_at,workspace_id,initiated_by_user_id,auth_session_id) VALUES('flow','SANDBOX','Mock','AT',?,?,?,'personal','bank-user','bank-session')",
      args: [hash("state"), hash("browser"), "2099-01-01T00:00:00Z"]
    });
    await assert.rejects(completeAuthorization("state", "wrong-browser", "code", actor), /another browser/);
    await assert.rejects(completeAuthorization("state", "browser", "code", {
      ...actor,
      sessionId: "another-session"
    }), /another browser/);
    assert.equal(requests, 0);
    assert.deepEqual(await completeAuthorization("state", "browser", "code", actor), {
      accounts: 1
    });
    const row = (await client.execute("SELECT session_cipher,status FROM requisitions WHERE id='flow'")).rows[0];

    assert.equal(row.status, "LINKED");
    assert.notEqual(row.session_cipher, "test-session");
    assert.equal(decrypt(String(row.session_cipher)), "test-session");
    await assert.rejects(completeAuthorization("state", "browser", "code", actor), /already been used/);
    assert.equal(requests, 1);
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM accounts")).rows[0].n, 1);
  } finally {
    globals.budgetDb = previousDb;
    globalThis.fetch = previousFetch;
    delete process.env.ENABLE_BANKING_PRIVATE_KEY;
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

test("sync offers reconnecting only for failures that a new bank authorization resolves", async () => {
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

  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname;

    if (path === "/application") {
      return Response.json({
        environment: "SANDBOX",
        redirect_urls: []
      });
    }

    return Response.json({
      error: "ASPSP_RATE_LIMIT_EXCEEDED"
    }, {
      status: 429
    });
  };

  try {
    await client.execute("INSERT INTO requisitions(id,environment,bank_name,bank_country,status,valid_until) VALUES('current','SANDBOX','Mock','AT','LINKED','2099-01-01T00:00:00Z')");
    await client.execute("INSERT INTO requisitions(id,environment,bank_name,bank_country,status,valid_until) VALUES('lapsed','SANDBOX','Mock','AT','LINKED','2000-01-01T00:00:00Z')");
    await client.execute("INSERT INTO accounts(id,environment,name,institution,kind,provider,provider_uid,requisition_id) VALUES('limited','SANDBOX','Limited','Mock','checking','enable_banking','uid-limited','current')");
    await client.execute("INSERT INTO accounts(id,environment,name,institution,kind,provider,provider_uid,requisition_id) VALUES('expired','SANDBOX','Expired','Mock','checking','enable_banking','uid-expired','lapsed')");

    const result = await syncAccounts();
    const reconnectByAccount = Object.fromEntries(result.failures.map(failure => [failure.account, failure.reconnect]));

    assert.deepEqual(reconnectByAccount, {
      Limited: false,
      Expired: true
    });
  } finally {
    globals.budgetDb = previousDb;
    globalThis.fetch = previousFetch;
    delete process.env.ENABLE_BANKING_PRIVATE_KEY;
    client.close();
  }
});
