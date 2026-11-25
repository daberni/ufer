import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Client } from "@libsql/client";

const migrationDirectory = resolve(process.cwd(), "drizzle/sqlite");
const historyTable = "__drizzle_migrations";

type SchemaObject = {
  name: string;
  type: string;
  sql: string;
};

export type MigrationStatus = {
  mode: "empty" | "legacy" | "managed";
  applied: number;
  pending: number;
};

function migrationFiles(directory = migrationDirectory) {
  return readMigrationFiles({
    migrationsFolder: directory
  });
}

function normalizeDefinition(sql: string) {
  // SQL keywords/identifiers are case-insensitive; quoted values are not.
  const fragments = sql.match(/'(?:''|[^'])*'|[^']+/g) || [];

  return fragments.map(fragment => {
    if (fragment.startsWith("'")) {
      return fragment;
    }

    return fragment.replace(/\bif\s+not\s+exists\b/gi, "").replace(/[\s`";]/g, "").toLowerCase();
  }).join("");
}

async function schemaObjects(client: Client) {
  const result = await client.execute("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name");

  return result.rows as unknown as SchemaObject[];
}

function verifyLegacyBaseline(objects: SchemaObject[], directory: string) {
  const baseline = migrationFiles(directory)[0];
  const definitions = baseline.sql.filter(statement => /^\s*CREATE\s+(TABLE|INDEX)/i.test(statement));
  const expected = new Set(definitions.map(normalizeDefinition));
  const actual = new Set(objects.map(object => normalizeDefinition(object.sql)));
  const matches = expected.size === actual.size && [...expected].every(definition => actual.has(definition));

  if (!matches) {
    throw new Error("The existing database differs from the known legacy schema. Review and back up the database before preparing an explicit migration.");
  }
}

export async function migrationStatus(client: Client, directory = migrationDirectory): Promise<MigrationStatus> {
  const objects = await schemaObjects(client);

  if (!objects.length) {
    return {
      mode: "empty",
      applied: 0,
      pending: migrationFiles(directory).length
    };
  }

  if (!objects.some(object => object.name === historyTable)) {
    verifyLegacyBaseline(objects, directory);

    return {
      mode: "legacy",
      applied: 0,
      pending: migrationFiles(directory).length
    };
  }

  const result = await client.execute(`SELECT hash,created_at FROM ${historyTable} ORDER BY created_at`);

  return verifyAppliedMigrations(result.rows.map(row => ({
    hash: row.hash,
    created_at: row.created_at
  })), directory);
}

/** Migration status plus the names of the pending changesets in apply order, for review before a migration. */
export async function migrationReport(client: Client, directory = migrationDirectory) {
  const status = await migrationStatus(client, directory);
  const journal = JSON.parse(readFileSync(resolve(directory, "meta", "_journal.json"), "utf8")) as {
    entries: {
      tag: string
    }[]
  };

  return {
    ...status,
    pendingChangesets: journal.entries.slice(journal.entries.length - status.pending).map(entry => `${entry.tag}.sql`)
  };
}

/** Verifies persisted history without applying SQL; also used by read-only offline recovery checks. */
export function verifyAppliedMigrations(rows: {
  hash: unknown;
  created_at: unknown
}[], directory = migrationDirectory): MigrationStatus {
  const files = migrationFiles(directory);

  for (const [index, row] of rows.entries()) {
    const file = files[index];

    if (!file || file.hash !== row.hash || file.folderMillis !== Number(row.created_at)) {
      throw new Error("Migration history differs from the checked-in SQL changesets. Restore the original files or prepare a new forward migration.");
    }
  }

  return {
    mode: "managed",
    applied: rows.length,
    pending: files.length - rows.length
  };
}

export async function migrateDatabase(client: Client, directory = migrationDirectory) {
  // Existing databases are only upgraded by an explicitly invoked maintenance command.
  await migrationStatus(client, directory);
  await client.execute("PRAGMA foreign_keys = ON");
  await migrate(drizzle(client), {
    migrationsFolder: directory
  });

  return migrationStatus(client, directory);
}

export async function initializeDatabase(client: Client, directory = migrationDirectory) {
  await client.execute("PRAGMA foreign_keys = ON");
  const status = await migrationStatus(client, directory);

  if (status.mode === "empty") {
    // Preserve first-run setup without silently upgrading any existing database.
    await migrateDatabase(client, directory);
  } else if (status.pending > (status.mode === "legacy" ? 1 : 0)) {
    throw new Error("Database migrations are pending. Back up the database and run npm run db:migrate explicitly before starting the application.");
  }

  return client;
}
