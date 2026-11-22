import { sql } from "drizzle-orm";
import { securityTrades, transactions } from "@/server/database/schema";

// The cash side of a security trade belongs to the trade (ADR 012): its type, amount, date, visibility and links change only through the trade.
export const tradeLeg = sql<number>`EXISTS(SELECT 1 FROM ${securityTrades} WHERE ${securityTrades.settlement_transaction_id}=${transactions.id})`.mapWith(Number);

export const notTradeLeg = sql`NOT ${tradeLeg}`;
