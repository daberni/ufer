import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { migrateDatabase } from "../src/server/database/migrations";

const changeset = "0022_brokerage_holdings";

async function databaseBefore(context: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-brokerage-holdings-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));
  const previousEntries = journal.entries.slice(0, journal.entries.findIndex((entry: {
    tag: string
  }) => entry.tag === changeset));
  const client = createClient({
    url: ":memory:"
  });

  context.after(() => {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  });
  mkdirSync(join(directory, "meta"));

  for (const entry of previousEntries) {
    cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify({
    ...journal,
    entries: previousEntries
  }));
  await migrateDatabase(client, directory);

  return client;
}

async function rows(client: Client, sql: string) {
  return (await client.execute(sql)).rows.map(row => ({
    ...row
  }));
}

// Earlier changesets quoted renamed columns differently; the definitions must match apart from identifier quoting.
async function indexDefinitions(client: Client) {
  const indexes = await rows(client, "SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('accounts','transactions') AND sql IS NOT NULL ORDER BY name");

  return indexes.map(index => ({
    name: index.name,
    sql: String(index.sql).replaceAll("\"", "`")
  }));
}

const snapshotQueries = {
  accounts: "SELECT * FROM accounts ORDER BY id",
  transactions: "SELECT * FROM transactions ORDER BY id",
  splits: "SELECT * FROM transaction_splits ORDER BY id",
  identifiers: "SELECT * FROM account_identifiers ORDER BY identification_hash",
  snapshots: "SELECT * FROM balance_snapshots ORDER BY id"
};

async function snapshot(client: Client) {
  return {
    accounts: await rows(client, snapshotQueries.accounts),
    transactions: await rows(client, snapshotQueries.transactions),
    splits: await rows(client, snapshotQueries.splits),
    identifiers: await rows(client, snapshotQueries.identifiers),
    snapshots: await rows(client, snapshotQueries.snapshots)
  };
}

test("changeset 0022 keeps every account, booking, split, identifier and snapshot and their indexes", async context => {
  const client = await databaseBefore(context);

  await client.batch([
    "INSERT INTO categories(id,name,color) VALUES('food','Synthetic food','#123456')",
    "INSERT INTO requisitions(id,bank_name,bank_country,status) VALUES('linked','Example bank','AT','LINKED')",
    "INSERT INTO accounts(id,name,kind,provider,provider_uid,requisition_id,iban,last_synced_at,provider_name) VALUES('bank','Synthetic bank','checking','enable_banking','uid-bank','linked','AT000000000000000000','2026-01-05T06:00:00Z','Giro')",
    "INSERT INTO accounts(id,name,kind,archived_at) VALUES('fund','Synthetic fund','investment','2026-02-01T00:00:00Z')",
    "INSERT INTO account_identifiers(identification_hash,account_id) VALUES('hash-bank','bank')",
    "INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,source,bank_balance_type) VALUES('snap','bank','2026-01-05',10000,'sync','CLBD')",
    "INSERT INTO transactions(id,account_id,provider_reference,date,booking_date,amount_minor,currency,counterparty,description,category_id,category_source,type,type_source,transfer_id,transfer_source,counterparty_override,suppressed_at,transfer_detected,type_transfer_account_id) VALUES('out','bank','bank:out','2026-01-03','2026-01-04',-2500,'EUR','Synthetic shop','Groceries','food','manual','transfer','manual','pair','manual','Shop override',NULL,1,'fund')",
    "INSERT INTO transactions(id,account_id,provider_reference,date,amount_minor,currency,type,transfer_id) VALUES('in','fund','manual:in','2026-01-03',2500,'EUR','transfer','pair')",
    "INSERT INTO transactions(id,account_id,provider_reference,date,amount_minor,currency,type,suppressed_at) VALUES('hidden','bank','bank:hidden','2026-01-06',-100,'EUR','expense','2026-01-07T00:00:00Z')",
    "INSERT INTO transaction_splits(id,transaction_id,position,amount_minor,category_id,note) VALUES('part','out',0,-2500,'food','Synthetic part')"
  ], "write");

  const before = await snapshot(client);
  const indexes = await indexDefinitions(client);

  await migrateDatabase(client);

  assert.deepEqual(await snapshot(client), before);
  assert.deepEqual(await indexDefinitions(client), indexes);
  assert.deepEqual(await rows(client, "PRAGMA foreign_key_check"), []);

  // Deleting a booking still cascades to its split, so the rebuilt table kept the reference.
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("DELETE FROM transactions WHERE id='out'");
  assert.deepEqual(await rows(client, "SELECT id FROM transaction_splits"), []);
});

test("changeset 0022 accepts brokerage accounts, trade bookings, securities, prices, splits and trades and enforces their constraints", async context => {
  const client = await databaseBefore(context);

  await migrateDatabase(client);
  await client.execute("PRAGMA foreign_keys = ON");
  await client.batch([
    "INSERT INTO accounts(id,name,kind) VALUES('depot','Synthetic depot','brokerage')",
    "INSERT INTO accounts(id,name,kind) VALUES('cash','Synthetic settlement','checking')",
    "INSERT INTO transactions(id,account_id,provider_reference,date,amount_minor,currency,type) VALUES('leg','cash','manual:leg','2026-03-02',-100500,'EUR','buy')",
    "INSERT INTO securities(id,isin,name,currency,provider,provider_symbol,venue) VALUES('etf','XS0000000001','Synthetic World ETF','EUR','eodhd','SYN.XETRA','XETR')",
    "INSERT INTO securities(id,name,currency) VALUES('fund','Synthetic fund','EUR')",
    "INSERT INTO security_prices(security_id,date,close_micros,source,fetched_at) VALUES('etf','2026-03-02',100250000,'eodhd','2026-03-03T06:00:00Z')",
    "INSERT INTO security_splits(security_id,date,numerator,denominator) VALUES('etf','2026-06-01',2,1)",
    "INSERT INTO security_trades(id,account_id,security_id,date,side,sequence,quantity_micros,price_micros,gross_minor,fee_minor,settlement_transaction_id) VALUES('trade','depot','etf','2026-03-02','buy',1,10000000,100000000,100000,500,'leg')"
  ], "write");

  const refused = [
    "INSERT INTO accounts(id,name,kind) VALUES('bad','Bad','stocks')",
    "INSERT INTO transactions(id,account_id,provider_reference,date,amount_minor,currency,type) VALUES('bad','cash','manual:bad','2026-03-02',1,'EUR','dividend')",
    "INSERT INTO securities(id,name,currency,provider) VALUES('bad','Provider without symbol','EUR','eodhd')",
    "INSERT INTO securities(id,name,currency,provider,provider_symbol) VALUES('dup','Duplicate listing','EUR','eodhd','SYN.XETRA')",
    "INSERT INTO security_prices(security_id,date,close_micros,source,fetched_at) VALUES('etf','2026-03-03',0,'eodhd','2026-03-04T06:00:00Z')",
    "INSERT INTO security_prices(security_id,date,close_micros,source,fetched_at) VALUES('etf','2026-03-02',1,'eodhd','2026-03-04T06:00:00Z')",
    "INSERT INTO security_splits(security_id,date,numerator,denominator) VALUES('etf','2026-07-01',0,1)",
    "INSERT INTO security_trades(id,account_id,security_id,date,side,sequence,quantity_micros,price_micros,gross_minor) VALUES('bad','depot','etf','2026-03-03','sell',1,1,1,1)",
    "INSERT INTO security_trades(id,account_id,security_id,date,side,sequence,quantity_micros,price_micros,gross_minor) VALUES('bad','depot','etf','2026-03-02','swap',2,1,1,1)",
    "INSERT INTO security_trades(id,account_id,security_id,date,side,sequence,quantity_micros,price_micros,gross_minor) VALUES('bad','depot','etf','2026-03-02','buy',2,0,1,1)",
    "INSERT INTO security_trades(id,account_id,security_id,date,side,sequence,quantity_micros,price_micros,gross_minor) VALUES('bad','depot','missing','2026-03-02','buy',2,1,1,1)",
    "INSERT INTO security_trades(id,account_id,security_id,date,side,sequence,quantity_micros,price_micros,gross_minor,settlement_transaction_id) VALUES('bad','depot','etf','2026-03-02','buy',2,1,1,1,'leg')"
  ];

  for (const statement of refused) {
    await assert.rejects(client.execute(statement), Error, statement);
  }

  // Prices and splits belong to their security and go with it.
  await client.execute("DELETE FROM security_trades");
  await client.execute("DELETE FROM securities WHERE id='etf'");
  assert.deepEqual(await rows(client, "SELECT COUNT(*) AS n FROM security_prices UNION ALL SELECT COUNT(*) FROM security_splits"), [{
    n: 0
  }, {
    n: 0
  }]);
});
