import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { migrateDatabase } from "../src/server/database/migrations";

const changeset = "0018_drop_account_institution";

test("changeset 0018 drops the account institution and keeps every account and its connection", async context => {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-account-institution-"));
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
  await client.batch([
    "INSERT INTO requisitions(id,bank_name,bank_country,status) VALUES('linked','Example bank','AT','LINKED')",
    "INSERT INTO accounts(id,name,institution,kind,provider,provider_uid,requisition_id) VALUES('linked-account','Synthetic linked','Example bank','checking','enable_banking','uid-linked','linked')",
    "INSERT INTO accounts(id,name,institution,kind) VALUES('imported','Synthetic import','CSV import','checking')",
    "INSERT INTO accounts(id,name,institution,kind) VALUES('cash','Synthetic cash','Example institution','savings')"
  ], "write");
  const before = (await client.execute("SELECT id,name,kind,currency,provider,provider_uid,requisition_id FROM accounts ORDER BY id")).rows;

  await migrateDatabase(client);

  const columns = (await client.execute("SELECT name FROM pragma_table_info('accounts')")).rows.map(row => row.name);

  assert.ok(!columns.includes("institution"));
  assert.deepEqual((await client.execute("SELECT id,name,kind,currency,provider,provider_uid,requisition_id FROM accounts ORDER BY id")).rows, before);
  assert.deepEqual((await client.execute("SELECT r.bank_name FROM accounts a JOIN requisitions r ON r.id=a.requisition_id")).rows.map(row => row.bank_name), ["Example bank"]);
});
