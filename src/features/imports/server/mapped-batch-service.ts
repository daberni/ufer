import { assertWritableAccount } from "@/features/transactions/server/booking-accounts";
import type { DatabaseTransaction } from "@/server/database/connection";
import { withTransaction } from "@/server/database/transaction";
import { findDuplicates } from "./duplicate-matching";
import { createImportCategory, findCandidateBookings, insertEntries, insertImportAccount, keepOpeningBeforeImported, readOpeningOthers, saveOpeningBalance, updateSourceFields, type MappedEntry, type NewImportAccount, type NewImportCategory, type OpeningBalance } from "./mapped-import-repository";
import { openingBookingAmount } from "./opening-balance-decisions";
import { describeMatches, planRows, type Decision } from "./row-decisions";

async function classify(accountId: string, entries: MappedEntry[], consumed: ReadonlySet<string>, decisions: ReadonlyMap<number, Decision>, tx?: DatabaseTransaction) {
  const existing = await findCandidateBookings(accountId, entries, tx);
  const expected = new Map([...decisions].flatMap(([index, decision]) => decision.action !== "create" && decision.booking ? [[index, decision.booking] as const] : []));
  const created = new Set([...decisions].flatMap(([index, decision]) => decision.action === "create" ? [index] : []));

  return findDuplicates(entries, existing, consumed, expected, created);
}

/** Classifies rows against the account's bookings and plans the person's decisions without writing anything. */
export async function checkMappedEntries(accountId: string, entries: MappedEntry[], consumed: ReadonlySet<string>, decisions: ReadonlyMap<number, Decision> = new Map()) {
  const found = await classify(accountId, entries, consumed, decisions);
  const plan = planRows(entries, found, decisions);

  return {
    duplicates: found.duplicates,
    possible: found.possible,
    matched: [...found.matched.filter(booking => !plan.released.has(booking.reference)), ...plan.adopted],
    ...matchesOf(entries, found),
    undecided: plan.undecided,
    updated: plan.updates.map(update => update.index),
    inserted: plan.inserts.length
  };
}

/** The rows of one target account in a confirmed batch. */
export type MappedAccountRows = {
  accountId: string;
  entries: MappedEntry[];
  newAccount: NewImportAccount | null;
  consumed?: ReadonlySet<string>;
  opening?: OpeningBalance | null;
  /** The person's decisions for matched and possibly duplicate rows, by index in `entries`. */
  decisions?: ReadonlyMap<number, Decision>;
};

/**
 * Saves a confirmed batch for all its target accounts in one write transaction, so a failure leaves none of its accounts, bookings or categories behind.
 * New categories are created in the same transaction, and only when a saved row uses one. Results are in the order of `accounts`.
 */
export async function saveMappedBatch(accountRows: MappedAccountRows[], newCategories: NewImportCategory[]) {
  return withTransaction(async tx => {
    const pending = new Map(newCategories.map(category => [category.id, category]));
    const resolved = new Map<string, string>();
    const createdCategories: string[] = [];
    const ensureCategories = async (entries: MappedEntry[]) => {
      const used = entries.flatMap(entry => [entry.categoryId, ...(entry.parts ?? []).map(part => part.categoryId)]);

      for (const id of new Set(used)) {
        const category = id === null ? undefined : pending.get(id);

        if (!category || resolved.has(category.id)) {
          continue;
        }

        const result = await createImportCategory(tx, category);

        resolved.set(category.id, result.id);

        // A category another request created meanwhile is used, not reported as new.
        if (result.created) {
          createdCategories.push(category.name);
        }
      }

      const categoryOf = (id: string | null) => id === null ? null : resolved.get(id) ?? id;

      return entries.map(entry => ({
        ...entry,
        categoryId: categoryOf(entry.categoryId),
        parts: entry.parts?.map(part => ({
          ...part,
          categoryId: categoryOf(part.categoryId)
        })) ?? null
      }));
    };
    const results = [];

    for (const rows of accountRows) {
      results.push(await saveAccountRows(tx, rows, ensureCategories));
    }

    return {
      results,
      createdCategories
    };
  });
}

/**
 * Classifies rows exactly like `checkMappedEntries`, but inside the write transaction, and inserts the new ones, so a bank sync between check and confirmation cannot cause duplicates and both report the same result on unchanged data.
 * Matched rows update only their booking's source fields as the person decided, so confirming again changes nothing and existing categories survive. Older bookings imported into a bank-linked account move its opening balance before them.
 */
async function saveAccountRows(tx: DatabaseTransaction, {
  accountId,
  entries,
  newAccount,
  consumed = new Set(),
  opening = null,
  decisions = new Map()
}: MappedAccountRows, ensureCategories: (entries: MappedEntry[]) => Promise<MappedEntry[]>) {
  if (newAccount) {
    // Its balance is the sum of its transactions, including any opening balance.
    await insertImportAccount(tx, accountId, newAccount);
  }

  await assertWritableAccount(tx, accountId);
  const found = await classify(accountId, entries, consumed, decisions, tx);
  const plan = planRows(entries, found, decisions);
  const fresh = await ensureCategories(plan.inserts.map(index => entries[index]));
  // Later batches of this import pass the saved rows back as consumed, so rows of the same file never match each other by content.
  const saved = await insertEntries(tx, accountId, fresh);

  for (const update of plan.updates) {
    await updateSourceFields(tx, accountId, update.reference, entries[update.index], update.changes.includes("type"));
  }

  await keepOpeningBeforeImported(tx, accountId, saved.map(row => row.id));

  if (opening) {
    // Every confirmed batch recalculates it, so after the last batch a `current` balance equals the account balance today.
    const amount = openingBookingAmount(opening, await readOpeningOthers(tx, accountId, opening.id));

    await saveOpeningBalance(tx, accountId, newAccount?.currency ?? entries[0]?.currency ?? "", opening, amount);
  }

  return {
    duplicates: found.duplicates,
    possible: found.possible,
    matched: [...found.matched.filter(booking => !plan.released.has(booking.reference)), ...plan.adopted, ...saved.map(row => ({
      reference: row.reference,
      date: row.date
    }))],
    ...matchesOf(entries, found),
    undecided: plan.undecided,
    updated: plan.updates.map(update => update.index),
    inserted: saved.length
  };
}

function matchesOf(entries: MappedEntry[], found: Parameters<typeof describeMatches>[1]) {
  const {
    described,
    bookings
  } = describeMatches(entries, found);

  return {
    matches: described,
    bookings
  };
}
