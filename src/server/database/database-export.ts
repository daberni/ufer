import { existsSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Client, InValue } from "@libsql/client";

type SchemaObject = {
  type: string;
  name: string;
  sql: string;
};

/** Internal tables of SQLite, libSQL and replication tooling; SQLite recreates `sqlite_sequence` from the AUTOINCREMENT tables. */
function isInternalTable(name: string) {
  return name.startsWith("sqlite_") || name.startsWith("libsql_") || name.startsWith("_litestream");
}

function quoteIdentifier(name: string) {
  return `"${name.replaceAll("\"", "\"\"")}"`;
}

function localValue(value: InValue): SQLInputValue {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (value instanceof Date) {
    throw new Error("Unexpected date value in a database row.");
  }

  return value ?? null;
}

/**
 * Copies every table, row, index, trigger and view of a libSQL database into a new self-contained SQLite file.
 * All reads run in one read transaction, so the copy is a consistent snapshot even while the application writes.
 */
export async function exportDatabase(client: Client, destination: string) {
  if (existsSync(destination)) {
    throw new Error("The export destination already exists; choose a new file.");
  }

  const transaction = await client.transaction("read");

  try {
    const objects = (await transaction.execute("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid")).rows.map(row => ({
      type: String(row.type),
      name: String(row.name),
      sql: String(row.sql)
    }) satisfies SchemaObject);
    const tables = objects.filter(object => object.type === "table" && !isInternalTable(object.name));
    const laterObjects = objects.filter(object => object.type !== "table" && !object.name.startsWith("sqlite_"));
    const hasSequence = objects.some(object => object.name === "sqlite_sequence");
    const local = new DatabaseSync(destination);

    try {
      local.exec("PRAGMA journal_mode = DELETE");
      local.exec("PRAGMA foreign_keys = OFF");
      local.exec("BEGIN");

      for (const table of tables) {
        local.exec(table.sql);
      }

      for (const table of tables) {
        const result = await transaction.execute(`SELECT * FROM ${quoteIdentifier(table.name)}`);

        if (!result.rows.length) {
          continue;
        }

        const columns = result.columns.map(quoteIdentifier).join(", ");
        const placeholders = result.columns.map(() => "?").join(", ");
        const insert = local.prepare(`INSERT INTO ${quoteIdentifier(table.name)} (${columns}) VALUES (${placeholders})`);

        for (const row of result.rows) {
          insert.run(...result.columns.map((_, index) => localValue(row[index])));
        }
      }

      if (hasSequence) {
        const sequences = await transaction.execute("SELECT name, seq FROM sqlite_sequence");

        // Copied rows already advanced the counters to the highest id; the source may be higher after deletions.
        local.exec("DELETE FROM sqlite_sequence");
        const insert = local.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)");

        for (const row of sequences.rows) {
          insert.run(localValue(row.name), localValue(row.seq));
        }
      }

      for (const object of laterObjects) {
        local.exec(object.sql);
      }

      local.exec("COMMIT");
    } finally {
      local.close();
    }

    return {
      tables: tables.length
    };
  } finally {
    transaction.close();
  }
}
