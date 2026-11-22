import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { hash } from "../src/server/security/tokens";
import type { AuthContext } from "../src/server/security/session";
import { completeAuthorization } from "../src/features/banking/server/authorization-service";
import { connectBank } from "../src/features/banking/server/connect-bank";
import { createManualTransaction } from "../src/features/transactions/server/manual-transaction-repository";
import { insertAuthorization } from "../src/features/banking/server/connection-repository";
import { removeBankConnection } from "../src/features/banking/server/connection-service";
import { deleteAccount } from "../src/features/accounts/server/account-service";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { startSyncRun } from "../src/features/banking/server/sync-repository";
import { decideTargetBankAccount, type IdentifiedBankAccount } from "../src/features/banking/server/bank-account-mapping";
import type { BankAccount } from "../src/features/banking/server/enable-banking-client";
import { seedActor } from "./fixtures/auth";

const providerKey = generateKeyPairSync("rsa", {
  modulusLength: 2048
}).privateKey.export({
  type: "pkcs8",
  format: "pem"
}).toString();

const environmentNames = ["ENABLE_BANKING_ENVIRONMENT", "ENABLE_BANKING_APP_ID", "ENABLE_BANKING_PRIVATE_KEY", "DATA_ENCRYPTION_KEY"];

type ProviderRequest = {
  method: string;
  path: string;
};

/** An in-memory database with a signed-in actor and a provider whose session lists `sessionAccounts()`. */
async function connectDatabase(context: TestContext, sessionAccounts: () => BankAccount[]) {
  const client = await initializeDatabase(createClient({
    url: ":memory:"
  }));
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousFetch = globalThis.fetch;
  const previousEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
  const requests: ProviderRequest[] = [];

  context.after(() => {
    globals.budgetDb = previousDatabase;
    globalThis.fetch = previousFetch;

    for (const name of environmentNames) {
      if (previousEnvironment[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previousEnvironment[name];
      }
    }

    client.close();
  });

  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";
  process.env.ENABLE_BANKING_APP_ID = "synthetic-app";
  process.env.ENABLE_BANKING_PRIVATE_KEY = providerKey;
  process.env.DATA_ENCRYPTION_KEY = "ef".repeat(32);
  globalThis.fetch = async (input, init) => {
    const request = {
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname
    };

    requests.push(request);

    if (request.method === "DELETE") {
      return Response.json({
        message: "OK"
      });
    }

    return Response.json({
      session_id: `session-${requests.length}`,
      aspsp: {
        name: "Example bank",
        country: "AT"
      },
      access: {
        valid_until: "2099-01-01T00:00:00Z"
      },
      accounts: sessionAccounts()
    });
  };

  return {
    db,
    requests,
    actor: await seedActor(db)
  };
}

async function insertManualAccount(db: Database, values: Partial<typeof schema.accounts.$inferInsert> = {}) {
  await db.insert(schema.accounts).values({
    id: "imported",
    name: "Synthetic CSV account",
    kind: "checking",
    currency: "EUR",
    iban: "AT00 0000 0000 0000 0001",
    ...values
  });
}

/** A pending authorization started by `actor` from `targetAccountId`, as `connectBank` records it. */
async function startAuthorization(db: Database, actor: AuthContext, id: string, targetAccountId: string | null) {
  await db.insert(schema.requisitions).values({
    id,
    workspace_id: actor.workspaceId,
    initiated_by_user_id: actor.userId,
    auth_session_id: actor.sessionId,
    bank_name: "Example bank",
    bank_country: "AT",
    state_hash: hash(`state-${id}`),
    browser_hash: hash(`browser-${id}`),
    state_expires_at: "2099-01-01T00:00:00Z",
    target_account_id: targetAccountId
  });
}

function bankAccount(uid: string, values: Partial<BankAccount> = {}): BankAccount {
  return {
    uid,
    identification_hash: `hash-${uid}`,
    currency: "EUR",
    ...values
  };
}

async function account(db: Database, id: string) {
  return db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
}

test("a CSV-created manual account connects to the authorized bank account, and its sync adopts the imported rows instead of duplicating them", async context => {
  const {
    db,
    actor
  } = await connectDatabase(context, () => [bankAccount("savings", {
    currency: "USD"
  }), bankAccount("checking", {
    name: "Example checking",
    account_id: {
      iban: "AT000000000000000001"
    }
  })]);

  await insertManualAccount(db);
  await db.insert(schema.transactions).values({
    id: "imported-row",
    account_id: "imported",
    provider_reference: "csv:m:synthetic-row",
    date: "2026-11-02",
    amount_minor: -1840,
    currency: "EUR",
    type: "expense",
    counterparty: "Example Bistro",
    description: "Card payment"
  });
  await startAuthorization(db, actor, "connect", "imported");

  assert.deepEqual(await completeAuthorization("state-connect", "browser-connect", "code", actor), {
    accounts: 2
  });

  const connected = await account(db, "imported");

  assert.deepEqual([connected?.provider, connected?.provider_uid, connected?.requisition_id, connected?.name, connected?.provider_name], ["enable_banking", "checking", "connect", "Synthetic CSV account", "Example checking"]);
  assert.deepEqual((await db.select({
    account: schema.accountIdentifiers.account_id
  }).from(schema.accountIdentifiers).where(eq(schema.accountIdentifiers.identification_hash, "hash-checking")).get())?.account, "imported");
  // The other authorized account maps as before: a new account.
  assert.equal((await db.select().from(schema.accounts)).length, 2);

  await startSyncRun("sync", "2026-11-10T08:00:00.000Z");
  const inserted = await saveAccountSync({
    startedAt: "2026-11-10T08:00:00.000Z"
  }, "imported", "EUR", [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "100.00",
      currency: "EUR"
    },
    reference_date: "2026-11-09"
  }], [{
    reference: "bank:bistro",
    date: "2026-11-02",
    amount: -1840,
    currency: "EUR",
    counterparty: "EXAMPLE BISTRO VIENNA",
    description: "Card payment"
  }, {
    reference: "bank:pharmacy",
    date: "2026-11-03",
    amount: -900,
    currency: "EUR",
    counterparty: "Pharmacy",
    description: ""
  }], []);
  const bookings = await db.select().from(schema.transactions).where(ne(schema.transactions.type, "opening_balance")).orderBy(schema.transactions.date);

  assert.equal(inserted, 1);
  assert.deepEqual(bookings.map(row => [row.id === "imported-row", row.provider_reference]), [[true, "bank:bistro"], [false, "bank:pharmacy"]]);
});

test("starting a connection accepts only an active manual account and asks the provider nothing otherwise", async context => {
  const {
    db,
    requests,
    actor
  } = await connectDatabase(context, () => []);

  await insertManualAccount(db, {
    id: "archived",
    archived_at: "2026-01-01T00:00:00.000Z"
  });
  await db.insert(schema.requisitions).values({
    id: "linked",
    bank_name: "Example bank",
    bank_country: "AT",
    status: "LINKED"
  });
  await insertManualAccount(db, {
    id: "bank",
    provider: "enable_banking",
    provider_uid: "uid-bank",
    requisition_id: "linked"
  });

  for (const accountId of ["archived", "bank", "missing"]) {
    await assert.rejects(connectBank({
      bank: "Example bank",
      country: "AT",
      accountId
    }, actor), {
      status: 409
    });
  }

  assert.equal(requests.length, 0);
});

test("the callback connects only the account its authorization recorded, and refuses it once it is no longer an active manual account", async context => {
  const {
    db,
    requests,
    actor
  } = await connectDatabase(context, () => [bankAccount("checking")]);

  await insertManualAccount(db);
  await insertManualAccount(db, {
    id: "other",
    name: "Synthetic other account"
  });
  await startAuthorization(db, actor, "archived-meanwhile", "imported");
  await db.update(schema.accounts).set({
    archived_at: "2026-11-01T00:00:00.000Z"
  }).where(eq(schema.accounts.id, "imported"));

  // The browser secret and the signed-in session bind the callback before any provider call.
  await assert.rejects(completeAuthorization("state-archived-meanwhile", "browser-other", "code", actor), {
    status: 400
  });
  assert.equal(requests.length, 0);
  await assert.rejects(completeAuthorization("state-archived-meanwhile", "browser-archived-meanwhile", "code", actor), {
    status: 422
  });

  const failed = await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "archived-meanwhile")).get();

  assert.equal(failed?.status, "ERROR");
  assert.equal(failed?.session_cipher, null);
  assert.deepEqual(requests.map(request => request.method), ["POST", "DELETE"]);
  assert.deepEqual((await db.select().from(schema.accounts)).map(row => [row.id, row.provider, row.requisition_id]), [["imported", "manual", null], ["other", "manual", null]]);
});

test("an authorization offering several possible bank accounts connects none of them and revokes its session", async context => {
  const {
    db,
    requests,
    actor
  } = await connectDatabase(context, () => [bankAccount("first"), bankAccount("second")]);

  await insertManualAccount(db, {
    iban: null
  });
  await startAuthorization(db, actor, "ambiguous", "imported");

  await assert.rejects(completeAuthorization("state-ambiguous", "browser-ambiguous", "code", actor), {
    status: 422,
    message: /authorize only this account/
  });
  assert.equal(requests.at(-1)?.method, "DELETE");
  assert.deepEqual((await db.select().from(schema.accounts)).map(row => [row.id, row.provider]), [["imported", "manual"]]);
  assert.equal((await db.select().from(schema.accountIdentifiers)).length, 0);
});

test("removing a connection leaves manual accounts that the same flow connects again", async context => {
  const {
    db,
    actor
  } = await connectDatabase(context, () => [bankAccount("checking", {
    uid: "renewed-uid"
  })]);

  await insertManualAccount(db);
  await startAuthorization(db, actor, "first", "imported");
  await completeAuthorization("state-first", "browser-first", "code", actor);

  assert.deepEqual(await removeBankConnection("first"), {
    retainedAccounts: 1,
    notArchived: []
  });

  const removed = await account(db, "imported");

  assert.deepEqual([removed?.provider, removed?.provider_uid, removed?.requisition_id], ["manual", null, null]);

  await startAuthorization(db, actor, "second", "imported");
  await completeAuthorization("state-second", "browser-second", "code", actor);

  const reconnected = await account(db, "imported");

  assert.deepEqual([reconnected?.provider, reconnected?.provider_uid, reconnected?.requisition_id], ["enable_banking", "renewed-uid", "second"]);
  assert.equal((await db.select().from(schema.accounts)).length, 1);
});

function identified(uid: string, iban: string | null, matches: string[] = [], currency = "EUR"): IdentifiedBankAccount {
  return {
    account: {
      uid,
      identification_hash: `hash-${uid}`,
      currency,
      account_id: iban ? {
        iban
      } : undefined
    },
    matches: matches.map(accountId => ({
      account_id: accountId,
      requisition_id: null
    }))
  };
}

test("the connected bank account is the one the target's identifiers name, else the only free one in its currency, preferring an equal IBAN", () => {
  const target = {
    id: "target",
    currency: "EUR",
    iban: "AT00 0000 0000 0000 0001"
  };

  assert.equal(decideTargetBankAccount(target, [identified("free", null), identified("known", null, ["target"])]), 1);
  assert.equal(decideTargetBankAccount(target, [identified("other-iban", "AT000000000000000002"), identified("same-iban", "at000000000000000001"), identified("no-iban", null)]), 1);
  assert.equal(decideTargetBankAccount(target, [identified("owned", null, ["another"]), identified("dollar", null, [], "USD"), identified("free", null)]), 2);
  assert.throws(() => decideTargetBankAccount(target, [identified("owned", null, ["another"]), identified("other-iban", "AT000000000000000002")]), {
    status: 422
  });
  assert.throws(() => decideTargetBankAccount({
    ...target,
    iban: null
  }, [identified("first", null), identified("second", "AT000000000000000002")]), {
    status: 422
  });
  // An authorized account with the target's IBAN that belongs to another account blocks every fallback.
  assert.throws(() => decideTargetBankAccount(target, [identified("owned-same-iban", "AT000000000000000001", ["another"]), identified("free", null)]), {
    status: 422
  });
  // Only one authorized account may name the target, and it must name no other account.
  assert.throws(() => decideTargetBankAccount(target, [identified("known", null, ["target"]), identified("also-known", null, ["target"])]), {
    status: 422
  });
  assert.throws(() => decideTargetBankAccount(target, [identified("shared", null, ["target", "another"]), identified("free", null)]), {
    status: 422
  });
});

test("an account an authorization was started from stays deletable, and that authorization then fails instead of connecting every bank account", async context => {
  const {
    db,
    requests,
    actor
  } = await connectDatabase(context, () => [bankAccount("checking")]);

  await insertManualAccount(db);
  await startAuthorization(db, actor, "abandoned", "imported");

  await deleteAccount("imported", {
    name: "Synthetic CSV account"
  });

  assert.equal((await db.select().from(schema.accounts)).length, 0);
  await assert.rejects(completeAuthorization("state-abandoned", "browser-abandoned", "code", actor), {
    status: 422
  });

  const failed = await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "abandoned")).get();

  assert.equal(failed?.status, "ERROR");
  assert.equal(failed?.session_cipher, null);
  assert.deepEqual(requests.map(request => request.method), ["POST", "DELETE"]);
  assert.equal((await db.select().from(schema.accounts)).length, 0);
});

test("bank accounts of one callback that share an identifier map to one account, as before targeted connections", async context => {
  const {
    db,
    actor
  } = await connectDatabase(context, () => [bankAccount("first", {
    identification_hash: "shared"
  }), bankAccount("second", {
    identification_hash: "shared"
  })]);

  await startAuthorization(db, actor, "plain", null);
  await completeAuthorization("state-plain", "browser-plain", "code", actor);

  assert.equal((await db.select().from(schema.accounts)).length, 1);
});

test("recording an authorization reads its target again and refuses one archived while the provider requests ran", async context => {
  const {
    db,
    actor
  } = await connectDatabase(context, () => []);

  await insertManualAccount(db, {
    archived_at: "2026-11-01T00:00:00.000Z"
  });

  assert.equal(await insertAuthorization({
    id: "stale",
    bank: "Example bank",
    country: "AT",
    stateHash: hash("state-stale"),
    browserHash: hash("browser-stale"),
    authorizationId: "authorization-stale",
    targetAccountId: "imported",
    actor
  }), false);
  assert.equal((await db.select().from(schema.requisitions)).length, 0);
});

test("a manual booking whose account a bank connection linked after the request's own check is refused inside its transaction", async context => {
  const {
    db
  } = await connectDatabase(context, () => []);

  await insertManualAccount(db);
  await db.insert(schema.requisitions).values({
    id: "linked",
    bank_name: "Example bank",
    bank_country: "AT",
    status: "LINKED"
  });
  await db.update(schema.accounts).set({
    provider: "enable_banking",
    provider_uid: "uid-checking",
    requisition_id: "linked"
  }).where(eq(schema.accounts.id, "imported"));

  await assert.rejects(createManualTransaction({
    accountId: "imported",
    currency: "EUR",
    date: "2026-11-01",
    amount: -1000,
    counterparty: "Synthetic shop",
    description: "",
    type: "expense",
    categoryId: null,
    categorySource: "manual",
    categoryRuleId: null
  }), {
    status: 409
  });
  assert.equal((await db.select().from(schema.transactions)).length, 0);
});

test("a targeted callback whose chosen bank account shares an identifier with another authorized account connects nothing", async context => {
  const {
    db,
    requests,
    actor
  } = await connectDatabase(context, () => [bankAccount("other", {
    identification_hash: "shared"
  }), bankAccount("same-iban", {
    identification_hash: "shared",
    account_id: {
      iban: "AT000000000000000001"
    }
  })]);

  await insertManualAccount(db);
  await startAuthorization(db, actor, "overlap", "imported");

  await assert.rejects(completeAuthorization("state-overlap", "browser-overlap", "code", actor), {
    status: 422
  });
  assert.deepEqual(requests.map(request => request.method), ["POST", "DELETE"]);
  assert.deepEqual((await db.select().from(schema.accounts)).map(row => [row.id, row.provider, row.provider_uid]), [["imported", "manual", null]]);
});
