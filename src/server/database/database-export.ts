import { existsSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Client, InValue, Row, Transaction } from "@libsql/client";

type SchemaObject = {
  type: string;
  name: string;
  sql: string;
};

// Remote libSQL caps a single response (10 MB by default); bounded pages keep large tables below it.
const defaultPageSize = 500;

/** Internal tables of SQLite, libSQL and replication tooling; SQLite recreates `sqlite_sequence` from the AUTOINCREMENT tables. */
function isInternalTable(name: string) {
  return name.startsWith("sqlite_") || name.startsWith("libsql_") || name.startsWith("_litestream");
}

function quoteIdentifier(name: string) {
  return `"${name.replaceAll("\"", "\"\"")}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
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

function isWithoutRowid(table: SchemaObject) {
  return /\bWITHOUT\s+ROWID\b/i.test(table.sql);
}

/** Reads one table page by page inside the caller's read transaction and inserts the rows into the local copy. */
async function copyRows(transaction: Transaction, local: DatabaseSync, table: SchemaObject, pageSize: number) {
  const name = quoteIdentifier(table.name);
  const columns = (await transaction.execute(`SELECT name FROM pragma_table_info(${quoteLiteral(table.name)}) ORDER BY cid`)).rows.map(row => String(row.name));
  const columnList = columns.map(quoteIdentifier).join(", ");
  const insert = local.prepare(`INSERT INTO ${name} (${columnList}) VALUES (${columns.map(() => "?").join(", ")})`);
  const insertPage = (rows: Row[]) => {
    for (const row of rows) {
      insert.run(...columns.map((_, index) => localValue(row[index])));
    }
  };

  if (isWithoutRowid(table)) {
    // No rowid to page by; the primary key gives a stable order within the snapshot.
    const keys = (await transaction.execute(`SELECT name FROM pragma_table_info(${quoteLiteral(table.name)}) WHERE pk > 0 ORDER BY pk`)).rows.map(row => quoteIdentifier(String(row.name))).join(", ");

    for (let offset = 0; ; offset += pageSize) {
      const page = await transaction.execute({
        sql: `SELECT ${columnList} FROM ${name} ORDER BY ${keys} LIMIT ? OFFSET ?`,
        args: [pageSize, offset]
      });

      insertPage(page.rows);

      if (page.rows.length < pageSize) {
        return;
      }
    }
  }

  let lastRowid: InValue = null;

  for (;;) {
    const after = lastRowid === null ? "" : "WHERE _rowid_ > ?";
    const page = await transaction.execute({
      sql: `SELECT ${columnList}, _rowid_ FROM ${name} ${after} ORDER BY _rowid_ LIMIT ?`,
      args: lastRowid === null ? [pageSize] : [lastRowid, pageSize]
    });

    insertPage(page.rows);

    if (page.rows.length < pageSize) {
      return;
    }

    lastRowid = page.rows[page.rows.length - 1][columns.length];
  }
}

/**
 * Copies every table, row, index, trigger and view of a libSQL database into a new self-contained SQLite file.
 * All reads run in one read transaction, so the copy is a consistent snapshot even while the application writes.
 */
export async function exportDatabase(client: Client, destination: string, pageSize = defaultPageSize) {
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
        await copyRows(transaction, local, table, pageSize);
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
