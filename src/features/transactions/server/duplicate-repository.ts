import { and, asc, eq, sql } from "drizzle-orm";
import { database, type Database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts, transactions } from "@/server/database/schema";
import { derivedTransactionType } from "@/lib/transaction-types";
import { notSplit } from "./split-repository";
import { duplicateCandidate } from "./duplicate-rules";
import { dissolveLink } from "./transfer-link-repository";
import { enteredInUfer } from "./transfer-rules";
import { findSubject, touchesArchivedAccount } from "./transfer-subjects";

type Executor = Database | DatabaseTransaction;

const copyColumns = {
  id: transactions.id,
  account_id: transactions.account_id,
  account_provider: accounts.provider,
  provider_reference: transactions.provider_reference,
  date: transactions.date,
  amount_minor: transactions.amount_minor,
  currency: transactions.currency,
  type: transactions.type,
  counterparty: sql<string>`COALESCE(${transactions.counterparty_override},${transactions.counterparty})`,
  description: sql<string>`COALESCE(${transactions.description_override},${transactions.description})`,
  category_id: transactions.category_id,
  category_source: transactions.category_source,
  suppressed_at: transactions.suppressed_at,
  split: sql<number>`NOT ${notSplit}`
};

/** One copy of a booking as duplicate resolution compares it: the text as shown, its category and whether it can be hidden. */
export type Copy = NonNullable<Awaited<ReturnType<typeof findCopy>>>;

async function findCopy(executor: Executor, id: string) {
  return executor.select(copyColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(eq(transactions.id, id)).get();
}

/** The imported, shown bookings a person can name `id` a duplicate of, nearest date first; undefined for an unknown booking. */
export async function readDuplicateCandidates(id: string) {
  const db = await database();
  const subject = await findCopy(db, id);

  if (!subject) {
    return undefined;
  }

  const rows = await db.select(copyColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(duplicateCandidate(subject)).orderBy(sql`abs(julianday(${transactions.date})-julianday(${subject.date}))`, asc(transactions.date), asc(transactions.id)).all();

  return {
    subject,
    candidates: rows.filter(row => !enteredInUfer(row))
  };
}

/** Which copy stays, which is hidden, and the category the kept copy takes over; undefined keeps its category. */
export type DuplicateDecision = {
  kept: Copy;
  hidden: Copy;
  category: string | null | undefined;
};

export type DuplicateResult = "saved" | "not_found" | "not_a_candidate" | "entered" | "hidden" | "split" | "archived_account";

/**
 * Resolves `id` as a duplicate of `originalId`: `decide` picks the copy that stays, the other is hidden with a record of the kept booking, and the kept booking may take over a manual category.
 * Both copies are read and checked in the write transaction; hiding a linked copy ends its link as hiding it by hand does.
 */
export async function resolveDuplicate(id: string, originalId: string, at: string, decide: (subject: Copy, original: Copy) => DuplicateDecision): Promise<DuplicateResult> {
  const db = await database();

  return db.transaction(async tx => {
    const subject = await findCopy(tx, id);
    const original = await findCopy(tx, originalId);

    if (!subject || !original) {
      return "not_found";
    }

    if (enteredInUfer(subject) || enteredInUfer(original)) {
      return "entered";
    }

    if (subject.suppressed_at || original.suppressed_at) {
      return "hidden";
    }

    const candidate = await tx.select({
      id: transactions.id
    }).from(transactions).where(and(eq(transactions.id, originalId), duplicateCandidate(subject))).get();

    if (!candidate) {
      return "not_a_candidate";
    }

    const decision = decide(subject, original);

    // A split copy holds categories in its parts, which hiding it would drop from reports.
    if (decision.hidden.split) {
      return "split";
    }

    const hidden = await findSubject(tx, decision.hidden.id);

    if (!hidden) {
      return "not_found";
    }

    if (await touchesArchivedAccount(tx, hidden)) {
      return "archived_account";
    }

    if (hidden.transfer_id) {
      await dissolveLink(tx, hidden, booking => derivedTransactionType(booking.amount_minor));
    }

    await tx.update(transactions).set({
      suppressed_at: at,
      duplicate_of_id: decision.kept.id
    }).where(eq(transactions.id, decision.hidden.id));

    if (decision.category !== undefined && !decision.kept.split) {
      await tx.update(transactions).set({
        category_id: decision.category,
        category_source: "manual",
        category_rule_id: null
      }).where(eq(transactions.id, decision.kept.id));
    }

    return "saved";
  });
}
