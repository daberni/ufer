import { count, eq, inArray, sql } from "drizzle-orm";
import type { InStatement } from "@libsql/client";
import { sameCategoryName } from "@/lib/category-name";
import type { CategoryIconKey } from "@/features/categorization/category-icons";
import type { ColoredCategory } from "@/features/categorization/category-color-suggestions";
import { database } from "@/server/database/connection";
import { categories, categorizationRules, transactions } from "@/server/database/schema";

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
async function writeUniquelyNamed(existingId: string | null, name: string, statement: InStatement | ((existing: ColoredCategory[]) => InStatement)): Promise<CategoryWriteResult> {
  const db = await database();
  const transaction = await db.$client.transaction("write");

  try {
    const rows = (await transaction.execute("SELECT id, name, color, icon FROM categories")).rows;
    const targetMissing = existingId !== null && !rows.some(row => row.id === existingId);
    const nameTaken = rows.some(row => row.id !== existingId && sameCategoryName(String(row.name), name));

    if (targetMissing || nameTaken) {
      await transaction.rollback();

      return targetMissing ? "not_found" : "name_taken";
    }

    const existing = rows.map(row => ({
      id: String(row.id),
      name: String(row.name),
      color: String(row.color),
      icon: row.icon === null ? null : String(row.icon)
    }));

    await transaction.execute(typeof statement === "function" ? statement(existing) : statement);
    await transaction.commit();

    return "saved";
  } catch (error) {
    await transaction.rollback();

    throw error;
  } finally {
    transaction.close();
  }
}

export type NewCategoryDetails = Omit<CategoryDetails, "color"> & {
  /** A color, or a choice made from the existing categories inside the write transaction, so concurrent creates see each other's colors. */
  color: string | ((existing: ColoredCategory[]) => string);
};

export async function insertCategory(id: string, details: NewCategoryDetails) {
  const { color } = details;

  return writeUniquelyNamed(null, details.name, existing => ({
    sql: "INSERT INTO categories(id,name,color,icon) VALUES (?,?,?,?)",
    args: [id, details.name, typeof color === "function" ? color(existing) : color, details.icon]
  }));
}

// Transactions and rules reference categories by id, so changing the details never touches assignments.
export async function updateCategory(id: string, details: CategoryDetails) {
  return writeUniquelyNamed(id, details.name, {
    sql: "UPDATE categories SET name=?, color=?, icon=? WHERE id=?",
    args: [details.name, details.color, details.icon, id]
  });
}

export type CategoryUsage = {
  transactions: number;
  manualTransactions: number;
  rules: number;
};

/** Everything that references a category, across all provider environments, since categories are shared by them. */
export async function readCategoryUsage(id: string): Promise<CategoryUsage | null> {
  const db = await database();

  if (!(await categoryExists(id))) {
    return null;
  }

  const [assigned, rules] = await Promise.all([
    db.select({
      total: count(),
      manual: sql<number>`COALESCE(SUM(${transactions.category_source}='manual'),0)`
    }).from(transactions).where(eq(transactions.category_id, id)).get(),
    db.select({
      total: count()
    }).from(categorizationRules).where(eq(categorizationRules.category_id, id)).get()
  ]);

  return {
    transactions: assigned?.total ?? 0,
    manualTransactions: Number(assigned?.manual ?? 0),
    rules: rules?.total ?? 0
  };
}

export type CategoryDeletion = {
  /** The category that receives the transactions and rules; null leaves the transactions uncategorized and deletes the rules. */
  replacementId: string | null;
};

export type CategoryDeleteResult = {
  status: "deleted";
  transactions: number;
  rules: number;
} | {
  status: "not_found" | "replacement_not_found";
};

/**
 * Deletes a category and moves what referenced it in one write transaction. Transactions keep their category source, so a manual assignment stays manual
 * (with the replacement or uncategorized) and is never overwritten by rules afterwards.
 */
export async function deleteCategory(id: string, deletion: CategoryDeletion): Promise<CategoryDeleteResult> {
  const db = await database();

  return db.transaction(async tx => {
    const ids = [id, deletion.replacementId].filter(value => value !== null);
    const existing = new Set((await tx.select({
      id: categories.id
    }).from(categories).where(inArray(categories.id, ids))).map(row => row.id));

    if (!existing.has(id)) {
      return {
        status: "not_found"
      };
    }

    if (deletion.replacementId !== null && !existing.has(deletion.replacementId)) {
      return {
        status: "replacement_not_found"
      };
    }

    // Moved rules keep their references; without a replacement the rules are deleted, so every reference to them is cleared, also from transactions a rule assigned before it was retargeted to this category.
    if (deletion.replacementId === null) {
      const deletedRules = tx.select({
        id: categorizationRules.id
      }).from(categorizationRules).where(eq(categorizationRules.category_id, id));

      await tx.update(transactions).set({
        category_rule_id: null
      }).where(inArray(transactions.category_rule_id, deletedRules));
      await tx.update(transactions).set({
        type_rule_id: null
      }).where(inArray(transactions.type_rule_id, deletedRules));
    }

    const moved = await tx.update(transactions).set({
      category_id: deletion.replacementId
    }).where(eq(transactions.category_id, id));
    const rules = deletion.replacementId === null ? await tx.delete(categorizationRules).where(eq(categorizationRules.category_id, id)) : await tx.update(categorizationRules).set({
      category_id: deletion.replacementId
    }).where(eq(categorizationRules.category_id, id));

    await tx.delete(categories).where(eq(categories.id, id));

    return {
      status: "deleted",
      transactions: moved.rowsAffected,
      rules: rules.rowsAffected
    };
  });
}
