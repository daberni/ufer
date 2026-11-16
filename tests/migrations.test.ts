import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Later changesets add columns, so upgrade tests compare only the columns that existed before the upgrade.
async function columnList(client: Client, table: string) {
  const columns = await client.execute({
    sql: "SELECT name FROM pragma_table_info(?)",
    args: [table]
  });

  return columns.rows.map(row => String(row.name)).join(",");
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
      applied: 4,
      pending: 0
    });
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM categories")).rows[0].count, 7);
    await assert.rejects(client.execute("INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,source) VALUES('snapshot','missing','2026-11-15',100,'manual')"), /FOREIGN KEY/);
  } finally {
    client.close();
  }
});

test("startup refuses a legacy database requiring authentication migration without changing user corrections", async () => {
  const client = await legacyDatabase();

  try {
    const schemaBefore = await client.execute("SELECT name,sql FROM sqlite_master ORDER BY name");

    await assert.rejects(initializeDatabase(client), /migrations are pending/);

    assert.deepEqual((await client.execute("SELECT name,sql FROM sqlite_master ORDER BY name")).rows, schemaBefore.rows);
    assert.deepEqual(await migrationStatus(client), {
      mode: "legacy",
      applied: 0,
      pending: 4
    });
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM categories")).rows[0].count, 1);
    await assertFinancialData(client);
  } finally {
    client.close();
  }
});

test("explicit legacy adoption preserves financial data and records each changeset only once", async () => {
  const client = await legacyDatabase();

  try {
    await migrateDatabase(client);
    await migrateDatabase(client);

    assert.deepEqual(await migrationStatus(client), {
      mode: "managed",
      applied: 4,
      pending: 0
    });
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM __drizzle_migrations")).rows[0].count, 4);
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
      applied: 4,
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
  cpSync("drizzle/sqlite", directory, {
    recursive: true
  });
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: journal.entries.at(-1).when + 1,
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
      applied: 5,
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

test("the auth upgrade preserves financial history and linked credentials while invalidating only unfinished bank flows", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-auth-"));
  const client = createClient({
    url: ":memory:"
  });
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));

  mkdirSync(join(directory, "meta"));
  cpSync("drizzle/sqlite/0000_initial_schema.sql", join(directory, "0000_initial_schema.sql"));
  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify({
    ...journal,
    entries: journal.entries.slice(0, 1)
  }));

  try {
    await migrateDatabase(client, directory);
    await client.batch([
      "INSERT INTO requisitions(id,environment,bank_name,bank_country,status,session_cipher,valid_until) VALUES('linked','SANDBOX','Example institution','AT','LINKED','unchanged-synthetic-ciphertext','2099-01-01')",
      "INSERT INTO requisitions(id,environment,bank_name,bank_country,status,state_hash) VALUES('pending','SANDBOX','Example institution','AT','PENDING','synthetic-pending-state')",
      "INSERT INTO accounts(id,environment,name,institution,kind,balance_minor,requisition_id) VALUES('asset','SANDBOX','Synthetic asset','Example institution','checking',12345,'linked')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source) VALUES('entry','asset','original-reference','2026-11-15',-2500,'EUR','groceries','manual')",
      "INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,source) VALUES('snapshot','asset','2026-11-15',12345,'sync')"
    ], "write");
    const financialBefore = await client.execute("SELECT * FROM accounts");
    const transactionColumns = await columnList(client, "transactions");
    const transactionsBefore = await client.execute(`SELECT ${transactionColumns} FROM transactions`);
    const historyBefore = await client.execute("SELECT * FROM balance_snapshots");

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    await migrateDatabase(client);

    assert.deepEqual((await client.execute("SELECT * FROM accounts")).rows, financialBefore.rows);
    assert.deepEqual((await client.execute(`SELECT ${transactionColumns} FROM transactions`)).rows, transactionsBefore.rows);
    assert.deepEqual((await client.execute("SELECT * FROM balance_snapshots")).rows, historyBefore.rows);
    const linked = (await client.execute("SELECT status,session_cipher,valid_until,workspace_id FROM requisitions WHERE id='linked'")).rows[0];

    assert.equal(linked.status, "LINKED");
    assert.equal(linked.session_cipher, "unchanged-synthetic-ciphertext");
    assert.equal(linked.valid_until, "2099-01-01");
    assert.equal(linked.workspace_id, "personal");
    assert.equal((await client.execute("SELECT status FROM requisitions WHERE id='pending'")).rows[0].status, "ERROR");
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM auth_users")).rows[0].count, 0);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='login_attempts'")).rows[0].count, 0);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});

test("the category icon upgrade adds an empty icon to existing categories without changing their data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-category-icons-"));
  const client = createClient({
    url: ":memory:"
  });
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));
  const previousEntries = journal.entries.slice(0, journal.entries.findIndex((entry: {
    tag: string
  }) => entry.tag === "0002_category_icons"));

  mkdirSync(join(directory, "meta"));

  for (const entry of previousEntries) {
    cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify({
    ...journal,
    entries: previousEntries
  }));

  try {
    await migrateDatabase(client, directory);
    await client.batch([
      "INSERT INTO categories(id,name,color) VALUES('custom','Custom category','#123456')",
      "INSERT INTO accounts(id,environment,name,institution,kind,balance_minor) VALUES('asset','SANDBOX','Synthetic asset','Example institution','checking',12345)",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source) VALUES('entry','asset','source-1','2026-11-15',-2500,'EUR','custom','manual')",
      "INSERT INTO categorization_rules(id,name,pattern,mode,category_id) VALUES('rule','Synthetic rule','MARKET','keyword','custom')"
    ], "write");
    const categoriesBefore = await client.execute("SELECT id,name,color,is_transfer FROM categories ORDER BY id");
    const transactionColumns = await columnList(client, "transactions");
    const transactionsBefore = await client.execute(`SELECT ${transactionColumns} FROM transactions`);
    const rulesBefore = await client.execute("SELECT * FROM categorization_rules");

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM pragma_table_info('categories') WHERE name='icon'")).rows[0].count, 0);
    await migrateDatabase(client);

    assert.deepEqual(await migrationStatus(client), {
      mode: "managed",
      applied: 4,
      pending: 0
    });
    assert.deepEqual((await client.execute("SELECT id,name,color,is_transfer FROM categories ORDER BY id")).rows, categoriesBefore.rows);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM categories WHERE icon IS NOT NULL")).rows[0].count, 0);
    assert.deepEqual((await client.execute(`SELECT ${transactionColumns} FROM transactions`)).rows, transactionsBefore.rows);
    assert.deepEqual((await client.execute("SELECT * FROM categorization_rules")).rows, rulesBefore.rows);
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});

test("the provider details upgrade keeps existing transactions unchanged and leaves their new columns empty", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-provider-details-"));
  const client = createClient({
    url: ":memory:"
  });
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));
  const previousEntries = journal.entries.slice(0, journal.entries.findIndex((entry: {
    tag: string
  }) => entry.tag === "0003_transaction_provider_details"));
  const providerColumns = ["value_date", "transaction_date", "bank_transaction_code", "bank_transaction_sub_code", "bank_transaction_description", "merchant_category_code", "exchange_rate", "exchange_rate_unit_currency", "exchange_rate_type", "instructed_amount_minor", "instructed_currency", "balance_after_minor", "balance_after_currency", "reference_number", "counterparty_iban", "counterparty_account_id", "counterparty_account_scheme", "counterparty_bic", "provider_payload"];

  mkdirSync(join(directory, "meta"));

  for (const entry of previousEntries) {
    cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify({
    ...journal,
    entries: previousEntries
  }));

  try {
    await migrateDatabase(client, directory);
    await client.batch([
      "INSERT INTO accounts(id,environment,name,institution,kind,balance_minor,provider,provider_uid) VALUES('bank','SANDBOX','Synthetic checking','Example institution','checking',12345,'enable_banking','synthetic-uid')",
      "INSERT INTO accounts(id,environment,name,institution,kind,balance_minor) VALUES('manual','SANDBOX','Synthetic savings','Example institution','savings',50000)",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,description,category_id,category_source,created_at) VALUES('synced','bank','bank:synthetic-1','2026-11-15',-2500,'EUR','Example Market','Synthetic purchase','groceries','rule','2026-11-15T08:00:00.000Z')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source,created_at) VALUES('corrected','bank','bank:synthetic-2','2026-11-14',-900,'EUR','leisure','manual','2026-11-15T08:00:00.000Z')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source,created_at) VALUES('imported','manual','csv:1','2026-11-13',10000,'EUR',NULL,'rule','2026-11-15T08:00:00.000Z')"
    ], "write");
    const transactionColumns = await columnList(client, "transactions");
    const transactionsBefore = await client.execute(`SELECT ${transactionColumns} FROM transactions ORDER BY id`);
    const accountsBefore = await client.execute("SELECT * FROM accounts ORDER BY id");

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM pragma_table_info('transactions') WHERE name='provider_payload'")).rows[0].count, 0);
    await migrateDatabase(client);

    assert.deepEqual(await migrationStatus(client), {
      mode: "managed",
      applied: 4,
      pending: 0
    });
    assert.equal(await columnList(client, "transactions"), `${transactionColumns},${providerColumns.join(",")}`);
    assert.deepEqual((await client.execute(`SELECT ${transactionColumns} FROM transactions ORDER BY id`)).rows, transactionsBefore.rows);
    assert.equal((await client.execute(`SELECT COUNT(*) AS count FROM transactions WHERE ${providerColumns.map(column => `${column} IS NOT NULL`).join(" OR ")}`)).rows[0].count, 0);
    assert.deepEqual((await client.execute("SELECT * FROM accounts ORDER BY id")).rows, accountsBefore.rows);
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});
