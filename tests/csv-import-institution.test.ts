import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { migrateDatabase } from "../src/server/database/migrations";

const changeset = "0018_clear_csv_import_institution";

test("changeset 0018 clears only the exact 'CSV import' institution and keeps user-entered institutions", async context => {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-csv-institution-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));
  const previousEntries = journal.entries.slice(0, journal.entries.findIndex((entry: {
    tag: string
  }) => entry.tag === changeset));
  const client = createClient({
    url: ":memory:"
  });

  context.after(() => {
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
    "INSERT INTO accounts(id,name,institution,kind) VALUES('imported','Synthetic import','CSV import','checking')",
    "INSERT INTO accounts(id,name,institution,kind) VALUES('lower','Synthetic lower','csv import','checking')",
    "INSERT INTO accounts(id,name,institution,kind) VALUES('longer','Synthetic longer','CSV import bank','checking')",
    "INSERT INTO accounts(id,name,institution,kind) VALUES('cash','Synthetic cash','Example institution','savings')"
  ], "write");

  await migrateDatabase(client);

  const institutions = (await client.execute("SELECT id,institution FROM accounts ORDER BY id")).rows.map(row => [row.id, row.institution]);

  assert.deepEqual(institutions, [
    ["cash", "Example institution"],
    ["imported", ""],
    ["longer", "CSV import bank"],
    ["lower", "csv import"]
  ]);
});
