import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { initializeDatabase } from "../src/server/database/migrations";
import { verifyLocalBackup } from "../src/server/database/backup-verification";
import { exportDatabase } from "../src/server/database/database-export";

async function sourceFixture(context: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ufer-export-"));
  const file = join(directory, "source.sqlite");
  const client = createClient({
    url: `file:${file}`,
    intMode: "bigint"
  });

  await initializeDatabase(client);
  context.after(() => {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  });

  return {
    directory,
    file,
    client
  };
}

function snapshot(file: string) {
  const db = new DatabaseSync(file, {
    readOnly: true,
    readBigInts: true
  });

  try {
    const objects = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    // Sorted in JavaScript because tables without rowid have no common order column.
    const sortKey = (row: unknown) => JSON.stringify(row, (_, value) => typeof value === "bigint" ? value.toString() : value);
    const rows = Object.fromEntries(objects.filter(object => object.type === "table").map(object => [object.name, db.prepare(`SELECT * FROM "${String(object.name)}"`).all().map(row => ({
      key: sortKey(row),
      row
    })).sort((left, right) => left.key.localeCompare(right.key)).map(entry => entry.row)]));

    return {
      objects,
      rows
    };
  } finally {
    db.close();
  }
}

test("an export copies schema, rows, exact integers and blobs into a self-contained file that passes backup verification", async context => {
  const {
    directory,
    file,
    client
  } = await sourceFixture(context);
  const destination = join(directory, "export.sqlite");

  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("CREATE TABLE export_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER NOT NULL, payload BLOB)");
  await client.execute("CREATE INDEX export_probe_amount ON export_probe (amount)");
  await client.execute({
    sql: "INSERT INTO export_probe (amount, payload) VALUES (?, ?)",
    args: [9007199254740993n, new Uint8Array([0, 1, 254, 255])]
  });
  await client.execute("INSERT INTO export_probe (amount) VALUES (2)");
  await client.execute("DELETE FROM export_probe WHERE amount = 2");

  await exportDatabase(client, destination);

  for (const suffix of ["-wal", "-journal"]) {
    assert.equal(existsSync(`${destination}${suffix}`), false);
  }

  const copy = new DatabaseSync(destination, {
    readOnly: true,
    readBigInts: true
  });

  try {
    assert.equal(copy.prepare("SELECT amount FROM export_probe").get()?.amount, 9007199254740993n);
    assert.deepEqual(copy.prepare("SELECT payload FROM export_probe").get()?.payload, new Uint8Array([0, 1, 254, 255]));
    assert.deepEqual(copy.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'export_probe'").all().map(row => row.seq), [2n]);
  } finally {
    copy.close();
  }

  assert.deepEqual(snapshot(destination), snapshot(file));
  assert.equal(verifyLocalBackup(destination).appliedMigrations > 0, true);
});

test("an export never overwrites an existing file", async context => {
  const {
    directory,
    client
  } = await sourceFixture(context);
  const destination = join(directory, "existing.sqlite");

  writeFileSync(destination, "keep");

  await assert.rejects(exportDatabase(client, destination), /already exists/);
});

test("an export reads large tables in bounded pages, including tables without rowid, and still copies every row", async context => {
  const {
    directory,
    file,
    client
  } = await sourceFixture(context);
  const destination = join(directory, "paged.sqlite");

  await client.execute("CREATE TABLE paged_rows (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
  await client.execute("CREATE TABLE paged_keys (scope TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (scope, position)) WITHOUT ROWID");

  for (let index = 1; index <= 7; index += 1) {
    await client.execute({
      sql: "INSERT INTO paged_rows (id, label) VALUES (?, ?)",
      args: [index * 10, `row ${index}`]
    });
    await client.execute({
      sql: "INSERT INTO paged_keys (scope, position) VALUES (?, ?)",
      args: [index % 2 ? "odd" : "even", index]
    });
  }

  await exportDatabase(client, destination, 2);

  assert.deepEqual(snapshot(destination), snapshot(file));
});
