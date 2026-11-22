import { count, eq, inArray, or, sql } from "drizzle-orm";
import { sameCategoryName } from "@/lib/category-name";
import type { CategoryIconKey } from "@/features/categorization/category-icons";
import type { ColoredCategory } from "@/features/categorization/category-color-suggestions";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { categories, categorizationRules, transactionSplits, transactions } from "@/server/database/schema";

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

type ExistingCategories = ColoredCategory[];

async function readExistingCategories(tx: DatabaseTransaction): Promise<ExistingCategories> {
  return tx.select({
    id: categories.id,
    name: categories.name,
    color: categories.color,
    icon: categories.icon
  }).from(categories);
}

export type NewCategory = Omit<CategoryDetails, "color"> & {
  id: string;
  /** A color, or a choice made from the existing categories inside the caller's transaction, so concurrent creates see each other's colors. */
  color: string | ((existing: ExistingCategories) => string);
};

/**
 * The only way a category is created. Runs inside the caller's write transaction, which serializes concurrent writers, so the name check and the insert see the same rows.
 * The database constraint is case-sensitive and cannot catch case variants, so an equivalent name resolves to the existing category instead of creating one.
 * Resolves to the category's ID and whether this call inserted it.
 */
export async function createCategory(tx: DatabaseTransaction, category: NewCategory) {
  const existing = await readExistingCategories(tx);
  const match = existing.find(item => sameCategoryName(item.name, category.name));

  if (match) {
    return {
      id: match.id,
      created: false
    };
  }

  await tx.insert(categories).values({
    id: category.id,
    name: category.name,
    color: typeof category.color === "function" ? category.color(existing) : category.color,
    icon: category.icon
  });

  return {
    id: category.id,
    created: true
  };
}

export async function insertCategory(id: string, details: Omit<NewCategory, "id">): Promise<CategoryWriteResult> {
  const db = await database();
  const result = await db.transaction(tx => createCategory(tx, {
    ...details,
    id
  }));

  return result.created ? "saved" : "name_taken";
}

// Transactions and rules reference categories by id, so changing the details never touches assignments.
export async function updateCategory(id: string, details: CategoryDetails): Promise<CategoryWriteResult> {
  const db = await database();

  return db.transaction(async tx => {
    const existing = await readExistingCategories(tx);

    if (!existing.some(item => item.id === id)) {
      return "not_found";
    }

    if (existing.some(item => item.id !== id && sameCategoryName(item.name, details.name))) {
      return "name_taken";
    }

    await tx.update(categories).set({
      name: details.name,
      color: details.color,
      icon: details.icon
    }).where(eq(categories.id, id));

    return "saved";
  });
}

export type CategoryUsage = {
  transactions: number;
  manualTransactions: number;
  rules: number;
};

/** Everything that references a category. */
export async function readCategoryUsage(id: string): Promise<CategoryUsage | null> {
  const db = await database();

  if (!(await categoryExists(id))) {
    return null;
  }

  const [assigned, rules] = await Promise.all([
    db.select({
      total: count(),
      manual: sql<number>`COALESCE(SUM(${transactions.category_source}='manual'),0)`
    }).from(transactions).where(or(eq(transactions.category_id, id), inArray(transactions.id, db.select({
      id: transactionSplits.transaction_id
    }).from(transactionSplits).where(eq(transactionSplits.category_id, id))))).get(),
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

    // A split booking keeps no category of its own, so its parts count it once alongside the bookings in the category.
    const affected = await tx.select({
      count: count()
    }).from(transactions).where(or(eq(transactions.category_id, id), inArray(transactions.id, tx.selectDistinct({
      id: transactionSplits.transaction_id
    }).from(transactionSplits).where(eq(transactionSplits.category_id, id))))).get();

    await tx.update(transactions).set({
      category_id: deletion.replacementId
    }).where(eq(transactions.category_id, id));

    // Split parts follow the replacement too; without one, the foreign key leaves them uncategorized.
    await tx.update(transactionSplits).set({
      category_id: deletion.replacementId
    }).where(eq(transactionSplits.category_id, id));
    const rules = deletion.replacementId === null ? await tx.delete(categorizationRules).where(eq(categorizationRules.category_id, id)) : await tx.update(categorizationRules).set({
      category_id: deletion.replacementId
    }).where(eq(categorizationRules.category_id, id));

    await tx.delete(categories).where(eq(categories.id, id));

    return {
      status: "deleted",
      transactions: affected?.count ?? 0,
      rules: rules.rowsAffected
    };
  });
}
