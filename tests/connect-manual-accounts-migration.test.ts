import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { migrateDatabase } from "../src/server/database/migrations";

const changeset = "0022_connect_manual_accounts";

test("changeset 0022 makes detached bank accounts manual and keeps linked accounts, bookings and identifiers", async context => {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-connect-manual-accounts-"));
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
    "INSERT INTO accounts(id,name,kind,provider,provider_uid,requisition_id) VALUES('linked-account','Synthetic linked','checking','enable_banking','uid-linked','linked')",
    "INSERT INTO accounts(id,name,kind,provider,provider_uid,last_synced_at) VALUES('detached','Synthetic detached','checking','enable_banking','uid-detached','2026-01-01T00:00:00Z')",
    "INSERT INTO accounts(id,name,kind) VALUES('cash','Synthetic cash','savings')",
    "INSERT INTO account_identifiers(identification_hash,account_id) VALUES('hash-detached','detached')",
    "INSERT INTO transactions(id,account_id,provider_reference,date,amount_minor,currency,type) VALUES('booking','detached','bank:synthetic','2026-01-02',-500,'EUR','expense')"
  ], "write");

  await migrateDatabase(client);

  const columns = (await client.execute("SELECT name FROM pragma_table_info('requisitions')")).rows.map(row => row.name);

  assert.ok(columns.includes("target_account_id"));
  assert.deepEqual((await client.execute("SELECT id,provider,provider_uid,requisition_id,last_synced_at FROM accounts ORDER BY id")).rows.map(row => ({
    ...row
  })), [{
    id: "cash",
    provider: "manual",
    provider_uid: null,
    requisition_id: null,
    last_synced_at: null
  }, {
    id: "detached",
    provider: "manual",
    provider_uid: null,
    requisition_id: null,
    last_synced_at: "2026-01-01T00:00:00Z"
  }, {
    id: "linked-account",
    provider: "enable_banking",
    provider_uid: "uid-linked",
    requisition_id: "linked",
    last_synced_at: null
  }]);
  assert.equal((await client.execute("SELECT account_id FROM account_identifiers")).rows[0].account_id, "detached");
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM transactions")).rows[0].n, 1);
});
