import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { Temporal } from "temporal-polyfill";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Client } from "@libsql/client";
import { timestamp } from "@/lib/time";

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

type LeaseWait = {
  waitMinutes?: number;
  pollMilliseconds?: number;
  renewalMilliseconds?: number;
};

// Renewed while the changesets run, so a long migration never loses the lease; a crashed one frees it within this time.
const migrationLeaseMinutes = 12;
const leaseRenewalMilliseconds = 4 * 60_000;

function leaseExpiry() {
  return timestamp(Temporal.Now.instant().add({
    minutes: migrationLeaseMinutes
  }));
}

/** Takes the named job lease on the maintenance connection; the application's lease helpers need a fully migrated database. */
async function acquireMaintenanceLease(client: Client, name: string, owner: string) {
  const now = Temporal.Now.instant();
  const result = await client.execute({
    sql: "INSERT INTO leases (name, owner, expires_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at WHERE leases.expires_at < ? RETURNING owner",
    args: [name, owner, leaseExpiry(), timestamp(now)]
  });

  return result.rows.length === 1;
}

/**
 * Applies pending changesets while holding the named job lease, so syncs, imports and conflicting writes cannot run in between.
 * Waits for a running job to finish and gives up after the wait time. Only an empty database skips the lease: it has no lease table and no jobs yet, while a legacy database may still be serving syncs.
 */
export async function migrateDatabaseUnderLease(client: Client, leaseName: string, wait: LeaseWait = {}, directory = migrationDirectory) {
  const status = await migrationStatus(client, directory);

  if (status.mode === "empty") {
    return migrateDatabase(client, directory);
  }

  const owner = `migration-${randomUUID()}`;
  const deadline = Temporal.Now.instant().add({
    minutes: wait.waitMinutes ?? 10
  });

  while (!(await acquireMaintenanceLease(client, leaseName, owner))) {
    if (Temporal.Instant.compare(Temporal.Now.instant(), deadline) >= 0) {
      throw new Error("The job lease stayed busy because a sync or import is running. Retry the migration once it has finished.");
    }

    await sleep(wait.pollMilliseconds ?? 15_000);
  }

  const renewal = setInterval(() => {
    void client.execute({
      sql: "UPDATE leases SET expires_at = ? WHERE name = ? AND owner = ?",
      args: [leaseExpiry(), leaseName, owner]
    }).catch(() => undefined);
  }, wait.renewalMilliseconds ?? leaseRenewalMilliseconds);

  try {
    return await migrateDatabase(client, directory);
  } finally {
    clearInterval(renewal);
    await client.execute({
      sql: "DELETE FROM leases WHERE name = ? AND owner = ?",
      args: [leaseName, owner]
    });
  }
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
