import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { accounts, categorizationRules, transactions } from "@/server/database/schema";
import type { Rule, RuleAssignment } from "@/lib/rules";
import { derivedTransactionType, type TransactionType } from "@/features/transactions/transaction-types";
import { refusable, type ManualEntryResult } from "./manual-transaction-repository";
import type { CategorizedEntry, ProviderDetails } from "./transaction-entry";
import { applyTransactionType, dissolveLink, enteredInUfer, findSubject, followImportedCorrections, releaseOutdatedLinks, type TransferTarget } from "./transfer-repository";

function providerColumns(provider: ProviderDetails = {}) {
  return {
    instructed_amount_minor: provider.instructedAmount ?? null,
    instructed_currency: provider.instructedCurrency ?? null,
    provider_payload: provider.payload ?? null
  };
}

/**
 * Inserts new entries and updates existing ones. `createdAt` replaces the database clock only for inserted rows; updates keep the original `created_at`.
 * Updates replace the provider data with the latest delivery for every row; only rule-sourced categories are recalculated. Payee and description overrides and hidden state are separate columns, so a delivery never undoes them.
 * The type is recalculated only while nobody corrected it, the booking is not linked and it is not a transfer: no source reports that a booking is not a transfer, so a delivery without a transfer signal never downgrades one. A booking entered in Ufer follows the corrected date and amount of the imported booking it is linked with; other links whose corrected amount or currency no longer pairs are released first.
 */
export async function upsertTransactions(tx: DatabaseTransaction, accountId: string, entries: CategorizedEntry[], createdAt?: string) {
  // Bound statement parameters for both local SQLite and remote libSQL deployments.
  for (let offset = 0; offset < entries.length; offset += 50) {
    const chunk = entries.slice(offset, offset + 50);

    await followImportedCorrections(tx, accountId, chunk);
    await releaseOutdatedLinks(tx, accountId, chunk);

    const values = chunk.map(entry => ({
      id: randomUUID(),
      account_id: accountId,
      provider_reference: entry.reference,
      booking_date: entry.date,
      amount_minor: entry.amount,
      currency: entry.currency,
      counterparty: entry.counterparty,
      description: entry.description,
      category_id: entry.categoryId,
      category_rule_id: entry.categoryRuleId,
      type: derivedTransactionType(entry.amount, entry.transfer),
      created_at: createdAt,
      ...providerColumns(entry.provider)
    }));

    await tx.insert(transactions).values(values).onConflictDoUpdate({
      target: [transactions.account_id, transactions.provider_reference],
      set: {
        booking_date: sql`excluded.booking_date`,
        amount_minor: sql`excluded.amount_minor`,
        currency: sql`excluded.currency`,
        counterparty: sql`excluded.counterparty`,
        description: sql`excluded.description`,
        instructed_amount_minor: sql`excluded.instructed_amount_minor`,
        instructed_currency: sql`excluded.instructed_currency`,
        provider_payload: sql`excluded.provider_payload`,
        category_id: sql`CASE WHEN ${transactions.category_source}='manual' THEN ${transactions.category_id} ELSE excluded.category_id END`,
        category_rule_id: sql`CASE WHEN ${transactions.category_source}='manual' THEN NULL ELSE excluded.category_rule_id END`,
        type: sql`CASE WHEN ${transactions.type_source}='manual' OR ${transactions.transfer_id} IS NOT NULL OR ${transactions.type}='transfer' THEN ${transactions.type} ELSE excluded.type END`
      }
    });
  }
}

export async function setTransactionCategory(id: string, categoryId: string | null) {
  const db = await database();
  const scopedAccounts = db.select({
    id: accounts.id
  }).from(accounts).where(eq(accounts.environment, environment()));
  const scope = and(eq(transactions.id, id), inArray(transactions.account_id, scopedAccounts));
  const [assignment] = await db.update(transactions).set({
    category_id: categoryId,
    category_source: "manual",
    category_rule_id: null
  }).where(scope).returning({
    id: transactions.id,
    category_id: transactions.category_id,
    category_source: transactions.category_source,
    category_rule_id: transactions.category_rule_id
  });

  return assignment;
}

/**
 * Returns a manual assignment to automatic categorization: the category and assigning rule come from the transaction's source text, as applying rules would assign them.
 * The rules and the transaction are read in the write transaction that stores the result. Resolves to undefined for a transaction outside the current environment.
 */
export async function returnTransactionToRules(id: string, assign: (rules: Rule[], counterparty: string, description: string) => RuleAssignment) {
  const db = await database();
  const scopedAccounts = db.select({
    id: accounts.id
  }).from(accounts).where(eq(accounts.environment, environment()));
  const scope = and(eq(transactions.id, id), inArray(transactions.account_id, scopedAccounts));

  return db.transaction(async tx => {
    const found = await tx.select({
      counterparty: transactions.counterparty,
      description: transactions.description
    }).from(transactions).where(scope).get();

    if (!found) {
      return undefined;
    }

    const rules = await tx.select().from(categorizationRules);
    const assignment = assign(rules, found.counterparty, found.description);
    const [saved] = await tx.update(transactions).set({
      category_id: assignment.categoryId,
      category_source: "rule",
      category_rule_id: assignment.ruleId
    }).where(scope).returning({
      id: transactions.id,
      category_id: transactions.category_id,
      category_source: transactions.category_source,
      category_rule_id: transactions.category_rule_id
    });

    return saved;
  });
}

/** A person's payee and description for an imported booking; undefined keeps a field's current text. */
export type TextOverrides = {
  counterparty?: string;
  description?: string;
};

// Text equal to the source's own clears the override, so the booking follows later syncs again.
function overrideOf(value: string | undefined, source: string) {
  if (value === undefined) {
    return undefined;
  }

  // The input arrives trimmed, so untouched source text with surrounding spaces must not become an override.
  return value === source.trim() ? null : value;
}

/**
 * Saves a booking's type, transfer target and, for an imported booking, payee and description overrides in one transaction.
 * The source's own text stays in `counterparty` and `description`, which syncs and imports keep refreshing; the date, amount and provider identity stay the source's.
 */
export async function saveTransactionDetails(id: string, type: TransactionType, target: TransferTarget | undefined, text: TextOverrides): Promise<ManualEntryResult> {
  return refusable(async tx => {
    const subject = await findSubject(tx, id);

    if (!subject) {
      return "not_found";
    }

    const changesText = text.counterparty !== undefined || text.description !== undefined;

    if (changesText && enteredInUfer(subject)) {
      return "entered";
    }

    const linksTarget = type === "transfer" && target !== undefined && target !== null;

    // Linking a hidden booking could create a visible counterpart for a booking that counts nowhere.
    if (linksTarget && await isHidden(tx, id)) {
      return "hidden";
    }

    if (changesText) {
      await tx.update(transactions).set({
        counterparty_override: overrideOf(text.counterparty, subject.counterparty),
        description_override: overrideOf(text.description, subject.description)
      }).where(eq(transactions.id, id));
    }

    return applyTransactionType(tx, id, type, target);
  });
}

async function isHidden(tx: DatabaseTransaction, id: string) {
  const booking = await tx.select({
    suppressed_at: transactions.suppressed_at
  }).from(transactions).where(eq(transactions.id, id)).get();

  return Boolean(booking?.suppressed_at);
}

/**
 * Hides an imported booking, or shows it again. A hidden booking stays stored, so the next sync or import updates it instead of adding it again; it no longer counts toward balances or reports and is not paired.
 * Hiding ends a transfer link: a counterpart Ufer created for it is removed and any other linked booking becomes income or expense again.
 */
export async function setTransactionHidden(id: string, hidden: boolean, at: string): Promise<ManualEntryResult> {
  return refusable(async tx => {
    const subject = await findSubject(tx, id);

    if (!subject) {
      return "not_found";
    }

    if (enteredInUfer(subject)) {
      return "entered";
    }

    if (hidden && subject.transfer_id) {
      await dissolveLink(tx, subject, booking => derivedTransactionType(booking.amount_minor));
    }

    await tx.update(transactions).set({
      suppressed_at: hidden ? at : null
    }).where(eq(transactions.id, id));

    return "saved";
  });
}
