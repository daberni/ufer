import { asc, eq } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { categories, categorizationRules } from "@/server/database/schema";

export async function listCategories() {
  const db = await database();

  return db.select({
    id: categories.id,
    name: categories.name,
    color: categories.color,
    is_transfer: categories.is_transfer,
    icon: categories.icon
  }).from(categories).orderBy(asc(categories.name));
}

/** Rules in matching order, with the presentation of the category each one assigns. */
export async function listRuleSummaries() {
  const db = await database();

  return db.select({
    id: categorizationRules.id,
    name: categorizationRules.name,
    pattern: categorizationRules.pattern,
    mode: categorizationRules.mode,
    priority: categorizationRules.priority,
    enabled: categorizationRules.enabled,
    category_name: categories.name,
    category_color: categories.color,
    category_icon: categories.icon
  }).from(categorizationRules).innerJoin(categories, eq(categories.id, categorizationRules.category_id)).orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));
}
