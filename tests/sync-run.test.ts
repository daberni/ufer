import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { encrypt } from "../src/server/security/secret-box";
import { syncAccounts } from "../src/features/banking/server/sync-service";
import { syncLease } from "../src/server/jobs/lease";

const providerKey = generateKeyPairSync("rsa", {
  modulusLength: 2048
}).privateKey.export({
  type: "pkcs8",
  format: "pem"
}).toString();

const environmentNames = ["ENABLE_BANKING_ENVIRONMENT", "ENABLE_BANKING_APP_ID", "ENABLE_BANKING_PRIVATE_KEY", "DATA_ENCRYPTION_KEY"];

async function syncDatabase(context: TestContext, provider: (db: Database, path: string) => Promise<Response>) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousFetch = globalThis.fetch;
  const previousEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));

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
  globalThis.fetch = async input => provider(db, new URL(String(input)).pathname);

  await db.insert(schema.requisitions).values({
    id: "connection",
    bank_name: "Example institution",
    bank_country: "AT",
    status: "LINKED",
    valid_until: "2099-01-01T00:00:00Z",
    session_cipher: encrypt("session")
  });

  for (const id of ["first", "second"]) {
    await db.insert(schema.accounts).values({
      id,
      name: `Synthetic ${id}`,
      kind: "checking",
      provider: "enable_banking",
      provider_uid: `uid-${id}`,
      requisition_id: "connection"
    });
  }

  return db;
}

test("a sync that lost its lease aborts without touching accounts or the competing run", async context => {
  context.mock.method(console, "warn", () => {});
  const db = await syncDatabase(context, async (database, path) => {
    if (path === "/application") {
      return Response.json({
        environment: "SANDBOX",
        redirect_urls: []
      });
    }

    // A competing run takes over the lease and marks this run interrupted while the first account syncs.
    await database.update(schema.leases).set({
      owner: "competing-run"
    }).where(eq(schema.leases.name, syncLease));
    await database.update(schema.syncRuns).set({
      status: "INTERRUPTED",
      error: "The previous sync was interrupted."
    });

    return Response.json({
      balances: [],
      transactions: []
    });
  });

  await assert.rejects(syncAccounts(), {
    status: 409
  });

  const accounts = await db.select().from(schema.accounts);
  const runs = await db.select().from(schema.syncRuns);

  assert.deepEqual(accounts.map(account => account.sync_error), [null, null]);
  assert.deepEqual(runs.map(run => [run.status, run.error]), [["INTERRUPTED", "The previous sync was interrupted."]]);
  const lease = await db.select().from(schema.leases).get();

  assert.equal(lease?.owner, "competing-run");
});

test("a sync in which every account failed is recorded as failed", async context => {
  context.mock.method(console, "warn", () => {});
  const db = await syncDatabase(context, async (_database, path) => {
    if (path === "/application") {
      return Response.json({
        environment: "SANDBOX",
        redirect_urls: []
      });
    }

    return Response.json({
      error: "API_ERROR"
    }, {
      status: 500
    });
  });

  const result = await syncAccounts();
  const run = await db.select().from(schema.syncRuns).get();

  assert.equal(result.status, "FAILED");
  assert.equal(result.failures.length, 2);
  assert.equal(run?.status, "FAILED");
  assert.match(run?.error ?? "", /Synthetic first/);
});

test("a sync whose lease was taken by another operation records itself as interrupted", async context => {
  context.mock.method(console, "warn", () => {});
  const db = await syncDatabase(context, async (database, path) => {
    if (path === "/application") {
      return Response.json({
        environment: "SANDBOX",
        redirect_urls: []
      });
    }

    // Connection removal takes the expired lease without starting a sync run.
    await database.update(schema.leases).set({
      owner: "connection-removal"
    }).where(eq(schema.leases.name, syncLease));

    return Response.json({
      balances: [],
      transactions: []
    });
  });

  await assert.rejects(syncAccounts(), {
    status: 409
  });

  const accounts = await db.select().from(schema.accounts);
  const runs = await db.select().from(schema.syncRuns);

  assert.deepEqual(accounts.map(account => account.sync_error), [null, null]);
  assert.deepEqual(runs.map(run => [run.status, run.error]), [["INTERRUPTED", "The sync lost its lease and stopped."]]);
});
