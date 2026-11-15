import type { accounts, balanceSnapshots, categories, categorizationRules, transactions } from "./schema";

export type Account = typeof accounts.$inferSelect;

export type NewAccount = typeof accounts.$inferInsert;

export type BalanceSnapshot = typeof balanceSnapshots.$inferSelect;

export type Category = typeof categories.$inferSelect;

export type CategorizationRule = typeof categorizationRules.$inferSelect;

export type Transaction = typeof transactions.$inferSelect;
