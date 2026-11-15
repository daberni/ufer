import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { acquireLease } from "../src/server/jobs/lease-repository";
import { encrypt } from "../src/server/security/secret-box";
import { recordConnectionFailure, saveBankSession } from "../src/features/banking/server/connection-repository";
import { removeBankConnection } from "../src/features/banking/server/connection-service";
import { saveSessionAccounts } from "../src/features/banking/server/bank-account-repository";
import { listSyncAccounts } from "../src/features/banking/server/sync-repository";
import { readDashboardState } from "../src/features/dashboard/server/dashboard-query";
import { dashboardFilters } from "../src/features/dashboard/server/dashboard-filters";

const providerKey = generateKeyPairSync("rsa", {
  modulusLength: 2048
}).privateKey.export({
  type: "pkcs8",
  format: "pem"
}).toString();

const environmentNames = ["ENABLE_BANKING_ENVIRONMENT", "ENABLE_BANKING_APP_ID", "ENABLE_BANKING_PRIVATE_KEY", "DATA_ENCRYPTION_KEY"];

async function bankingDatabase(context: TestContext, providerResponse: () => Response) {
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

    return providerResponse();
  };

  return {
    db,
    requests
  };
}

async function insertLinkedConnection(db: Database, id: string, accountId: string) {
  await db.insert(schema.requisitions).values({
    id,
    environment: "SANDBOX",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "LINKED",
    valid_until: "2099-01-01T00:00:00Z",
    session_cipher: encrypt(`session-${id}`)
  });
  await db.insert(schema.accounts).values({
    id: accountId,
    environment: "SANDBOX",
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
    environment: "SANDBOX",
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
    providerRevocation: "revoked"
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
  assert.deepEqual((await listSyncAccounts(db, "SANDBOX")).map(item => item.id), ["kept-account"]);

  const state = await readDashboardState(dashboardFilters(new URLSearchParams()));

  assert.deepEqual(state.connections.map(item => item.id), ["kept"]);
  assert.equal(state.accounts.length, 2);

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
    environment: "SANDBOX",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "EXCHANGING",
    valid_until: "2099-01-01T00:00:00Z"
  });
  await saveSessionAccounts(db, "SANDBOX", "renewed", "Example institution", [{
    uid: "renewed-uid",
    identification_hash: "hash-removed-account",
    currency: "EUR"
  }]);
  assert.equal((await db.select().from(schema.accounts)).length, 2);
  assert.equal((await db.select().from(schema.accounts).where(eq(schema.accounts.id, "removed-account")).get())?.requisition_id, "renewed");
  assert.equal((await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, "removed")).get())?.status, "REMOVED");
});

test("local removal completes when the provider cannot revoke the session", async context => {
  context.mock.method(console, "warn", () => {});
  const {
    db,
    requests
  } = await bankingDatabase(context, () => Response.json({
    error: "API_ERROR"
  }, {
    status: 500
  }));

  await insertLinkedConnection(db, "unrevoked", "unrevoked-account");
  await db.insert(schema.requisitions).values({
    id: "pending",
    environment: "SANDBOX",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "PENDING"
  });

  assert.deepEqual(await removeBankConnection("unrevoked"), {
    retainedAccounts: 1,
    providerRevocation: "not_revoked"
  });
  assert.deepEqual(await removeBankConnection("pending"), {
    retainedAccounts: 0,
    providerRevocation: "no_session"
  });
  assert.equal(requests.length, 1);

  const connections = await db.select().from(schema.requisitions);

  assert.ok(connections.every(connection => connection.status === "REMOVED" && connection.session_cipher === null));
  assert.equal((await listSyncAccounts(db, "SANDBOX")).length, 0);
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
    environment: "SANDBOX",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "EXCHANGING",
    used_at: new Date().toISOString()
  });
  assert.equal(await acquireLease(db, "sync:SANDBOX", "synthetic-sync"), true);

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
    environment: "SANDBOX",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "EXCHANGING",
    used_at: consumedLongAgo
  });

  // Callback step 1: the session is stored, but the connection is not linked before its accounts are mapped.
  assert.equal(await saveBankSession(db, "overlap", encrypt("session-overlap"), "2099-01-01T00:00:00Z"), true);
  assert.equal((await db.select().from(schema.requisitions).get())?.status, "EXCHANGING");

  assert.deepEqual(await removeBankConnection("overlap"), {
    retainedAccounts: 0,
    providerRevocation: "revoked"
  });
  assert.deepEqual(requests, [{
    method: "DELETE",
    path: "/sessions/session-overlap"
  }]);

  // Callback step 2 and its failure handling run after the removal.
  await assert.rejects(saveSessionAccounts(db, "SANDBOX", "overlap", "Example institution", [{
    uid: "overlap-uid",
    identification_hash: "overlap-hash",
    currency: "EUR"
  }]), {
    status: 409
  });
  await recordConnectionFailure(db, "overlap", "The bank connection was removed during authorization.");
  assert.equal(await saveBankSession(db, "overlap", encrypt("session-late"), "2099-01-01T00:00:00Z"), false);

  const connection = await db.select().from(schema.requisitions).get();

  assert.equal(connection?.status, "REMOVED");
  assert.equal(connection?.session_cipher, null);
  assert.equal((await db.select().from(schema.accounts)).length, 0);
  assert.equal((await db.select().from(schema.accountIdentifiers)).length, 0);
});
