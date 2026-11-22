import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { transactions } from "@/server/database/schema";
import { HttpError } from "@/lib/errors";
import { assertWritableManualAccount } from "./booking-accounts";
import type { TransactionType } from "@/lib/transaction-types";
import type { RuleAssignment, RuleText } from "@/features/categorization/server/rule-assignment";
import { createdCounterpartPrefix, manualEntryPrefix } from "@/lib/booking-references";
import { applyTransactionType } from "./transaction-type-change";
import { dissolveLink } from "./transfer-link-repository";
import { enteredInUfer, enteredPair } from "./transfer-rules";
import { findCounterpart, findSubject, touchesArchivedAccount } from "./transfer-subjects";
import type { TransferTarget, TypeChangeResult } from "./type-change-decision";
import { decideManualBalance } from "./manual-balance-decision";
import { dissolveSplit, splitMatchesAmount, splitRefusesType, writeSplit, type SplitChange } from "./split-repository";

/** The fields a person enters for a booking on a manual account. */
export type ManualEntry = {
  date: string;
  amount: number;
  counterparty: string;
  description: string;
  type: TransactionType;
  /** Where a transfer goes; undefined keeps the current link. */
  target?: TransferTarget;
};

export type NewManualEntry = ManualEntry & {
  accountId: string;
  currency: string;
  categoryId: string | null;
  categorySource: "rule" | "manual";
  categoryRuleId: string | null;
};

export type ManualEntryResult = TypeChangeResult | "not_entered" | "follows_import" | "entered" | "hidden" | "split" | "split_mismatch";

/** Thrown inside a write transaction to roll it back and report why a change was refused. */
class Refused extends TransactionRollbackError {
  constructor(readonly result: ManualEntryResult) {
    super();
  }
}

export async function refusable(write: (tx: DatabaseTransaction) => Promise<ManualEntryResult>): Promise<ManualEntryResult> {
  const db = await database();

  try {
    return await db.transaction(async tx => {
      const result = await write(tx);

      if (result !== "saved") {
        throw new Refused(result);
      }

      return result;
    });
  } catch (error) {
    if (error instanceof Refused) {
      return error.result;
    }

    throw error;
  }
}

function manualEntryValues(id: string, entry: NewManualEntry): typeof transactions.$inferInsert {
  return {
    id,
    account_id: entry.accountId,
    provider_reference: `${manualEntryPrefix}${id}`,
    date: entry.date,
    amount_minor: entry.amount,
    currency: entry.currency,
    counterparty: entry.counterparty,
    description: entry.description,
    category_id: entry.categoryId,
    category_source: entry.categorySource,
    category_rule_id: entry.categoryRuleId,
    type: entry.type,
    type_source: "manual"
  };
}

async function insertEntry(tx: DatabaseTransaction, id: string, entry: NewManualEntry) {
  await tx.insert(transactions).values(manualEntryValues(id, entry));
}

/** Enters a booking within the caller's transaction and, for a transfer, creates or links its other side; the caller rolls back unless the result is "saved". */
export async function bookManualEntry(tx: DatabaseTransaction, id: string, entry: NewManualEntry) {
  await insertEntry(tx, id, entry);

  return applyTransactionType(tx, id, entry.type, entry.target);
}

/** Enters a booking on a manual account and, for a transfer, creates or links its other side in the same transaction. */
export async function createManualTransaction(entry: NewManualEntry) {
  const id = randomUUID();
  const result = await refusable(async tx => {
    await assertWritableManualAccount(tx, entry.accountId);

    return bookManualEntry(tx, id, entry);
  });

  return {
    result,
    id
  };
}

/** The currency of a booking entered in Ufer; undefined for an unknown booking. */
/** The currency of a booking and whether its account is bank-linked, whose syncs also write its opening balance. */
export async function findEntryAccount(id: string) {
  const db = await database();
  const subject = await findSubject(db, id);

  return subject ? {
    currency: subject.currency,
    bankLinked: subject.account_provider !== "manual"
  } : undefined;
}

/**
 * Saves an entered booking's date, amount, payee, description and type together.
 * The other side of an entered pair mirrors the date, the opposite amount and the description; a booking linked with an imported booking keeps that booking's date and amount.
 */
/** The caller chose whether to hold the sync lease from the account's earlier state; a bank connection linking it since then would let a sync write alongside this change. */
function assertLinkUnchanged(subject: {
  account_provider: string
}, bankLinked: boolean) {
  if ((subject.account_provider !== "manual") !== bankLinked) {
    throw new HttpError(409, "This account was connected to a bank meanwhile. Try the change again.");
  }
}

export async function updateManualTransaction(
  id: string,
  entry: ManualEntry,
  categoryFor: (text: RuleText) => RuleAssignment,
  bankLinked: boolean,
  splitChange?: SplitChange
) {
  return refusable(async tx => {
    const subject = await findSubject(tx, id);

    if (!subject) {
      return "not_found";
    }

    assertLinkUnchanged(subject, bankLinked);

    if (await touchesArchivedAccount(tx, subject)) {
      return "archived_account";
    }

    if (!enteredInUfer(subject)) {
      return "not_entered";
    }

    if (subject.trade_leg) {
      return "trade_leg";
    }

    // Removing the split in the same write transaction lets it take a type a split booking refuses; a refused save keeps the split.
    if (splitChange && "remove" in splitChange) {
      await dissolveSplit(tx, id, splitChange.remove);
    }

    if (await splitRefusesType(tx, id, entry.type)) {
      return "split";
    }

    const counterpart = await findCounterpart(tx, subject);
    const pairedWith = counterpart && enteredPair(subject, counterpart) ? counterpart : undefined;

    if (counterpart && !pairedWith) {
      if (subject.provider_reference.startsWith(createdCounterpartPrefix)) {
        return "not_entered";
      }

      if (entry.date !== subject.date || entry.amount !== subject.amount_minor) {
        return "follows_import";
      }
    }

    if (pairedWith && entry.type === "transfer" && entry.amount === 0) {
      return "zero_amount";
    }

    const fields = {
      date: entry.date,
      amount_minor: entry.amount,
      counterparty: entry.counterparty,
      description: entry.description
    };

    if (pairedWith) {
      // The unique transfer-side index would reject a sign change while both sides still share the link, so the other side is detached until both are updated.
      await tx.update(transactions).set({
        transfer_id: null
      }).where(eq(transactions.id, pairedWith.id));
      await tx.update(transactions).set(fields).where(eq(transactions.id, subject.id));
      await tx.update(transactions).set({
        date: entry.date,
        amount_minor: -entry.amount,
        description: entry.description,
        transfer_id: subject.transfer_id
      }).where(eq(transactions.id, pairedWith.id));
    } else {
      await tx.update(transactions).set(fields).where(eq(transactions.id, subject.id));
    }

    const result = await applyTransactionType(tx, id, entry.type, entry.target);

    if (result !== "saved") {
      return result;
    }

    const saved = await findSubject(tx, id);
    const other = saved ? await findCounterpart(tx, saved) : undefined;

    await reapplyRuleCategory(tx, id, categoryFor);

    if (saved && other && enteredPair(saved, other)) {
      await reapplyRuleCategory(tx, other.id, categoryFor);
    }

    // New parts are validated against the amount saved above; kept parts must still add up to it.
    if (splitChange && "replace" in splitChange) {
      await writeSplit(tx, id, splitChange.replace);
    } else if (!(await splitMatchesAmount(tx, id))) {
      return "split_mismatch";
    }

    return "saved";
  });
}

/** Rechecks final mirrored fields under the edit's write lock; explicit manual assignments, including null, stay untouched. */
async function reapplyRuleCategory(tx: DatabaseTransaction, id: string, categoryFor: (text: RuleText) => RuleAssignment) {
  const automatic = and(eq(transactions.id, id), eq(transactions.category_source, "rule"));
  const booking = await tx.select({
    account_id: transactions.account_id,
    counterparty: transactions.counterparty,
    description: transactions.description,
    counterparty_override: transactions.counterparty_override,
    description_override: transactions.description_override
  }).from(transactions).where(automatic).get();

  if (!booking) {
    return;
  }

  const assignment = categoryFor(booking);

  await tx.update(transactions).set({
    category_id: assignment.categoryId,
    category_rule_id: assignment.ruleId
  }).where(automatic);
}

/**
 * Deletes a booking entered in Ufer. Both sides of an entered pair are one movement and are deleted together; an imported booking it was linked with stays as a transfer without a counterpart.
 */
export async function deleteManualTransaction(id: string, bankLinked: boolean) {
  return refusable(async tx => {
    const subject = await findSubject(tx, id);

    if (!subject) {
      return "not_found";
    }

    assertLinkUnchanged(subject, bankLinked);

    if (await touchesArchivedAccount(tx, subject)) {
      return "archived_account";
    }

    if (!enteredInUfer(subject)) {
      return "not_entered";
    }

    if (subject.trade_leg) {
      return "trade_leg";
    }

    const counterpart = await findCounterpart(tx, subject);

    if (counterpart && enteredPair(subject, counterpart)) {
      await tx.delete(transactions).where(eq(transactions.id, counterpart.id));
    } else if (counterpart) {
      await dissolveLink(tx, subject);
    }

    await tx.delete(transactions).where(eq(transactions.id, subject.id));

    return "saved";
  });
}

/**
 * Records `amount` as a manual account's balance at the end of `date`. An account without transactions gets it as its opening balance; otherwise an adjustment books the difference to the balance on that date, so later transactions keep their effect. No difference books nothing.
 * Returns the booked type, or null when nothing was booked.
 */
export async function recordManualBalance(tx: DatabaseTransaction, account: {
  id: string;
  currency: string;
}, date: string, amount: number): Promise<"opening_balance" | "adjustment" | null> {
  const booked = await tx.select({
    count: sql<number>`COUNT(*)`,
    onDate: sql<number>`COALESCE(SUM(CASE WHEN ${lte(transactions.date, date)} THEN ${transactions.amount_minor} ELSE 0 END),0)`
  }).from(transactions).where(and(eq(transactions.account_id, account.id), isNull(transactions.suppressed_at))).get();
  const booking = decideManualBalance({
    count: Number(booked?.count ?? 0),
    onDate: Number(booked?.onDate ?? 0)
  }, amount);

  if (!booking) {
    return null;
  }

  await insertEntry(tx, randomUUID(), {
    accountId: account.id,
    date,
    amount: booking.amount,
    currency: account.currency,
    counterparty: "",
    description: "",
    categoryId: null,
    categorySource: "manual",
    categoryRuleId: null,
    type: booking.type
  });

  return booking.type;
}
