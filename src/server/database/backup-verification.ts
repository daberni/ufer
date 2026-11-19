import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { decrypt } from "@/server/security/secret-box";
import { verifyAppliedMigrations } from "./migrations";
import * as schema from "./schema";

/** Checks a standalone local SQLite artifact; never loads environment files, opens remote URLs or applies migrations. */
export function verifyLocalBackup(filename: string, options: {
  checkBankSecrets?: boolean
} = {}) {
  if (filename.includes("://")) {
    throw new Error("Provide a local filesystem path, not a database URL.");
  }

  const file = realpathSync(resolve(filename));

  if (!statSync(file).isFile()) {
    throw new Error("Provide an existing local SQLite backup file.");
  }

  assertStandaloneBackup(file);

  const db = new DatabaseSync(file, {
    readOnly: true
  });

  try {
    const integrity = db.prepare("PRAGMA integrity_check").all();

    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      throw new Error("The backup failed SQLite integrity verification.");
    }

    if (db.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("The backup contains broken foreign-key references.");
    }

    const rows = db.prepare("SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at").all();
    const status = verifyAppliedMigrations(rows.map(row => ({
      hash: row.hash,
      created_at: row.created_at
    })));

    if (!status.applied || status.pending) {
      throw new Error("Use the application revision matching the backup's applied migrations. This check never upgrades a database.");
    }

    const counts: Record<string, number> = {};

    for (const table of Object.values(schema)) {
      if (is(table, SQLiteTable)) {
        const name = getTableName(table);

        counts[name] = Number(db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get()?.count);
      }
    }

    const bankSessions = db.prepare("SELECT session_cipher FROM requisitions WHERE session_cipher IS NOT NULL").all();

    if (options.checkBankSecrets) {
      try {
        for (const row of bankSessions) {
          if (typeof row.session_cipher !== "string") {
            throw new Error("Invalid encrypted session.");
          }

          decrypt(row.session_cipher);
        }
      } catch {
        throw new Error("Bank sessions could not be decrypted with the supplied DATA_ENCRYPTION_KEY.");
      }
    }

    assertStandaloneBackup(file);

    return {
      appliedMigrations: status.applied,
      counts,
      encryptedBankSessions: bankSessions.length,
      bankSessionSecrets: options.checkBankSecrets ? "verified" : "not_checked"
    };
  } finally {
    db.close();
  }
}


function assertStandaloneBackup(file: string) {
  // Read-only SQLite still consults recovery logs; those pages would be lost when moving only the named artifact.
  for (const suffix of ["-wal", "-journal"]) {
    const sidecar = statSync(`${file}${suffix}`, {
      throwIfNoEntry: false
    });

    if (sidecar && sidecar.size > 0) {
      throw new Error("The backup is not self-contained: nonempty SQLite recovery logs are present. Create a consistent SQLite backup in a fresh directory before verification.");
    }
  }
}
