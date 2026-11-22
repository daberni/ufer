import type { accounts, balanceSnapshots, categories, categorizationRules, securities, securityPrices, securitySplits, securityTrades, transactions } from "./schema";

export type Account = typeof accounts.$inferSelect;

export type NewAccount = typeof accounts.$inferInsert;

export type BalanceSnapshot = typeof balanceSnapshots.$inferSelect;

export type Category = typeof categories.$inferSelect;

export type CategorizationRule = typeof categorizationRules.$inferSelect;

export type Transaction = typeof transactions.$inferSelect;

export type Security = typeof securities.$inferSelect;

export type SecurityPrice = typeof securityPrices.$inferSelect;

export type SecuritySplit = typeof securitySplits.$inferSelect;

export type SecurityTrade = typeof securityTrades.$inferSelect;
