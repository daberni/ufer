import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { initializeDatabase, migrateDatabase, migrationStatus } from "../src/server/database/migrations";

async function legacyDatabase(transform: (sql: string) => string = sql => sql) {
  const client = createClient({
    url: ":memory:"
  });
  const fixture = readFileSync("tests/fixtures/legacy-schema.sql", "utf8");

  await client.batch(transform(fixture).split("--> statement-breakpoint"), "write");
  await client.batch([
    "INSERT INTO categories(id,name,color) VALUES('custom','Custom category','#123456')",
    "INSERT INTO accounts(id,environment,name,institution,kind,currency,balance_minor) VALUES('asset','SANDBOX','Synthetic asset','Example institution','savings','EUR',12345)",
    "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source) VALUES('entry','asset','source-1','2026-11-15',2500,'EUR','custom','manual')",
  ], "write");

  return client;
}

async function assertFinancialData(client: Client) {
  const account = await client.execute("SELECT balance_minor FROM accounts WHERE id='asset'");
  const transaction = await client.execute("SELECT amount_minor,category_id,category_source FROM transactions WHERE id='entry'");
  const category = await client.execute("SELECT name FROM categories WHERE id='custom'");

  assert.equal(account.rows[0].balance_minor, 12345);
  assert.deepEqual({
    ...transaction.rows[0]
  }, {
    amount_minor: 2500,
    category_id: "custom",
    category_source: "manual"
  });
  assert.equal(category.rows[0].name, "Custom category");
}

test("a fresh database receives a recorded baseline and enforces account references", async () => {
  const client = createClient({
    url: ":memory:"
  });

  try {
    await initializeDatabase(client);

    assert.deepEqual(await migrationStatus(client), {
      mode: "managed",
      applied: 1,
      pending: 0
    });
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM categories")).rows[0].count, 7);
    await assert.rejects(client.execute("INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,source) VALUES('snapshot','missing','2026-11-15',100,'manual')"), /FOREIGN KEY/);
  } finally {
    client.close();
  }
});

test("startup leaves a recognized legacy database and user corrections unchanged", async () => {
  const client = await legacyDatabase();

  try {
    const schemaBefore = await client.execute("SELECT name,sql FROM sqlite_master ORDER BY name");

    await initializeDatabase(client);

    assert.deepEqual((await client.execute("SELECT name,sql FROM sqlite_master ORDER BY name")).rows, schemaBefore.rows);
    assert.deepEqual(await migrationStatus(client), {
      mode: "legacy",
      applied: 0,
      pending: 1
    });
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM categories")).rows[0].count, 1);
    await assertFinancialData(client);
  } finally {
    client.close();
  }
});

test("explicit legacy adoption preserves financial data and records the baseline only once", async () => {
  const client = await legacyDatabase();

  try {
    await migrateDatabase(client);
    await migrateDatabase(client);

    assert.deepEqual(await migrationStatus(client), {
      mode: "managed",
      applied: 1,
      pending: 0
    });
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM __drizzle_migrations")).rows[0].count, 1);
    await assertFinancialData(client);
  } finally {
    client.close();
  }
});

test("an unknown legacy shape is rejected before creating migration history", async () => {
  const client = await legacyDatabase();

  try {
    await client.execute("ALTER TABLE accounts ADD COLUMN unsupported_extension TEXT");

    await assert.rejects(initializeDatabase(client), /differs from the known legacy schema/);
    await assert.rejects(migrateDatabase(client), /differs from the known legacy schema/);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='__drizzle_migrations'")).rows[0].count, 0);
    await assertFinancialData(client);
  } finally {
    client.close();
  }
});

test("changed or unknown migration history is rejected without rewriting it", async () => {
  const client = createClient({
    url: ":memory:"
  });

  try {
    await initializeDatabase(client);
    await client.execute("UPDATE __drizzle_migrations SET hash='changed'");

    await assert.rejects(initializeDatabase(client), /Migration history differs/);
    await assert.rejects(migrateDatabase(client), /Migration history differs/);
    assert.equal((await client.execute("SELECT hash FROM __drizzle_migrations")).rows[0].hash, "changed");
  } finally {
    client.close();
  }
});

test("legacy comparison preserves literal case and whitespace instead of accepting changed constraints", async () => {
  const transforms = [
    (sql: string) => sql.replace("'checking'", "'CHECKING'"),
    (sql: string) => sql.replace("provider TEXT NOT NULL DEFAULT 'manual'", "provider TEXT NOT NULL DEFAULT 'man ual'"),
  ];

  for (const transform of transforms) {
    const client = await legacyDatabase(transform);

    try {
      await assert.rejects(migrationStatus(client), /differs from the known legacy schema/);
    } finally {
      client.close();
    }
  }
});

test("legacy adoption refuses undeclared triggers and views before recording a baseline", async () => {
  const changes = [
    "CREATE TRIGGER unexpected_hook AFTER UPDATE ON accounts BEGIN SELECT 1; END",
    "CREATE VIEW unexpected_projection AS SELECT id FROM accounts",
  ];

  for (const change of changes) {
    const client = await legacyDatabase();

    try {
      await client.execute(change);

      await assert.rejects(migrateDatabase(client), /differs from the known legacy schema/);
      assert.equal((await client.execute("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='__drizzle_migrations'")).rows[0].count, 0);
    } finally {
      client.close();
    }
  }
});

test("a managed database with pending changes refuses startup until explicit maintenance", async () => {
  const client = await legacyDatabase();

  try {
    await client.execute("CREATE TABLE __drizzle_migrations(id SERIAL PRIMARY KEY,hash text NOT NULL,created_at numeric)");

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM __drizzle_migrations")).rows[0].count, 0);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM categories")).rows[0].count, 1);
    await assertFinancialData(client);
    await migrateDatabase(client);

    assert.deepEqual(await migrationStatus(client), {
      mode: "managed",
      applied: 1,
      pending: 0
    });
    await assertFinancialData(client);
  } finally {
    client.close();
  }
});

test("a recognized legacy database cannot start against application changes beyond its baseline", async () => {
  const client = await legacyDatabase();
  const directory = mkdtempSync(join(tmpdir(), "ufer-migration-review-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));

  mkdirSync(join(directory, "meta"));
  copyFileSync("drizzle/sqlite/0000_initial_schema.sql", join(directory, "0000_initial_schema.sql"));
  journal.entries.push({
    idx: 1,
    version: "6",
    when: journal.entries[0].when + 1,
    tag: "0001_synthetic_extension",
    breakpoints: true
  });
  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify(journal));
  writeFileSync(join(directory, "0001_synthetic_extension.sql"), "ALTER TABLE accounts ADD COLUMN synthetic_extension INTEGER NOT NULL DEFAULT 0;");

  try {
    const schemaBefore = await client.execute("SELECT name,sql FROM sqlite_master ORDER BY name");

    await assert.rejects(initializeDatabase(client, directory), /migrations are pending/);
    assert.deepEqual((await client.execute("SELECT name,sql FROM sqlite_master ORDER BY name")).rows, schemaBefore.rows);
    await assertFinancialData(client);
    await migrateDatabase(client, directory);

    assert.deepEqual(await migrationStatus(client, directory), {
      mode: "managed",
      applied: 2,
      pending: 0
    });
    assert.equal((await client.execute("SELECT synthetic_extension FROM accounts WHERE id='asset'")).rows[0].synthetic_extension, 0);
    await assertFinancialData(client);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});
