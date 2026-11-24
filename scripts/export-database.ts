import { parseArgs } from "node:util";
import { createClient } from "@libsql/client";
import { exportDatabase } from "../src/server/database/database-export";

// No Next environment loader: the source must be configured explicitly, never picked up from a local .env file.
async function main() {
  const { values } = parseArgs({
    options: {
      file: {
        type: "string"
      }
    },
    strict: true,
    allowPositionals: false
  });
  const url = process.env.DATABASE_URL;

  if (!values.file || !url) {
    throw new Error("Usage: DATABASE_URL=… [DATABASE_AUTH_TOKEN=…] npm run db:export -- --file=/path/to/new-export.sqlite");
  }

  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
    // Exact 64-bit integers; the copy must not round large values.
    intMode: "bigint"
  });

  try {
    const result = await exportDatabase(client, values.file);

    console.log(`Exported ${result.tables} tables.`);
  } finally {
    client.close();
  }
}

main().catch(error => {
  // Driver errors can name the database host; keep the public workflow log to a generic message.
  console.error(error instanceof Error && error.message.startsWith("The export destination") ? error.message : "Database export failed.");
  process.exitCode = 1;
});
