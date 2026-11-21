import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { migrateDatabase } from "../src/server/database/migrations";

const changeset = "0018_drop_account_institution";

test("changeset 0018 drops account institutions and keeps the bank name of detached bank accounts through a removed connection", async context => {
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
    "INSERT INTO requisitions(id,bank_name,bank_country,status,created_at) VALUES('linked','Example bank','AT','LINKED','2026-01-01T00:00:00.000Z')",
    "INSERT INTO requisitions(id,bank_name,bank_country,status,created_at) VALUES('removed-old','Example bank','AT','REMOVED','2026-01-02T00:00:00.000Z')",
    "INSERT INTO requisitions(id,bank_name,bank_country,status,created_at) VALUES('removed-new','Example bank','AT','REMOVED','2026-01-03T00:00:00.000Z')",
    "INSERT INTO accounts(id,name,institution,kind,provider,provider_uid,requisition_id) VALUES('linked-account','Synthetic linked','Example bank','checking','enable_banking','uid-linked','linked')",
    "INSERT INTO accounts(id,name,institution,kind,provider,provider_uid) VALUES('detached','Synthetic detached','Example bank','checking','enable_banking','uid-detached')",
    "INSERT INTO accounts(id,name,institution,kind,provider,provider_uid) VALUES('orphan-a','Synthetic orphan A','Other bank','checking','enable_banking','uid-orphan-a')",
    "INSERT INTO accounts(id,name,institution,kind,provider,provider_uid) VALUES('orphan-b','Synthetic orphan B','Other bank','savings','enable_banking','uid-orphan-b')",
    "INSERT INTO accounts(id,name,institution,kind) VALUES('imported','Synthetic import','CSV import','checking')",
    "INSERT INTO accounts(id,name,institution,kind) VALUES('cash','Synthetic cash','Example institution','savings')"
  ], "write");

  await migrateDatabase(client);

  const columns = (await client.execute("SELECT name FROM pragma_table_info('accounts')")).rows.map(row => row.name);
  const accounts = (await client.execute("SELECT a.id,a.requisition_id,r.bank_name,r.status FROM accounts a LEFT JOIN requisitions r ON r.id=a.requisition_id ORDER BY a.id")).rows.map(row => ({
    ...row
  }));
  const placeholders = (await client.execute("SELECT bank_name,status,error FROM requisitions WHERE id NOT IN ('linked','removed-old','removed-new')")).rows.map(row => [row.bank_name, row.status, row.error]);

  assert.ok(!columns.includes("institution"));
  assert.deepEqual(accounts.map(account => [account.id, account.bank_name, account.status]), [
    ["cash", null, null],
    ["detached", "Example bank", "REMOVED"],
    ["imported", null, null],
    ["linked-account", "Example bank", "LINKED"],
    ["orphan-a", "Other bank", "REMOVED"],
    ["orphan-b", "Other bank", "REMOVED"]
  ]);
  assert.equal(accounts.find(account => account.id === "detached")?.requisition_id, "removed-new");
  assert.equal(accounts.find(account => account.id === "orphan-a")?.requisition_id, accounts.find(account => account.id === "orphan-b")?.requisition_id);
  assert.deepEqual(placeholders, [["Other bank", "REMOVED", null]]);
  assert.equal((await client.execute("PRAGMA foreign_key_check")).rows.length, 0);
});
