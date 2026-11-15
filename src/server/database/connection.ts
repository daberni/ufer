import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { initializeDatabase } from "./migrations";
import * as schema from "./schema";

export type Database = LibSQLDatabase<typeof schema> & {
  $client: Client;
};

export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const globalDb = globalThis as unknown as {
  budgetDb?: Promise<Database>;
};

export function createDatabaseClient() {
  const url = process.env.DATABASE_URL || "file:data/budget.db";

  if (process.env.VERCEL && url.startsWith("file:")) {
    throw new Error("Vercel requires a persistent external libSQL database.");
  }

  if (url.startsWith("file:")) {
    mkdirSync(dirname(url.slice(5)), {
      recursive: true
    });
  }

  return createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
    intMode: "number"
  });
}

export function database(): Promise<Database> {
  if (!globalDb.budgetDb) {
    const client = createDatabaseClient();

    globalDb.budgetDb = initializeDatabase(client).then(() => drizzle(client, {
      schema
    })).catch(error => {
      globalDb.budgetDb = undefined;
      client.close();

      throw error;
    });
  }

  return globalDb.budgetDb;
}
