import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createClient, type InArgs, type InStatement } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { acquireLease } from "../src/server/jobs/lease-repository";
import { encrypt } from "../src/server/security/secret-box";
import { recordConnectionFailure, saveBankSession } from "../src/features/banking/server/connection-repository";
import { verifyApplication } from "../src/features/banking/server/enable-banking-client";
import { removeBankConnection } from "../src/features/banking/server/connection-service";
import { saveSessionAccounts } from "../src/features/banking/server/bank-account-repository";
import { listSyncAccounts } from "../src/features/banking/server/sync-repository";
import { syncAccounts } from "../src/features/banking/server/sync-service";
import { listConnections } from "../src/features/banking/server/banking-queries";
import { listAccounts, readNetWorth } from "../src/features/accounts/server/account-queries";

const providerKey = generateKeyPairSync("rsa", {
  modulusLength: 2048
}).privateKey.export({
  type: "pkcs8",
  format: "pem"
}).toString();

const environmentNames = ["ENABLE_BANKING_ENVIRONMENT", "ENABLE_BANKING_APP_ID", "ENABLE_BANKING_PRIVATE_KEY", "DATA_ENCRYPTION_KEY"];

async function bankingDatabase(context: TestContext, providerResponse: (request: {
  method: string;
  path: string
}) => Response) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousFetch = globalThis.fetch;
  const previousEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
  const requests: {
    method: string;
    path: string
  }[] = [];

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

  await initializeDatabase(client);
  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";
  process.env.ENABLE_BANKING_APP_ID = "synthetic-app";
  process.env.ENABLE_BANKING_PRIVATE_KEY = providerKey;
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  globalThis.fetch = async (input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname
    });

    return providerResponse(requests[requests.length - 1]);
  };

  return {
    db,
    requests
  };
}

async function insertLinkedConnection(db: Database, id: string, accountId: string) {
  await db.insert(schema.requisitions).values({
    id,
    bank_name: "Example institution",
    bank_country: "AT",
    status: "LINKED",
    valid_until: "2099-01-01T00:00:00Z",
    session_cipher: encrypt(`session-${id}`)
  });
  await db.insert(schema.accounts).values({
    id: accountId,
    name: "Synthetic account",
    institution: "Example institution",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: `uid-${accountId}`,
    requisition_id: id,
    balance_minor: 12345,
    balance_date: "2000-01-31",
    sync_error: "Synthetic earlier failure."
  });
  await db.insert(schema.accountIdentifiers).values({
    identification_hash: `hash-${accountId}`,
    account_id: accountId
  });
}

test("removing a bank connection keeps accounts and history, deletes its credential and stops syncing it", async context => {
  const {
    db,
    requests
  } = await bankingDatabase(context, () => Response.json({
    message: "OK"
  }));

  await insertLinkedConnection(db, "removed", "removed-account");
  await insertLinkedConnection(db, "kept", "kept-account");
  await db.insert(schema.transactions).values({
    id: "history",
    account_id: "removed-account",
    provider_reference: "bank:synthetic-history",
    booking_date: "2000-01-10",
    amount_minor: -500,
    currency: "EUR",
    type: "expense",
    counterparty: "Example payee"
  });
  await db.insert(schema.balanceSnapshots).values({
    id: "snapshot",
    account_id: "removed-account",
    observed_at: "2000-01-31",
    amount_minor: 12345,
    source: "sync"
  });

  assert.deepEqual(await removeBankConnection("removed"), {
    retainedAccounts: 1,
    notArchived: []
  });
  assert.deepEqual(requests, [{
    method: "DELETE",
    path: "/sessions/session-removed"
  }]);

  const connection = await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "removed")).get();
  const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, "removed-account")).get();

  assert.equal(connection?.status, "REMOVED");
  assert.equal(connection?.session_cipher, null);
  assert.equal(account?.requisition_id, null);
  assert.equal(account?.balance_minor, 12345);
  assert.equal(account?.sync_error, null);
  assert.equal((await db.select().from(schema.transactions)).length, 1);
  assert.equal((await db.select().from(schema.balanceSnapshots)).length, 1);
  assert.deepEqual((await listSyncAccounts()).map(item => item.id), ["kept-account"]);

  assert.deepEqual((await listConnections()).map(item => item.id), ["kept"]);
  assert.equal((await listAccounts()).length, 2);

  await assert.rejects(removeBankConnection("removed"), {
    status: 404
  });
  await assert.rejects(removeBankConnection("unknown"), {
    status: 404
  });
  assert.equal(requests.length, 1);

  // A later authorization of the same bank continues the retained account instead of duplicating it.
  await db.insert(schema.requisitions).values({
    id: "renewed",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "EXCHANGING",
    valid_until: "2099-01-01T00:00:00Z"
  });
  await saveSessionAccounts("renewed", "Example institution", "2099-01-01T00:00:00Z", [{
    uid: "renewed-uid",
    identification_hash: "hash-removed-account",
    currency: "EUR"
  }]);
  assert.equal((await db.select().from(schema.accounts)).length, 2);
  assert.equal((await db.select().from(schema.accounts).where(eq(schema.accounts.id, "removed-account")).get())?.requisition_id, "renewed");
  assert.equal((await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "removed")).get())?.status, "REMOVED");
});

test("disconnecting a bank archives only its accounts with a balance of 0 and names the ones that stay active", async context => {
  const {
    db,
    requests
  } = await bankingDatabase(context, () => Response.json({
    message: "OK"
  }));

  await insertLinkedConnection(db, "archived-bank", "archived-account");
  await insertLinkedConnection(db, "other-bank", "other-account");
  await db.update(schema.accounts).set({
    balance_minor: 0
  }).where(eq(schema.accounts.id, "archived-account"));
  await db.insert(schema.accounts).values({
    id: "unsettled-account",
    name: "Synthetic unsettled account",
    institution: "Example institution",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: "uid-unsettled-account",
    requisition_id: "archived-bank",
    balance_minor: 4200,
    balance_date: "2000-01-31"
  });
  await db.insert(schema.transactions).values({
    id: "archived-history",
    account_id: "archived-account",
    provider_reference: "bank:synthetic-archived-history",
    booking_date: "2000-01-10",
    amount_minor: -500,
    currency: "EUR",
    type: "expense",
    counterparty: "Example payee"
  });
  const netWorthBefore = await readNetWorth("EUR");

  assert.deepEqual(await removeBankConnection("archived-bank", {
    archiveAccounts: true
  }), {
    retainedAccounts: 2,
    notArchived: ["Synthetic unsettled account"]
  });
  assert.deepEqual(requests, [{
    method: "DELETE",
    path: "/sessions/session-archived-bank"
  }]);

  const accountsAfter = await listAccounts();
  const archived = accountsAfter.find(account => account.id === "archived-account");

  assert.ok(archived?.archived_at);
  assert.equal(archived.requisition_id, null);
  assert.equal(archived.balance_minor, 0);
  assert.equal(accountsAfter.find(account => account.id === "unsettled-account")?.archived_at, null);
  assert.equal(accountsAfter.find(account => account.id === "unsettled-account")?.requisition_id, null);
  assert.equal(accountsAfter.find(account => account.id === "other-account")?.archived_at, null);
  assert.equal((await db.select().from(schema.transactions)).length, 1);
  assert.deepEqual(await readNetWorth("EUR"), netWorthBefore);
  assert.deepEqual((await listSyncAccounts()).map(item => item.id), ["other-account"]);
});

test("sync skips an archived account of a linked connection and resumes it once restored", async context => {
  const {
    db,
    requests
  } = await bankingDatabase(context, request => {
    if (request.path === "/application") {
      return Response.json({
        environment: "SANDBOX",
        redirect_urls: []
      });
    }

    if (request.path.endsWith("/balances")) {
      return Response.json({
        balances: [{
          balance_type: "CLBD",
          balance_amount: {
            amount: "200.00",
            currency: "EUR"
          },
          reference_date: "2000-02-01"
        }]
      });
    }

    const uid = request.path.split("/")[2];

    return Response.json({
      transactions: [{
        entry_reference: `booking-${uid}`,
        transaction_amount: {
          amount: "5.00",
          currency: "EUR"
        },
        credit_debit_indicator: "DBIT",
        status: "BOOK",
        booking_date: "2000-01-15"
      }],
      continuation_key: null
    });
  });

  await insertLinkedConnection(db, "shared", "active-account");
  await db.insert(schema.accounts).values({
    id: "archived-account",
    name: "Synthetic archived account",
    institution: "Example institution",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: "uid-archived-account",
    requisition_id: "shared",
    balance_minor: 12345,
    balance_date: "2000-01-31",
    archived_at: "2000-02-01T00:00:00.000Z"
  });
  const archivedBefore = await db.select().from(schema.accounts).where(eq(schema.accounts.id, "archived-account")).get();

  assert.equal((await syncAccounts()).status, "SUCCESS");
  assert.equal(requests.some(request => request.path.includes("uid-archived-account")), false);
  assert.ok(requests.some(request => request.path.includes("uid-active-account")));
  assert.deepEqual(await db.select().from(schema.accounts).where(eq(schema.accounts.id, "archived-account")).get(), archivedBefore);
  assert.deepEqual((await db.select().from(schema.transactions)).map(booking => booking.account_id), ["active-account"]);
  assert.equal((await db.select().from(schema.balanceSnapshots).where(eq(schema.balanceSnapshots.account_id, "archived-account"))).length, 0);

  await db.update(schema.accounts).set({
    archived_at: null
  }).where(eq(schema.accounts.id, "archived-account"));
  assert.equal((await syncAccounts()).status, "SUCCESS");
  assert.ok(requests.some(request => request.path.includes("uid-archived-account")));
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "archived-account"))).length, 1);
  assert.equal((await db.select().from(schema.accounts).where(eq(schema.accounts.id, "archived-account")).get())?.balance_minor, 20000);
});

test("a failed revocation leaves the connection intact for an explicit retry, without background retries", async context => {
  context.mock.method(console, "warn", () => {});
  let providerAvailable = false;
  const {
    db,
    requests
  } = await bankingDatabase(context, request => {
    if (request.method === "DELETE") {
      return providerAvailable ? new Response(null, {
        status: 204
      }) : Response.json({
        error: "API_ERROR"
      }, {
        status: 503
      });
    }

    if (request.path === "/application") {
      return Response.json({
        environment: "SANDBOX",
        redirect_urls: []
      });
    }

    if (request.path.endsWith("/balances")) {
      return Response.json({
        balances: [{
          balance_type: "CLBD",
          balance_amount: {
            amount: "123.45",
            currency: "EUR"
          },
          reference_date: "2000-01-31"
        }]
      });
    }

    return Response.json({
      transactions: [],
      continuation_key: null
    });
  });

  await insertLinkedConnection(db, "unrevoked", "unrevoked-account");
  const connectionBefore = await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "unrevoked")).get();
  const accountBefore = await db.select().from(schema.accounts).where(eq(schema.accounts.id, "unrevoked-account")).get();

  await assert.rejects(removeBankConnection("unrevoked"), {
    status: 502,
    message: "The bank authorization could not be revoked. The connection has not been removed. Try again."
  });
  assert.deepEqual(await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "unrevoked")).get(), connectionBefore);
  assert.deepEqual(await db.select().from(schema.accounts).where(eq(schema.accounts.id, "unrevoked-account")).get(), accountBefore);
  assert.deepEqual((await listConnections()).map(connection => connection.id), ["unrevoked"]);

  assert.equal((await syncAccounts()).status, "SUCCESS");
  assert.equal(requests.filter(request => request.method === "DELETE").length, 1);
  assert.notEqual((await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "unrevoked")).get())?.session_cipher, null);

  providerAvailable = true;
  assert.deepEqual(await removeBankConnection("unrevoked"), {
    retainedAccounts: 1,
    notArchived: []
  });
  assert.equal(requests.filter(request => request.method === "DELETE").length, 2);
  const removed = await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "unrevoked")).get();

  assert.equal(removed?.status, "REMOVED");
  assert.equal(removed?.session_cipher, null);
  assert.equal((await db.select().from(schema.accounts).where(eq(schema.accounts.id, "unrevoked-account")).get())?.requisition_id, null);
});

test("a session the provider reports as ended counts as revoked and its stored ID is deleted", async context => {
  const endedSessions = [["EXPIRED_SESSION", 400], ["CLOSED_SESSION", 400], ["REVOKED_SESSION", 400], ["SESSION_DOES_NOT_EXIST", 404]] as const;
  let current: (typeof endedSessions)[number] = endedSessions[0];
  const {
    db,
    requests
  } = await bankingDatabase(context, () => Response.json({
    message: "Synthetic provider error",
    code: current[1],
    error: current[0]
  }, {
    status: current[1]
  }));

  for (const ended of endedSessions) {
    const id = ended[0].toLowerCase();

    current = ended;
    await insertLinkedConnection(db, id, `${id}-account`);

    assert.deepEqual(await removeBankConnection(id), {
      retainedAccounts: 1,
      notArchived: []
    }, ended[0]);
    assert.equal((await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, id)).get())?.session_cipher, null, ended[0]);
  }

  // A later sync finds nothing left to revoke.
  await syncAccounts();
  assert.equal(requests.length, endedSessions.length);
});

test("removal does not interfere with a running sync or an authorization callback in progress", async context => {
  const {
    db,
    requests
  } = await bankingDatabase(context, () => Response.json({
    message: "OK"
  }));

  await insertLinkedConnection(db, "syncing", "syncing-account");
  await db.insert(schema.requisitions).values({
    id: "exchanging",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "EXCHANGING",
    used_at: new Date().toISOString()
  });
  assert.equal(await acquireLease("sync", "synthetic-sync"), true);

  await assert.rejects(removeBankConnection("syncing"), {
    status: 409
  });
  assert.equal((await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "syncing")).get())?.status, "LINKED");
  assert.equal((await db.select().from(schema.leases).get())?.owner, "synthetic-sync");

  await db.delete(schema.leases);
  await assert.rejects(removeBankConnection("exchanging"), {
    status: 409
  });
  assert.equal((await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "exchanging")).get())?.status, "EXCHANGING");
  assert.equal((await db.select().from(schema.leases)).length, 0);
  assert.equal(requests.length, 0);
});

test("a connection removed while its callback is mapping accounts is never linked or revived", async context => {
  const {
    db,
    requests
  } = await bankingDatabase(context, () => Response.json({
    message: "OK"
  }));
  const consumedLongAgo = new Date(Date.now() - 10 * 60_000).toISOString();

  await db.insert(schema.requisitions).values({
    id: "overlap",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "EXCHANGING",
    used_at: consumedLongAgo
  });

  // Callback step 1: the session is stored, but the connection is not linked before its accounts are mapped.
  assert.equal(await saveBankSession("overlap", encrypt("session-overlap"), "2099-01-01T00:00:00Z"), true);
  assert.equal((await db.select().from(schema.requisitions).get())?.status, "EXCHANGING");

  assert.deepEqual(await removeBankConnection("overlap"), {
    retainedAccounts: 0,
    notArchived: []
  });
  assert.deepEqual(requests, [{
    method: "DELETE",
    path: "/sessions/session-overlap"
  }]);

  // Callback step 2 and its failure handling run after the removal.
  await assert.rejects(saveSessionAccounts("overlap", "Example institution", "2099-01-01T00:00:00Z", [{
    uid: "overlap-uid",
    identification_hash: "overlap-hash",
    currency: "EUR"
  }]), {
    status: 409
  });
  await recordConnectionFailure("overlap", "The bank connection was removed during authorization.");
  assert.equal(await saveBankSession("overlap", encrypt("session-late"), "2099-01-01T00:00:00Z"), false);

  const connection = await db.select().from(schema.requisitions).get();

  assert.equal(connection?.status, "REMOVED");
  assert.equal(connection?.session_cipher, null);
  assert.equal((await db.select().from(schema.accounts)).length, 0);
  assert.equal((await db.select().from(schema.accountIdentifiers)).length, 0);
});

test("a callback completing after removal preflight keeps its new session until an explicit removal retry", async context => {
  const {
    db,
    requests
  } = await bankingDatabase(context, () => new Response(null, {
    status: 204
  }));

  await db.insert(schema.requisitions).values({
    id: "pending-overlap",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "PENDING"
  });
  const execute = db.$client.execute.bind(db.$client);
  const createdSessionCipher = encrypt("session-created-during-removal");
  let linkedDuringPreflight = false;

  context.mock.method(db.$client, "execute", async (statement: InStatement, args?: InArgs) => {
    const result = typeof statement === "string" ? await execute(statement, args) : await execute(statement);
    const sql = typeof statement === "string" ? statement : statement.sql;

    if (!linkedDuringPreflight && /^select /i.test(sql) && sql.includes('from "requisitions"')) {
      linkedDuringPreflight = true;
      // The query already read PENDING without a credential; finish the callback before removal resumes with that stale result.
      await db.update(schema.requisitions).set({
        status: "EXCHANGING",
        used_at: new Date().toISOString()
      }).where(eq(schema.requisitions.id, "pending-overlap"));
      assert.equal(await saveBankSession("pending-overlap", createdSessionCipher, "2099-01-01T00:00:00Z"), true);
      await saveSessionAccounts("pending-overlap", "Example institution", "2099-01-01T00:00:00Z", [{
        uid: "new-uid",
        identification_hash: "new-hash",
        currency: "EUR"
      }]);
    }

    return result;
  });

  await assert.rejects(removeBankConnection("pending-overlap"), {
    status: 409,
    message: "The bank connection changed during removal. Try again."
  });
  assert.equal(linkedDuringPreflight, true);
  const linked = await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "pending-overlap")).get();

  assert.equal(linked?.status, "LINKED");
  assert.equal(linked?.session_cipher, createdSessionCipher);
  assert.equal((await db.select().from(schema.accounts).get())?.requisition_id, "pending-overlap");
  assert.deepEqual(requests, []);

  assert.deepEqual(await removeBankConnection("pending-overlap"), {
    retainedAccounts: 1,
    notArchived: []
  });
  assert.deepEqual(requests, [{
    method: "DELETE",
    path: "/sessions/session-created-during-removal"
  }]);
  assert.equal((await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "pending-overlap")).get())?.session_cipher, null);
  assert.equal((await db.select().from(schema.accounts).get())?.requisition_id, null);
});

test("a provider session revocation answered without a body counts as revoked", async context => {
  const {
    db
  } = await bankingDatabase(context, () => new Response(null, {
    status: 204
  }));

  await insertLinkedConnection(db, "no-body", "no-body-account");

  assert.deepEqual(await removeBankConnection("no-body"), {
    retainedAccounts: 1,
    notArchived: []
  });
});

test("an unreadable provider success body is a 502 provider failure, not a 400 about user input", async context => {
  await bankingDatabase(context, () => new Response("<html>maintenance</html>", {
    status: 200
  }));

  await assert.rejects(verifyApplication(), {
    status: 502
  });
  await assert.rejects(verifyApplication(), (error: Error) => !/input/i.test(error.message));
});
