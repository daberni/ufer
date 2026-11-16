import { eq } from "drizzle-orm";
import type { InStatement } from "@libsql/client";
import { sameCategoryName } from "@/lib/category-name";
import type { CategoryIconKey } from "@/features/categorization/category-icons";
import { database } from "@/server/database/connection";
import { categories } from "@/server/database/schema";

export type CategoryDetails = {
  name: string;
  color: string;
  icon: CategoryIconKey | null;
};

export type CategoryWriteResult = "saved" | "name_taken" | "not_found";

export async function categoryExists(id: string) {
  const db = await database();
  const result = await db.select({
    id: categories.id
  }).from(categories).where(eq(categories.id, id)).get();

  return Boolean(result);
}

// The name check and the write share one write-mode transaction, which serializes concurrent writers.
// The database constraint is case-sensitive and cannot catch case variants of the same name.
async function writeUniquelyNamed(existingId: string | null, name: string, statement: InStatement): Promise<CategoryWriteResult> {
  const db = await database();
  const transaction = await db.$client.transaction("write");

  try {
    const rows = (await transaction.execute("SELECT id, name FROM categories")).rows;
    const targetMissing = existingId !== null && !rows.some(row => row.id === existingId);
    const nameTaken = rows.some(row => row.id !== existingId && sameCategoryName(String(row.name), name));

    if (targetMissing || nameTaken) {
      await transaction.rollback();

      return targetMissing ? "not_found" : "name_taken";
    }

    await transaction.execute(statement);
    await transaction.commit();

    return "saved";
  } catch (error) {
    await transaction.rollback();

    throw error;
  } finally {
    transaction.close();
  }
}

export async function insertCategory(id: string, details: CategoryDetails) {
  return writeUniquelyNamed(null, details.name, {
    sql: "INSERT INTO categories(id,name,color,icon) VALUES (?,?,?,?)",
    args: [id, details.name, details.color, details.icon]
  });
}

// Transactions and rules reference categories by id, so changing the details never touches assignments.
export async function updateCategory(id: string, details: CategoryDetails) {
  return writeUniquelyNamed(id, details.name, {
    sql: "UPDATE categories SET name=?, color=?, icon=? WHERE id=?",
    args: [details.name, details.color, details.icon, id]
  });
}
