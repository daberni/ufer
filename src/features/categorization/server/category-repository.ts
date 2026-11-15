import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { categories } from "@/server/database/schema";

export type CategoryDetails = {
  name: string;
  color: string;
};

export async function categoryExists(id: string) {
  const db = await database();
  const result = await db.select({
    id: categories.id
  }).from(categories).where(eq(categories.id, id)).get();

  return Boolean(result);
}

export async function categoryNameTaken(name: string, excludedId?: string) {
  const db = await database();
  const sameName = sql`lower(${categories.name}) = lower(${name})`;
  const scope = excludedId ? and(sameName, ne(categories.id, excludedId)) : sameName;
  const result = await db.select({
    id: categories.id
  }).from(categories).where(scope).get();

  return Boolean(result);
}

export async function insertCategory(details: CategoryDetails) {
  const db = await database();

  await db.insert(categories).values({
    id: randomUUID(),
    ...details
  });
}

// Transactions and rules reference categories by id, so changing the details never touches assignments.
export async function updateCategory(id: string, details: CategoryDetails) {
  const db = await database();

  await db.update(categories).set(details).where(eq(categories.id, id));
}
