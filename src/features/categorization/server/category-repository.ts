import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { categories } from "@/server/database/schema";

export async function categoryExists(id: string) {
  const db = await database();
  const result = await db.select({
    id: categories.id
  }).from(categories).where(eq(categories.id, id)).get();

  return Boolean(result);
}

export async function insertCategory(name: string) {
  const db = await database();

  await db.insert(categories).values({
    id: randomUUID(),
    name,
    color: "#638777"
  });
}
