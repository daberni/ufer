import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient, type InStatement } from "@libsql/client";
import { initializeDatabase, migrateDatabaseUnderLease, migrationReport } from "../src/server/database/migrations";
import { timestamp } from "../src/lib/time";
import { olderRelease } from "./fixtures/older-release";

test("the migration report names exactly the changesets a release would apply, in order", async context => {
  const directory = mkdtempSync(join(tmpdir(), "ufer-migration-report-"));
  const client = createClient({
    url: `file:${join(directory, "database.sqlite")}`
  });

  context.after(() => {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  });

  await initializeDatabase(client, olderRelease(directory, 20));

  const report = await migrationReport(client);
  const all = (await migrationReport(createClient({
    url: ":memory:"
  }))).pendingChangesets;

  assert.equal(report.applied, 20);
  assert.equal(report.pending, all.length - 20);
  assert.deepEqual(report.pendingChangesets, all.slice(20));
  assert.match(report.pendingChangesets[0], /^0020_.+\.sql$/);
});

async function olderDatabase(context: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ufer-migration-lease-"));
  const client = createClient({
    url: `file:${join(directory, "database.sqlite")}`
  });

  context.after(() => {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  });

  await initializeDatabase(client, olderRelease(directory, 20));

  return client;
}

test("a migration waits for the sync lease and gives up without changing anything while a sync holds it", async context => {
  const client = await olderDatabase(context);

  await client.execute({
    sql: "INSERT INTO leases (name, owner, expires_at) VALUES ('sync', 'running-sync', ?)",
    args: [timestamp(Temporal.Now.instant().add({
      minutes: 5
    }))]
  });

  await assert.rejects(migrateDatabaseUnderLease(client, "sync", {
    waitMinutes: 0,
    pollMilliseconds: 1
  }), /lease stayed busy/);
  assert.equal((await migrationReport(client)).applied, 20);
  assert.equal((await client.execute("SELECT owner FROM leases WHERE name = 'sync'")).rows[0]?.owner, "running-sync");
});

test("a migration takes an expired or free sync lease, applies the changesets and releases the lease", async context => {
  const client = await olderDatabase(context);

  await client.execute({
    sql: "INSERT INTO leases (name, owner, expires_at) VALUES ('sync', 'crashed-sync', ?)",
    args: [timestamp(Temporal.Now.instant().subtract({
      minutes: 1
    }))]
  });

  const status = await migrateDatabaseUnderLease(client, "sync", {
    waitMinutes: 0,
    pollMilliseconds: 1
  });

  assert.equal(status.pending, 0);
  assert.equal((await client.execute("SELECT COUNT(*) AS count FROM leases WHERE name = 'sync'")).rows[0]?.count, 0);
});

test("a migration that committed still succeeds when releasing the lease fails", async context => {
  const client = await olderDatabase(context);
  const failingRelease = new Proxy(client, {
    get(target, property) {
      if (property === "execute") {
        return async (statement: InStatement) => {
          const sql = typeof statement === "string" ? statement : statement.sql;

          if (sql.startsWith("DELETE FROM leases")) {
            throw new Error("connection lost");
          }

          return target.execute(statement);
        };
      }

      const value = Reflect.get(target, property, target);

      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const warnings: unknown[] = [];
  const warn = console.warn;

  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  context.after(() => {
    console.warn = warn;
  });

  const status = await migrateDatabaseUnderLease(failingRelease, "sync", {
    waitMinutes: 0,
    pollMilliseconds: 1
  });

  assert.equal(status.pending, 0);
  assert.equal(warnings.length, 1);
});
