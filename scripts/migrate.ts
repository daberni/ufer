import { loadEnvConfig } from "@next/env";
import { createDatabaseClient } from "../src/server/database/connection";
import { migrateDatabase, migrationStatus } from "../src/server/database/migrations";

async function main() {
  loadEnvConfig(process.cwd());

  const client = createDatabaseClient();

  try {
    const status = process.argv.includes("--status") ? await migrationStatus(client) : await migrateDatabase(client);

    console.log(JSON.stringify(status, null, 2));
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Database maintenance failed.");
  process.exitCode = 1;
});
