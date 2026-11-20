import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Temporal } from "temporal-polyfill";
import { initializeDatabase, migrateDatabase, migrationStatus } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { listAccounts } from "../src/features/accounts/server/account-queries";
import { monthPeriod } from "../src/lib/period";

const changesetCount = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8")).entries.length;

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

// Changeset 0007 moves a manual account's balance from the stored column into its transactions, so a balance is read from whichever holds it.
const currentBalance = "COALESCE(balance_minor,(SELECT SUM(t.amount_minor) FROM transactions t WHERE t.account_id=accounts.id)) AS balance";

/** Accounts with their current balance; comparable across every upgrade. */
async function accountState(client: Client) {
  return (await client.execute(`SELECT id,environment,name,institution,kind,currency,provider,provider_uid,requisition_id,iban,last_synced_at,sync_error,${currentBalance} FROM accounts ORDER BY id`)).rows;
}

/** Transactions that existed before changeset 0007 booked manual balances as transactions. */
async function originalTransactions(client: Client, columns: string) {
  return (await client.execute(`SELECT ${columns} FROM transactions WHERE provider_reference NOT LIKE 'manual:%' ORDER BY id`)).rows;
}

async function assertFinancialData(client: Client) {
  const account = await client.execute(`SELECT ${currentBalance} FROM accounts WHERE id='asset'`);
  const transaction = await client.execute("SELECT amount_minor,category_id,category_source FROM transactions WHERE id='entry'");
  const category = await client.execute("SELECT name FROM categories WHERE id='custom'");

  assert.equal(account.rows[0].balance, 12345);
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
      applied: changesetCount,
      pending: 0
    });
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM categories")).rows[0].count, 6);
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
      pending: changesetCount
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
      applied: changesetCount,
      pending: 0
    });
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM __drizzle_migrations")).rows[0].count, changesetCount);
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
      applied: changesetCount,
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
      applied: changesetCount + 1,
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
      "INSERT INTO accounts(id,environment,name,institution,kind,balance_minor,requisition_id,provider,provider_uid) VALUES('asset','SANDBOX','Synthetic asset','Example institution','checking',12345,'linked','enable_banking','synthetic-uid')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source) VALUES('entry','asset','original-reference','2026-11-15',-2500,'EUR','groceries','manual')",
      "INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,source) VALUES('snapshot','asset','2026-11-15',12345,'sync')"
    ], "write");
    const financialColumns = await columnList(client, "accounts");
    const financialBefore = await client.execute(`SELECT ${financialColumns} FROM accounts`);
    const transactionColumns = await columnList(client, "transactions");
    const transactionsBefore = await client.execute(`SELECT ${transactionColumns} FROM transactions`);
    const historyColumns = await columnList(client, "balance_snapshots");
    const historyBefore = await client.execute(`SELECT ${historyColumns} FROM balance_snapshots`);

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    await migrateDatabase(client);

    assert.deepEqual((await client.execute(`SELECT ${financialColumns} FROM accounts`)).rows, financialBefore.rows);
    assert.deepEqual((await client.execute(`SELECT ${transactionColumns} FROM transactions`)).rows, transactionsBefore.rows.map(row => ({
      ...row,
      category_id: row.category_id === "transfer" ? null : row.category_id
    })));
    assert.deepEqual((await client.execute(`SELECT ${historyColumns} FROM balance_snapshots`)).rows, historyBefore.rows);
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
  const iconChangeset = journal.entries.findIndex((entry: {
    tag: string
  }) => entry.tag === "0002_category_icons");
  const previousEntries = journal.entries.slice(0, iconChangeset);

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
    // A later changeset replaces is_transfer, so only the columns that remain are compared.
    const categoriesBefore = await client.execute("SELECT id,name,color FROM categories ORDER BY id");
    const transactionColumns = await columnList(client, "transactions");
    const transactionsBefore = await originalTransactions(client, transactionColumns);
    const accountsBefore = await accountState(client);
    const rulesBefore = await client.execute("SELECT * FROM categorization_rules");

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM pragma_table_info('categories') WHERE name='icon'")).rows[0].count, 0);
    await migrateDatabase(client);

    assert.deepEqual(await migrationStatus(client), {
      mode: "managed",
      applied: changesetCount,
      pending: 0
    });
    assert.deepEqual((await client.execute("SELECT id,name,color FROM categories ORDER BY id")).rows, categoriesBefore.rows.filter(row => row.id !== "transfer"));
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM categories WHERE icon IS NOT NULL")).rows[0].count, 0);
    assert.deepEqual(await originalTransactions(client, transactionColumns), transactionsBefore.map(row => ({
      ...row,
      category_id: row.category_id === "transfer" ? null : row.category_id
    })));
    assert.deepEqual(await accountState(client), accountsBefore);
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

test("the provider data upgrade keeps existing transactions unchanged and leaves their new columns empty", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-provider-details-"));
  const client = createClient({
    url: ":memory:"
  });
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));
  const previousEntries = journal.entries.slice(0, journal.entries.findIndex((entry: {
    tag: string
  }) => entry.tag === "0004_transaction_provider_details"));
  const providerColumns = ["instructed_amount_minor", "instructed_currency", "provider_payload"];

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
    const transactionsBefore = await originalTransactions(client, transactionColumns);
    const accountsBefore = await accountState(client);

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM pragma_table_info('transactions') WHERE name='provider_payload'")).rows[0].count, 0);
    await migrateDatabase(client);

    assert.deepEqual(await migrationStatus(client), {
      mode: "managed",
      applied: changesetCount,
      pending: 0
    });
    assert.ok((await columnList(client, "transactions")).startsWith(`${transactionColumns},${providerColumns.join(",")}`));
    assert.deepEqual(await originalTransactions(client, transactionColumns), transactionsBefore.map(row => ({
      ...row,
      category_id: row.category_id === "transfer" ? null : row.category_id
    })));
    assert.equal((await client.execute(`SELECT COUNT(*) AS count FROM transactions WHERE ${providerColumns.map(column => `${column} IS NOT NULL`).join(" OR ")}`)).rows[0].count, 0);
    assert.deepEqual(await accountState(client), accountsBefore);
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});

// Cash flow as computed before transaction types: every booking except those in a category flagged as a transfer, split by direction.
async function cashFlowBeforeTypes(client: Client, month: string) {
  const counted = "FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id WHERE a.environment='SANDBOX' AND t.currency='EUR' AND substr(t.booking_date,1,7)=? AND COALESCE(c.is_transfer,0)=0";
  const totals = await client.execute({
    sql: `SELECT COALESCE(SUM(CASE WHEN t.amount_minor>0 THEN t.amount_minor ELSE 0 END),0) AS income,COALESCE(SUM(CASE WHEN t.amount_minor<0 THEN -t.amount_minor ELSE 0 END),0) AS expenses ${counted}`,
    args: [month]
  });
  const breakdown = await client.execute({
    sql: `SELECT t.category_id,SUM(-t.amount_minor) AS amount ${counted} AND t.amount_minor<0 GROUP BY t.category_id ORDER BY amount DESC`,
    args: [month]
  });

  return {
    income: Number(totals.rows[0].income),
    expenses: Number(totals.rows[0].expenses),
    breakdown: breakdown.rows.map(row => [row.category_id === null ? null : String(row.category_id), Number(row.amount)])
  };
}

test("the transaction type upgrade turns transfer-category bookings into transfers and keeps every cash-flow result", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-transaction-types-"));
  const client = createClient({
    url: ":memory:"
  });
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));
  const previousEntries = journal.entries.slice(0, journal.entries.findIndex((entry: {
    tag: string
  }) => entry.tag === "0005_transaction_types"));
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousEnvironment = process.env.ENABLE_BANKING_ENVIRONMENT;
  const months = ["2026-09", "2026-10"];

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
      "INSERT INTO categories(id,name,color,is_transfer) VALUES('savings-move','Savings moves','#123456',1)",
      "INSERT INTO accounts(id,environment,name,institution,kind,provider,provider_uid) VALUES('bank','SANDBOX','Synthetic checking','Example institution','checking','enable_banking','synthetic-uid')",
      "INSERT INTO accounts(id,environment,name,institution,kind) VALUES('manual','SANDBOX','Synthetic savings','Example institution','savings')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source,provider_payload) VALUES('salary','bank','bank:1','2026-09-30',300000,'EUR','income','rule','{\"synthetic\":true}')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source) VALUES('groceries','bank','bank:2','2026-09-03',-4500,'EUR','groceries','rule')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source) VALUES('refund','bank','bank:3','2026-09-04',1200,'EUR','groceries','manual')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source) VALUES('detected-out','bank','bank:4','2026-09-05',-50000,'EUR','transfer','rule')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source) VALUES('marked-in','manual','csv:1','2026-09-05',50000,'EUR','transfer','manual')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source) VALUES('custom-transfer','bank','bank:5','2026-10-02',-20000,'EUR','savings-move','manual')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source) VALUES('uncategorized','bank','bank:6','2026-10-07',-900,'EUR',NULL,'rule')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,category_source) VALUES('zero','bank','bank:7','2026-10-08',0,'EUR',NULL,'rule')"
    ], "write");
    const transactionColumns = await columnList(client, "transactions");
    const transactionsBefore = await client.execute(`SELECT ${transactionColumns} FROM transactions ORDER BY id`);
    const categoriesBefore = await client.execute("SELECT id,name,color,icon FROM categories ORDER BY id");
    const resultsBefore = await Promise.all(months.map(month => cashFlowBeforeTypes(client, month)));

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    await migrateDatabase(client);

    assert.deepEqual(await migrationStatus(client), {
      mode: "managed",
      applied: changesetCount,
      pending: 0
    });
    assert.deepEqual((await client.execute(`SELECT ${transactionColumns} FROM transactions ORDER BY id`)).rows, transactionsBefore.rows);
    assert.deepEqual((await client.execute("SELECT id,name,color,icon FROM categories ORDER BY id")).rows, categoriesBefore.rows);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM pragma_table_info('categories') WHERE name='is_transfer'")).rows[0].count, 0);
    assert.deepEqual((await client.execute("SELECT id,type,type_source,transfer_id,transfer_source FROM transactions ORDER BY id")).rows.map(row => ({
      ...row
    })), [
      ["custom-transfer", "transfer", "manual"],
      ["detected-out", "transfer", "auto"],
      ["groceries", "expense", "auto"],
      ["marked-in", "transfer", "manual"],
      ["refund", "income", "auto"],
      ["salary", "income", "auto"],
      ["uncategorized", "expense", "auto"],
      ["zero", "expense", "auto"]
    ].map(([id, type, typeSource]) => ({
      id,
      type,
      type_source: typeSource,
      transfer_id: null,
      transfer_source: "auto"
    })));
    assert.deepEqual((await client.execute("SELECT name FROM sqlite_master WHERE tbl_name='transactions' AND type='index' AND sql IS NOT NULL ORDER BY name")).rows.map(row => row.name), ["transactions_account", "transactions_created_at", "transactions_date", "transactions_transfer_side"]);
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);

    globals.budgetDb = Promise.resolve(drizzle(client, {
      schema
    }));
    process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";

    for (const [index, month] of months.entries()) {
      const after = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from(month)), "EUR");

      assert.deepEqual({
        income: after.income,
        expenses: after.expenses,
        breakdown: after.expenseBreakdown.map(item => [item.categoryId, item.amount])
      }, resultsBefore[index], month);
    }
  } finally {
    globals.budgetDb = previousDatabase;

    if (previousEnvironment === undefined) {
      delete process.env.ENABLE_BANKING_ENVIRONMENT;
    } else {
      process.env.ENABLE_BANKING_ENVIRONMENT = previousEnvironment;
    }

    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});


test("the manual account upgrade turns balance history into transactions without changing any balance or cash-flow result", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-manual-transactions-"));
  const client = createClient({
    url: ":memory:"
  });
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));
  const previousEntries = journal.entries.slice(0, journal.entries.findIndex((entry: {
    tag: string
  }) => entry.tag === "0007_manual_account_transactions"));
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousEnvironment = process.env.ENABLE_BANKING_ENVIRONMENT;
  const months = ["2026-01", "2026-04", "2026-09", "2026-10"];
  const snapshots = [
    ["flat-1", "flat", "2026-01-01", 30000000],
    ["flat-2", "flat", "2026-04-01", 31000000],
    ["flat-3", "flat", "2026-07-01", 31000000],
    ["flat-4", "flat", "2026-10-01", 32000000],
    ["cash-1", "cash", "2026-09-01", 10000],
    ["cash-2", "cash", "2026-09-10", 9000]
  ] as const;

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
      "INSERT INTO accounts(id,environment,name,institution,kind,provider,provider_uid,balance_minor,balance_date) VALUES('bank','SANDBOX','Synthetic checking','Example institution','checking','enable_banking','synthetic-uid',12345,'2026-09-30')",
      "INSERT INTO accounts(id,environment,name,institution,kind,balance_minor,balance_date) VALUES('flat','SANDBOX','Synthetic flat','Example institution','property',32000000,'2026-10-01')",
      "INSERT INTO accounts(id,environment,name,institution,kind,balance_minor,balance_date) VALUES('cash','SANDBOX','Synthetic cash','Example institution','savings',9000,'2026-09-10')",
      "INSERT INTO accounts(id,environment,name,institution,kind,balance_minor,balance_date) VALUES('loan','SANDBOX','Synthetic loan','Example institution','loan',-5000000,'2026-08-01')",
      "INSERT INTO accounts(id,environment,name,institution,kind) VALUES('unvalued','SANDBOX','Synthetic unvalued','Example institution','investment')",
      "INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,source) VALUES('bank-1','bank','2026-09-30',12345,'sync')",
      ...snapshots.map(([id, account, date, amount]) => `INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,source) VALUES('${id}','${account}','${date}',${amount},'${id === "flat-2" ? "csv" : "manual"}')`),
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type) VALUES('salary','bank','bank:1','2026-09-01',300000,'EUR','income')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type) VALUES('rent','bank','bank:2','2026-09-03',-90000,'EUR','expense')",
      // Bookings already on manual accounts: CSV imports in and after the history, and a counterpart created for a synced transfer.
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type) VALUES('cash-spend','cash','csv:1','2026-09-05',-2000,'EUR','expense')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type) VALUES('cash-late','cash','csv:2','2026-09-20',-500,'EUR','expense')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type,type_source,transfer_id,transfer_source) VALUES('withdrawal','bank','bank:3','2026-09-15',-3000,'EUR','transfer','manual','synthetic-transfer','manual')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type,type_source,transfer_id,transfer_source) VALUES('withdrawal-in','cash','transfer:withdrawal','2026-09-15',3000,'EUR','transfer','manual','synthetic-transfer','manual')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type) VALUES('flat-fee','flat','csv:3','2026-02-01',-10000,'EUR','expense')"
    ], "write");

    globals.budgetDb = Promise.resolve(drizzle(client, {
      schema
    }));
    process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";

    const transactionColumns = await columnList(client, "transactions");
    const transactionsBefore = await originalTransactions(client, transactionColumns);
    const balancesBefore = (await client.execute("SELECT id,balance_minor FROM accounts ORDER BY id")).rows.map(row => [row.id, row.balance_minor]);

    // The current cash-flow query reads the hidden-booking column and the split table of later changesets; they exist only while the previous result is read.
    await client.execute("ALTER TABLE transactions ADD COLUMN suppressed_at TEXT");
    await client.execute("CREATE TABLE transaction_splits(transaction_id TEXT,category_id TEXT,amount_minor INTEGER)");
    const flowsBefore = await Promise.all(months.map(month => readCashFlow(monthPeriod(Temporal.PlainYearMonth.from(month)), "EUR")));

    await client.execute("DROP TABLE transaction_splits");
    await client.execute("ALTER TABLE transactions DROP COLUMN suppressed_at");

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    await migrateDatabase(client);

    assert.deepEqual(await migrationStatus(client), {
      mode: "managed",
      applied: changesetCount,
      pending: 0
    });

    const accountsAfter = await listAccounts();

    assert.deepEqual(accountsAfter.map(account => [account.id, account.balance_minor]).sort(), balancesBefore.sort());
    assert.deepEqual(await Promise.all(months.map(month => readCashFlow(monthPeriod(Temporal.PlainYearMonth.from(month)), "EUR"))), flowsBefore);
    assert.deepEqual(await originalTransactions(client, transactionColumns), transactionsBefore);

    // The balance at the end of every snapshot date is that snapshot.
    for (const [id, account, date, amount] of snapshots) {
      const onDate = await client.execute({
        sql: "SELECT SUM(amount_minor) AS balance FROM transactions WHERE account_id=? AND booking_date<=?",
        args: [account, date]
      });

      assert.equal(onDate.rows[0].balance, amount, id);
    }

    const booked = await client.execute("SELECT account_id,booking_date,type,amount_minor,type_source,category_source,provider_reference='manual:' || id AS entered FROM transactions WHERE type IN ('opening_balance','adjustment') ORDER BY account_id,booking_date");

    // An unchanged valuation books nothing; the booking after the newest cash snapshot is balanced on its date.
    assert.deepEqual(booked.rows.map(row => [row.account_id, row.booking_date, row.type, row.amount_minor]), [
      ["cash", "2026-09-01", "opening_balance", 10000],
      ["cash", "2026-09-10", "adjustment", 1000],
      ["cash", "2026-09-20", "adjustment", -2500],
      ["flat", "2026-01-01", "opening_balance", 30000000],
      ["flat", "2026-04-01", "adjustment", 1010000],
      ["flat", "2026-10-01", "adjustment", 1000000],
      ["loan", "2026-08-01", "opening_balance", -5000000]
    ]);
    assert.ok(booked.rows.every(row => row.type_source === "manual" && row.category_source === "manual" && row.entered === 1));
    assert.deepEqual((await client.execute("SELECT id FROM balance_snapshots")).rows.map(row => row.id), ["bank-1"]);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM accounts WHERE provider='manual' AND (balance_minor IS NOT NULL OR balance_date IS NOT NULL)")).rows[0].count, 0);
    assert.deepEqual((await client.execute("SELECT balance_minor,balance_date FROM accounts WHERE id='bank'")).rows.map(row => [row.balance_minor, row.balance_date]), [[12345, "2026-09-30"]]);
    assert.equal(accountsAfter.find(account => account.id === "unvalued")?.balance_minor, null);
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
  } finally {
    globals.budgetDb = previousDatabase;

    if (previousEnvironment === undefined) {
      delete process.env.ENABLE_BANKING_ENVIRONMENT;
    } else {
      process.env.ENABLE_BANKING_ENVIRONMENT = previousEnvironment;
    }

    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});

test("retiring the seeded transfer category preserves bookings, transfer links and custom categories", async () => {
  const client = createClient({
    url: ":memory:"
  });
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-category-retirement-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));

  journal.entries = journal.entries.filter((entry: {
    idx: number
  }) => entry.idx < 6);
  mkdirSync(join(directory, "meta"));

  for (const entry of journal.entries) {
    cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify(journal));

  try {
    await migrateDatabase(client, directory);
    await client.batch([
      "INSERT INTO accounts(id,environment,name,institution,kind) VALUES('checking','SANDBOX','Synthetic checking','Example bank','checking')",
      "INSERT INTO categories(id,name,color) VALUES('custom-transfer','Transfers for travel','#123456')",
      "INSERT INTO categorization_rules(id,name,pattern,mode,category_id,priority,enabled) VALUES('demo-rule-joint-account','Joint household account','Joint household account','keyword','transfer',6,1)",
      "INSERT INTO categorization_rules(id,name,pattern,mode,category_id,priority,enabled) VALUES('demo-rule-own-transfers','Transfers between own accounts','^(Everyday account|Emergency fund|Travel credit card|ETF portfolio|Rental flat, Linden Street|Mortgage, rental flat) ','regex','transfer',5,1)",
      "INSERT INTO categorization_rules(id,name,pattern,mode,category_id) VALUES('custom','Travel','TRAVEL','keyword','custom-transfer')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,type,transfer_id) VALUES('entry','checking','synthetic-1','2026-01-01',-12345,'EUR','transfer','transfer','preserved-link')"
    ], "write");
    await migrateDatabase(client);

    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM categories WHERE id='transfer'")).rows[0].n, 0);
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM categorization_rules WHERE id IN ('demo-rule-own-transfers','demo-rule-joint-account')")).rows[0].n, 0);
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM categorization_rules WHERE id='custom'")).rows[0].n, 1);
    assert.deepEqual({
      ...(await client.execute("SELECT amount_minor,type,transfer_id,category_id FROM transactions WHERE id='entry'")).rows[0]
    }, {
      amount_minor: -12345,
      type: "transfer",
      transfer_id: "preserved-link",
      category_id: null
    });
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});


const transferCustomizations = [
  {
    name: "a renamed seeded category",
    sql: "UPDATE categories SET name='Own movements' WHERE id='transfer'"
  },
  {
    name: "a recolored seeded category",
    sql: "UPDATE categories SET color='#123456' WHERE id='transfer'"
  },
  {
    name: "a seeded category with an assigned icon",
    sql: "UPDATE categories SET icon='travel' WHERE id='transfer'"
  },
  {
    name: "a manual category assignment",
    sql: "UPDATE transactions SET category_source='manual' WHERE id='entry'"
  },
  {
    name: "a user-created rule targeting the seeded category",
    sql: "INSERT INTO categorization_rules(id,name,pattern,mode,category_id) VALUES('user-created','Own payments','SAVINGS','keyword','transfer')"
  },
  {
    name: "a customized demo-owned rule",
    sql: "UPDATE categorization_rules SET pattern='MY HOUSEHOLD' WHERE id='demo-rule-joint-account'"
  }
];

for (const customization of transferCustomizations) {
  test(`category retirement preserves ${customization.name} and every dependent booking and rule`, async () => {
    const client = createClient({
      url: ":memory:"
    });
    const directory = mkdtempSync(join(tmpdir(), "ufer-custom-transfer-category-"));
    const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));

    journal.entries = journal.entries.filter((entry: {
      idx: number
    }) => entry.idx < 6);
    mkdirSync(join(directory, "meta"));

    for (const entry of journal.entries) {
      cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
    }

    writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify(journal));

    try {
      await migrateDatabase(client, directory);
      await client.batch([
        "INSERT INTO accounts(id,environment,name,institution,kind) VALUES('checking','SANDBOX','Synthetic checking','Example bank','checking')",
        "INSERT INTO categorization_rules(id,name,pattern,mode,category_id,priority,enabled) VALUES('demo-rule-joint-account','Joint household account','Joint household account','keyword','transfer',6,1)",
        "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,category_id,type,transfer_id) VALUES('entry','checking','synthetic-1','2026-01-01',-12345,'EUR','transfer','transfer','preserved-link')",
        customization.sql
      ], "write");
      const categoryBefore = (await client.execute("SELECT * FROM categories WHERE id='transfer'")).rows;
      const rulesBefore = (await client.execute("SELECT * FROM categorization_rules ORDER BY id")).rows;
      const bookingColumns = await columnList(client, "transactions");
      const bookingsBefore = (await client.execute(`SELECT ${bookingColumns} FROM transactions ORDER BY id`)).rows;

      await migrateDatabase(client);

      assert.deepEqual((await client.execute("SELECT * FROM categories WHERE id='transfer'")).rows, categoryBefore);
      assert.deepEqual((await client.execute("SELECT * FROM categorization_rules ORDER BY id")).rows, rulesBefore);
      assert.deepEqual((await client.execute(`SELECT ${bookingColumns} FROM transactions ORDER BY id`)).rows, bookingsBefore);
      assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
    } finally {
      client.close();
      rmSync(directory, {
        recursive: true,
        force: true
      });
    }
  });
}


test("bank balance provenance migration preserves existing history and leaves its classification unknown", async () => {
  const client = createClient({
    url: ":memory:"
  });
  const directory = mkdtempSync(join(tmpdir(), "ufer-balance-provenance-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));

  journal.entries = journal.entries.filter((entry: {
    idx: number
  }) => entry.idx < 8);
  mkdirSync(join(directory, "meta"));

  for (const entry of journal.entries) {
    cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify(journal));

  try {
    await migrateDatabase(client, directory);
    await client.batch([
      "INSERT INTO accounts(id,environment,name,institution,kind,balance_minor,balance_date) VALUES('bank','SANDBOX','Synthetic bank account','Example bank','checking',12345,'2026-01-02')",
      "INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,source) VALUES('bank-record','bank','2026-01-02',12345,'sync'),('csv-record','bank','2026-01-01',12000,'csv')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type) VALUES('entry','bank','bank:entry','2026-01-02',345,'EUR','income')"
    ], "write");
    const columns = await columnList(client, "balance_snapshots");
    const balances = (await client.execute(`SELECT ${columns} FROM balance_snapshots ORDER BY id`)).rows;
    const accountColumns = await columnList(client, "accounts");
    const accounts = (await client.execute(`SELECT ${accountColumns} FROM accounts ORDER BY id`)).rows;
    const bookingColumns = await columnList(client, "transactions");
    const bookings = (await client.execute(`SELECT ${bookingColumns} FROM transactions ORDER BY id`)).rows;

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    await migrateDatabase(client);
    await migrateDatabase(client);

    assert.deepEqual((await client.execute(`SELECT ${columns} FROM balance_snapshots ORDER BY id`)).rows, balances);
    assert.deepEqual((await client.execute(`SELECT ${accountColumns} FROM accounts ORDER BY id`)).rows, accounts);
    assert.deepEqual((await client.execute(`SELECT ${bookingColumns} FROM transactions ORDER BY id`)).rows, bookings);
    assert.deepEqual((await client.execute("SELECT bank_balance_type FROM balance_snapshots ORDER BY id")).rows.map(row => row.bank_balance_type), [null, null]);
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});


test("provider-name migration keeps existing custom names and identities without inferring provider labels", async () => {
  const client = createClient({
    url: ":memory:"
  });
  const directory = mkdtempSync(join(tmpdir(), "ufer-provider-name-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));

  journal.entries = journal.entries.filter((entry: {
    idx: number
  }) => entry.idx < 9);
  mkdirSync(join(directory, "meta"));

  for (const entry of journal.entries) {
    cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify(journal));

  try {
    await migrateDatabase(client, directory);
    await client.execute("INSERT INTO accounts(id,environment,name,institution,kind,provider,provider_uid,balance_minor,balance_date) VALUES('named','SANDBOX','Custom name','Example bank','checking','enable_banking','stable-provider-id',12345,'2026-01-01')");
    const columns = await columnList(client, "accounts");
    const before = (await client.execute(`SELECT ${columns} FROM accounts`)).rows;

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    await migrateDatabase(client);
    await migrateDatabase(client);
    assert.deepEqual((await client.execute(`SELECT ${columns} FROM accounts`)).rows, before);
    assert.equal((await client.execute("SELECT provider_name FROM accounts")).rows[0].provider_name, null);
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});

test("transaction override migration keeps every booking unchanged and leaves bookings without overrides and visible", async () => {
  const client = createClient({
    url: ":memory:"
  });
  const directory = mkdtempSync(join(tmpdir(), "ufer-transaction-overrides-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));

  journal.entries = journal.entries.filter((entry: {
    idx: number
  }) => entry.idx < 10);
  mkdirSync(join(directory, "meta"));

  for (const entry of journal.entries) {
    cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify(journal));

  try {
    await migrateDatabase(client, directory);
    await client.batch([
      "INSERT INTO accounts(id,environment,name,institution,kind,provider,provider_uid,balance_minor,balance_date) VALUES('bank','SANDBOX','Synthetic checking','Example bank','checking','enable_banking','synthetic-uid',12345,'2026-01-02')",
      "INSERT INTO accounts(id,environment,name,institution,kind) VALUES('cash','SANDBOX','Synthetic cash','Example institution','savings')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,description,category_source,type,type_source,transfer_id,transfer_source) VALUES('out','bank','bank:1','2026-01-02',-500,'EUR','Example payee','Synthetic transfer','manual','transfer','manual','link','manual')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type,type_source,transfer_id,transfer_source) VALUES('in','cash','transfer:out','2026-01-02',500,'EUR','transfer','manual','link','manual')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,type) VALUES('fee','cash','csv:1','2026-01-03',-200,'EUR','Example bank','expense')"
    ], "write");
    const columns = await columnList(client, "transactions");
    const before = (await client.execute(`SELECT ${columns} FROM transactions ORDER BY id`)).rows;

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    await migrateDatabase(client);
    await migrateDatabase(client);

    assert.deepEqual((await client.execute(`SELECT ${columns} FROM transactions ORDER BY id`)).rows, before);
    assert.deepEqual((await client.execute("SELECT counterparty_override,description_override,suppressed_at FROM transactions")).rows.flatMap(row => [row.counterparty_override, row.description_override, row.suppressed_at]), Array(9).fill(null));
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});

test("category-rule migration keeps every booking unchanged and leaves existing rule assignments unattributed", async () => {
  const client = createClient({
    url: ":memory:"
  });
  const directory = mkdtempSync(join(tmpdir(), "ufer-category-rule-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));

  journal.entries = journal.entries.filter((entry: {
    idx: number
  }) => entry.idx < 11);
  mkdirSync(join(directory, "meta"));

  for (const entry of journal.entries) {
    cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify(journal));

  try {
    await migrateDatabase(client, directory);
    await client.batch([
      "INSERT INTO accounts(id,environment,name,institution,kind) VALUES('checking','SANDBOX','Synthetic checking','Example institution','checking')",
      "INSERT INTO categorization_rules(id,name,pattern,mode,category_id,priority,enabled) VALUES('market-rule','Markets','MARKET','keyword','groceries',100,1)",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,category_id,category_source,type) VALUES('ruled','checking','bank:1','2026-01-02',-500,'EUR','Example Market','groceries','rule','expense')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,category_id,category_source,type) VALUES('manual','checking','bank:2','2026-01-03',-700,'EUR','Example Bakery','leisure','manual','expense')"
    ], "write");
    const columns = await columnList(client, "transactions");
    const before = (await client.execute(`SELECT ${columns} FROM transactions ORDER BY id`)).rows;

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    await migrateDatabase(client);
    await migrateDatabase(client);

    assert.deepEqual((await client.execute(`SELECT ${columns} FROM transactions ORDER BY id`)).rows, before);
    assert.deepEqual((await client.execute("SELECT category_rule_id FROM transactions")).rows.map(row => row.category_rule_id), [null, null]);

    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});

test("account-archiving migration keeps every account visible and unchanged", async () => {
  const client = createClient({
    url: ":memory:"
  });
  const directory = mkdtempSync(join(tmpdir(), "ufer-account-archiving-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));

  journal.entries = journal.entries.filter((entry: {
    idx: number
  }) => entry.idx < 12);
  mkdirSync(join(directory, "meta"));

  for (const entry of journal.entries) {
    cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify(journal));

  try {
    await migrateDatabase(client, directory);
    await client.execute("INSERT INTO accounts(id,environment,name,institution,kind,provider,provider_uid,balance_minor,balance_date) VALUES('bank','SANDBOX','Synthetic bank','Example bank','checking','enable_banking','stable-provider-id',12345,'2026-01-01')");
    await client.execute("INSERT INTO accounts(id,environment,name,institution,kind) VALUES('manual','SANDBOX','Synthetic cash','Example bank','savings')");
    await client.execute("INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type,type_source) VALUES('opening','manual','manual:opening','2026-01-01',5000,'EUR','opening_balance','manual')");
    const columns = await columnList(client, "accounts");
    const before = (await client.execute(`SELECT ${columns} FROM accounts ORDER BY id`)).rows;
    const bookings = (await client.execute("SELECT * FROM transactions ORDER BY id")).rows;

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    await migrateDatabase(client);
    await migrateDatabase(client);
    assert.deepEqual((await client.execute(`SELECT ${columns} FROM accounts ORDER BY id`)).rows, before);
    assert.deepEqual((await client.execute("SELECT archived_at FROM accounts")).rows.map(row => row.archived_at), [null, null]);
    assert.deepEqual((await client.execute("SELECT * FROM transactions ORDER BY id")).rows, bookings);
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});

test("split migration keeps every booking unchanged and removes parts with their booking", async () => {
  const client = createClient({
    url: ":memory:"
  });
  const directory = mkdtempSync(join(tmpdir(), "ufer-splits-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));

  journal.entries = journal.entries.filter((entry: {
    idx: number
  }) => entry.idx < 13);
  mkdirSync(join(directory, "meta"));

  for (const entry of journal.entries) {
    cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify(journal));

  try {
    await migrateDatabase(client, directory);
    await client.batch([
      "INSERT INTO accounts(id,environment,name,institution,kind) VALUES('checking','SANDBOX','Synthetic checking','Example institution','checking')",
      "INSERT INTO categories(id,name,color) VALUES('temporary','Temporary category','#123456')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,category_id,category_source,type) VALUES('market','checking','bank:1','2026-01-02',-500,'EUR','Example Market','groceries','rule','expense')",
      "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,category_id,category_source,type) VALUES('bakery','checking','bank:2','2026-01-03',-700,'EUR','Example Bakery','leisure','manual','expense')"
    ], "write");
    const before = (await client.execute("SELECT * FROM transactions ORDER BY id")).rows;

    await assert.rejects(initializeDatabase(client), /migrations are pending/);
    await migrateDatabase(client);
    await migrateDatabase(client);

    assert.deepEqual((await client.execute("SELECT * FROM transactions ORDER BY id")).rows, before);
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM transaction_splits")).rows[0].n, 0);

    await client.execute("PRAGMA foreign_keys = ON");
    await client.batch([
      "INSERT INTO transaction_splits(id,transaction_id,position,amount_minor,category_id) VALUES('part-1','market',0,-300,'groceries')",
      "INSERT INTO transaction_splits(id,transaction_id,position,amount_minor,category_id) VALUES('part-2','market',1,-200,'temporary')",
      "INSERT INTO transaction_splits(id,transaction_id,position,amount_minor,category_id) VALUES('part-3','bakery',0,-700,'leisure')"
    ], "write");
    await assert.rejects(client.execute("INSERT INTO transaction_splits(id,transaction_id,position,amount_minor) VALUES('zero','bakery',1,0)"), /CHECK constraint/);
    await assert.rejects(client.execute("INSERT INTO transaction_splits(id,transaction_id,position,amount_minor) VALUES('orphan','missing',0,-100)"), /FOREIGN KEY/);

    await client.execute("DELETE FROM categories WHERE id='temporary'");
    assert.equal((await client.execute("SELECT category_id FROM transaction_splits WHERE id='part-2'")).rows[0].category_id, null);

    await client.execute("DELETE FROM transactions WHERE id='market'");
    assert.deepEqual((await client.execute("SELECT id FROM transaction_splits")).rows.map(row => row.id), ["part-3"]);
    assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
  } finally {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});
