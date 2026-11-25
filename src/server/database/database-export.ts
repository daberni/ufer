import { existsSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Client, InValue, ResultSet, Transaction } from "@libsql/client";

type SchemaObject = {
  type: string;
  name: string;
  sql: string;
};

// Remote libSQL caps a single response (10 MB by default). Pages are planned from measured row sizes so each stays far below it.
export type ExportPaging = {
  pageBytes: number;
  sizeScanRows: number;
};

const defaultPaging: ExportPaging = {
  pageBytes: 2_000_000,
  // A size-scan row holds a key and one integer, so even this many stay small.
  sizeScanRows: 10_000
};

// Covers encoding overhead per value, so many tiny rows are bounded too.
const rowOverheadBytes = 64;

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

type Page = {
  first: number;
  count: number;
  lastKey: InValue;
};

/**
 * Plans byte-bounded pages from a cheap scan of row sizes and keys. A single row larger than the budget gets a page of its own.
 * Rowid tables are scanned by `_rowid_`; tables without rowid by primary key with an offset.
 */
async function* planPages(transaction: Transaction, table: SchemaObject, columns: string[], paging: ExportPaging): AsyncGenerator<Page> {
  const name = quoteIdentifier(table.name);
  const sizeExpression = columns.map(column => `COALESCE(length(CAST(${quoteIdentifier(column)} AS BLOB)), 0)`).join(" + ") || "0";
  const withoutRowid = isWithoutRowid(table);
  const order = withoutRowid ? await primaryKeyOrder(transaction, table) : "_rowid_";
  const key = withoutRowid ? "NULL" : "_rowid_";
  let page: Page = {
    first: 0,
    count: 0,
    lastKey: null
  };
  let bytes = 0;
  let scanned = 0;
  let lastKey: InValue = null;

  for (;;) {
    const scan: ResultSet = withoutRowid || lastKey === null
      ? await transaction.execute({
        sql: `SELECT ${key}, ${sizeExpression} FROM ${name} ORDER BY ${order} LIMIT ? OFFSET ?`,
        args: [paging.sizeScanRows, withoutRowid ? scanned : 0]
      })
      : await transaction.execute({
        sql: `SELECT ${key}, ${sizeExpression} FROM ${name} WHERE _rowid_ > ? ORDER BY ${order} LIMIT ?`,
        args: [lastKey, paging.sizeScanRows]
      });

    for (const row of scan.rows) {
      const size = Number(row[1]) + rowOverheadBytes;

      if (page.count > 0 && bytes + size > paging.pageBytes) {
        yield page;
        page = {
          first: page.first + page.count,
          count: 0,
          lastKey: page.lastKey
        };
        bytes = 0;
      }

      page.count += 1;
      page.lastKey = row[0];
      bytes += size;
      lastKey = row[0];
    }

    scanned += scan.rows.length;

    if (scan.rows.length < paging.sizeScanRows) {
      break;
    }
  }

  if (page.count > 0) {
    yield page;
  }
}

async function primaryKeyOrder(transaction: Transaction, table: SchemaObject) {
  const keys = await transaction.execute(`SELECT name FROM pragma_table_info(${quoteLiteral(table.name)}) WHERE pk > 0 ORDER BY pk`);

  return keys.rows.map(row => quoteIdentifier(String(row.name))).join(", ");
}

/** Copies one table in byte-bounded pages inside the caller's read transaction. */
async function copyRows(transaction: Transaction, local: DatabaseSync, table: SchemaObject, paging: ExportPaging) {
  const name = quoteIdentifier(table.name);
  const columns = (await transaction.execute(`SELECT name FROM pragma_table_info(${quoteLiteral(table.name)}) ORDER BY cid`)).rows.map(row => String(row.name));
  const columnList = columns.map(quoteIdentifier).join(", ");
  const insert = local.prepare(`INSERT INTO ${name} (${columnList}) VALUES (${columns.map(() => "?").join(", ")})`);
  const withoutRowid = isWithoutRowid(table);
  const order = withoutRowid ? await primaryKeyOrder(transaction, table) : "_rowid_";
  let previousKey: InValue = null;

  for await (const page of planPages(transaction, table, columns, paging)) {
    const rows = withoutRowid
      ? await transaction.execute({
        sql: `SELECT ${columnList} FROM ${name} ORDER BY ${order} LIMIT ? OFFSET ?`,
        args: [page.count, page.first]
      })
      : await transaction.execute({
        sql: `SELECT ${columnList} FROM ${name} WHERE ${previousKey === null ? "" : "_rowid_ > ? AND "}_rowid_ <= ? ORDER BY _rowid_`,
        args: previousKey === null ? [page.lastKey] : [previousKey, page.lastKey]
      });

    for (const row of rows.rows) {
      insert.run(...columns.map((_, index) => localValue(row[index])));
    }

    previousKey = page.lastKey;
  }
}

/**
 * Copies every table, row, index, trigger and view of a libSQL database into a new self-contained SQLite file.
 * All reads run in one read transaction, so the copy is a consistent snapshot even while the application writes.
 */
export async function exportDatabase(client: Client, destination: string, paging: ExportPaging = defaultPaging) {
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
        await copyRows(transaction, local, table, paging);
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
