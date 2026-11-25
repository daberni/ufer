import { loadEnvConfig } from "@next/env";
import { createDatabaseClient } from "../src/server/database/connection";
import { migrateDatabaseUnderLeases, migrationReport } from "../src/server/database/migrations";
import { marketDataLease } from "../src/features/securities/server/price-update-service";
import { syncLease } from "../src/server/jobs/lease";

async function main() {
  loadEnvConfig(process.cwd());

  const client = createDatabaseClient();

  try {
    const status = process.argv.includes("--status") ? await migrationReport(client) : await migrateDatabaseUnderLeases(client, [syncLease, marketDataLease]);

    console.log(JSON.stringify(status, null, 2));
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Database maintenance failed.");
  process.exitCode = 1;
});
