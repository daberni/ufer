import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { database } from "@/server/database/connection";
import { accounts, categories, categorizationRules } from "@/server/database/schema";

export async function listCategories() {
  const db = await database();

  return db.select({
    id: categories.id,
    name: categories.name,
    color: categories.color,
    icon: categories.icon
  }).from(categories).orderBy(asc(categories.name));
}

/** Rules in matching order, with the presentation of the category each one assigns and the names of a transfer's account and of the account the rule is limited to; an unknown account has no name. */
export async function listRuleSummaries() {
  const db = await database();
  const conditionAccounts = alias(accounts, "condition_accounts");

  return db.select({
    id: categorizationRules.id,
    name: categorizationRules.name,
    pattern: categorizationRules.pattern,
    mode: categorizationRules.mode,
    priority: categorizationRules.priority,
    enabled: categorizationRules.enabled,
    category_id: categorizationRules.category_id,
    category_name: categories.name,
    category_color: categories.color,
    category_icon: categories.icon,
    transaction_type: categorizationRules.transaction_type,
    transfer_account_id: categorizationRules.transfer_account_id,
    transfer_account_name: accounts.name,
    account_id: categorizationRules.account_id,
    account_name: conditionAccounts.name
  }).from(categorizationRules).innerJoin(categories, eq(categories.id, categorizationRules.category_id)).leftJoin(accounts, eq(accounts.id, categorizationRules.transfer_account_id)).leftJoin(conditionAccounts, eq(conditionAccounts.id, categorizationRules.account_id)).orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));
}
