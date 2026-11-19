import { parseArgs } from "node:util";
import { verifyLocalBackup } from "../src/server/database/backup-verification";

// No Next environment loader: an explicit local file must never fall back to a configured hosted database.
try {
  const { values } = parseArgs({
    options: {
      file: {
        type: "string"
      },
      "check-bank-secrets": {
        type: "boolean",
        default: false
      }
    },
    strict: true,
    allowPositionals: false
  });

  if (!values.file) {
    throw new Error("Usage: npm run db:verify-backup -- --file=/path/to/backup.sqlite [--check-bank-secrets]");
  }

  console.log(JSON.stringify(verifyLocalBackup(values.file, {
    checkBankSecrets: values["check-bank-secrets"]
  }), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local backup verification failed.");
  process.exitCode = 1;
}
