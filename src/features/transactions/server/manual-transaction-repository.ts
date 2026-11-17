import { randomUUID } from "node:crypto";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { transactions } from "@/server/database/schema";
import type { TransactionType } from "@/features/transactions/transaction-types";
import { applyTransactionType, createdCounterpartPrefix, dissolveLink, enteredInUfer, enteredPair, findCounterpart, findSubject, manualEntryPrefix, type TransferTarget, type TypeChangeResult } from "./transfer-repository";

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
};

export type ManualEntryResult = TypeChangeResult | "not_entered" | "follows_import";

/** Thrown inside a write transaction to roll it back and report why a change was refused. */
class Refused extends TransactionRollbackError {
  constructor(readonly result: ManualEntryResult) {
    super();
  }
}

async function refusable(write: (tx: DatabaseTransaction) => Promise<ManualEntryResult>): Promise<ManualEntryResult> {
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
    booking_date: entry.date,
    amount_minor: entry.amount,
    currency: entry.currency,
    counterparty: entry.counterparty,
    description: entry.description,
    category_id: entry.categoryId,
    category_source: entry.categorySource,
    type: entry.type,
    type_source: "manual"
  };
}

async function insertEntry(tx: DatabaseTransaction, id: string, entry: NewManualEntry) {
  await tx.insert(transactions).values(manualEntryValues(id, entry));
}

/** Enters a booking on a manual account and, for a transfer, creates or links its other side in the same transaction. */
export async function createManualTransaction(entry: NewManualEntry) {
  const id = randomUUID();
  const result = await refusable(async tx => {
    await insertEntry(tx, id, entry);

    return applyTransactionType(tx, id, entry.type, entry.target);
  });

  return {
    result,
    id
  };
}

/** The currency of a booking entered in Ufer; undefined for an unknown booking. */
export async function findEntryCurrency(id: string) {
  const db = await database();

  return (await findSubject(db, id))?.currency;
}

/**
 * Saves an entered booking's date, amount, payee, description and type together.
 * The other side of an entered pair mirrors the date, the opposite amount and the description; a booking linked with an imported booking keeps that booking's date and amount.
 */
export async function updateManualTransaction(id: string, entry: ManualEntry, categoryFor: (counterparty: string, description: string) => string | null) {
  return refusable(async tx => {
    const subject = await findSubject(tx, id);

    if (!subject) {
      return "not_found";
    }

    if (!enteredInUfer(subject)) {
      return "not_entered";
    }

    const counterpart = await findCounterpart(tx, subject);
    const pairedWith = counterpart && enteredPair(subject, counterpart) ? counterpart : undefined;

    if (counterpart && !pairedWith) {
      if (subject.provider_reference.startsWith(createdCounterpartPrefix)) {
        return "not_entered";
      }

      if (entry.date !== subject.booking_date || entry.amount !== subject.amount_minor) {
        return "follows_import";
      }
    }

    if (pairedWith && entry.type === "transfer" && entry.amount === 0) {
      return "zero_amount";
    }

    const fields = {
      booking_date: entry.date,
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
        booking_date: entry.date,
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

    return "saved";
  });
}

/** Rechecks final mirrored fields under the edit's write lock; explicit manual assignments, including null, stay untouched. */
async function reapplyRuleCategory(tx: DatabaseTransaction, id: string, categoryFor: (counterparty: string, description: string) => string | null) {
  const automatic = and(eq(transactions.id, id), eq(transactions.category_source, "rule"));
  const booking = await tx.select({
    counterparty: transactions.counterparty,
    description: transactions.description
  }).from(transactions).where(automatic).get();

  if (!booking) {
    return;
  }

  await tx.update(transactions).set({
    category_id: categoryFor(booking.counterparty, booking.description)
  }).where(automatic);
}

/**
 * Deletes a booking entered in Ufer. Both sides of an entered pair are one movement and are deleted together; an imported booking it was linked with stays as a transfer without a counterpart.
 */
export async function deleteManualTransaction(id: string) {
  return refusable(async tx => {
    const subject = await findSubject(tx, id);

    if (!subject) {
      return "not_found";
    }

    if (!enteredInUfer(subject)) {
      return "not_entered";
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
    onDate: sql<number>`COALESCE(SUM(CASE WHEN ${lte(transactions.booking_date, date)} THEN ${transactions.amount_minor} ELSE 0 END),0)`
  }).from(transactions).where(eq(transactions.account_id, account.id)).get();
  const opening = Number(booked?.count ?? 0) === 0;
  const difference = amount - Number(booked?.onDate ?? 0);

  if (!opening && difference === 0) {
    return null;
  }

  const type = opening ? "opening_balance" : "adjustment";

  await insertEntry(tx, randomUUID(), {
    accountId: account.id,
    date,
    amount: opening ? amount : difference,
    currency: account.currency,
    counterparty: "",
    description: "",
    categoryId: null,
    categorySource: "manual",
    type
  });

  return type;
}


/** Plans chronological balance corrections from one ledger read, then inserts bounded batches within the caller's write transaction. */
export async function recordManualBalances(tx: DatabaseTransaction, account: {
  id: string;
  currency: string;
}, balances: {
  date: string;
  amount: number;
}[]) {
  if (!balances.length) {
    return;
  }

  const ledger = await tx.select({
    date: transactions.booking_date,
    amount: sql<number>`SUM(${transactions.amount_minor})`.mapWith(Number)
  }).from(transactions).where(eq(transactions.account_id, account.id)).groupBy(transactions.booking_date).orderBy(asc(transactions.booking_date));
  const values: (typeof transactions.$inferInsert)[] = [];
  let ledgerIndex = 0;
  let bookedBalance = 0;
  let previousAdjustments = 0;
  let hasTransactions = ledger.length > 0;

  for (const balance of balances) {
    while (ledgerIndex < ledger.length && ledger[ledgerIndex].date <= balance.date) {
      bookedBalance += ledger[ledgerIndex].amount;
      ledgerIndex++;
    }

    const difference = balance.amount - bookedBalance - previousAdjustments;

    if (hasTransactions && difference === 0) {
      continue;
    }

    values.push(manualEntryValues(randomUUID(), {
      accountId: account.id,
      date: balance.date,
      amount: difference,
      currency: account.currency,
      counterparty: "",
      description: "",
      categoryId: null,
      categorySource: "manual",
      type: hasTransactions ? "adjustment" : "opening_balance"
    }));
    previousAdjustments += difference;
    hasTransactions = true;
  }

  // Fifty rows keep each multi-value statement below SQLite/libSQL parameter limits.
  const batchSize = 50;

  for (let offset = 0; offset < values.length; offset += batchSize) {
    await tx.insert(transactions).values(values.slice(offset, offset + batchSize));
  }
}
