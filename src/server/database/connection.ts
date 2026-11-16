import { createClient, type Client, type Transaction } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { measureDatabaseCall } from "@/server/http/server-timing";
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

const databaseCalls = new Set<PropertyKey>(["execute", "batch", "migrate", "executeMultiple", "transaction", "commit", "rollback"]);

/** Counts each call that reaches the database toward the current request's Server-Timing, including calls inside a transaction. */
function measuredCalls<T extends object>(target: T): T {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);

      if (typeof value !== "function") {
        return value;
      }

      if (!databaseCalls.has(property)) {
        return value.bind(object);
      }

      return async (...args: unknown[]) => {
        const result = await measureDatabaseCall(() => value.apply(object, args));

        return property === "transaction" ? measuredCalls(result as Transaction) : result;
      };
    }
  });
}

export function database(): Promise<Database> {
  if (!globalDb.budgetDb) {
    const client = createDatabaseClient();

    globalDb.budgetDb = initializeDatabase(client).then(() => drizzle(measuredCalls(client), {
      schema
    })).catch(error => {
      globalDb.budgetDb = undefined;
      client.close();

      throw error;
    });
  }

  return globalDb.budgetDb;
}
