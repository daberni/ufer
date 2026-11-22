import { and, eq, isNull } from "drizzle-orm";
import { transactions } from "@/server/database/schema";
import { notSplit } from "./split-repository";

/** A booking whose type rules may set: neither a person nor a link decided it. Split bookings keep their type; rules never set it. */
export const ruleTypeable = and(eq(transactions.type_source, "auto"), isNull(transactions.transfer_id), notSplit);
