import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { appliedChangesetCount, releaseTables, verifyLocalBackup } from "../src/server/database/backup-verification";

// No Next environment loader: an explicit local file must never fall back to a configured hosted database.
async function main() {
  const { values } = parseArgs({
    options: {
      file: {
        type: "string"
      },
      "check-bank-secrets": {
        type: "boolean",
        default: false
      },
      migrations: {
        type: "string"
      }
    },
    strict: true,
    allowPositionals: false
  });

  if (!values.file) {
    throw new Error("Usage: npm run db:verify-backup -- --file=/path/to/backup.sqlite [--check-bank-secrets] [--migrations=/path/to/release/drizzle/sqlite]");
  }

  // A release's changesets, up to the backup's applied count, define both the expected history and the expected tables.
  const migrationDirectory = values.migrations ? resolve(values.migrations) : undefined;
  const expectedTables = migrationDirectory ? await releaseTables(migrationDirectory, appliedChangesetCount(values.file)) : undefined;

  console.log(JSON.stringify(verifyLocalBackup(values.file, {
    checkBankSecrets: values["check-bank-secrets"],
    migrationDirectory,
    expectedTables,
    allowNewerChangesets: Boolean(migrationDirectory)
  }), null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Local backup verification failed.");
  process.exitCode = 1;
});
