import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { transactions } from "@/server/database/schema";
import type { Rule, RuleAssignment, RuleText } from "@/lib/rules";
import { derivedTransactionType, type TransactionType } from "@/features/transactions/transaction-types";
import { refusable, type ManualEntryResult } from "./manual-transaction-repository";
import { assignRuleDecision, dissolveSplit, dropSplitsOnCurrencyChange, notSplit, splitRefusesType } from "./split-repository";
import type { CategorizedEntry, Entry, ProviderDetails } from "./transaction-entry";
import { applyTransactionType, dissolveLink, enteredInUfer, findSubject, followImportedCorrections, pairTransfers, releaseOutdatedLinks, touchesArchivedAccount, type TransferTarget } from "./transfer-repository";

function providerColumns(provider: ProviderDetails = {}) {
  return {
    instructed_amount_minor: provider.instructedAmount ?? null,
    instructed_currency: provider.instructedCurrency ?? null,
    provider_payload: provider.payload ?? null
  };
}

// Bounds the bound parameters of each override lookup for both local SQLite and remote libSQL deployments.
const overrideChunkSize = 500;

/** Attaches the stored payee and description overrides of the rows these entries update, so rules decide them on the person's text too. */
export async function withStoredOverrides<Delivered extends Entry>(tx: DatabaseTransaction, accountId: string, entries: Delivered[]) {
  const overrides = new Map<string, Pick<RuleText, "counterparty_override" | "description_override">>();

  for (let offset = 0; offset < entries.length; offset += overrideChunkSize) {
    const references = entries.slice(offset, offset + overrideChunkSize).map(entry => entry.reference);
    const rows = await tx.select({
      reference: transactions.provider_reference,
      counterparty_override: transactions.counterparty_override,
      description_override: transactions.description_override
    }).from(transactions).where(and(eq(transactions.account_id, accountId), inArray(transactions.provider_reference, references), sql`(${transactions.counterparty_override} IS NOT NULL OR ${transactions.description_override} IS NOT NULL)`));

    for (const row of rows) {
      overrides.set(String(row.reference), {
        counterparty_override: row.counterparty_override,
        description_override: row.description_override
      });
    }
  }

  return entries.map(entry => ({
    ...entry,
    ...overrides.get(entry.reference)
  }));
}

// A stored type a delivery keeps: corrected, linked, or a detected transfer that neither the stored nor the delivered type came from a rule.
const keepsType = sql`${transactions.type_source}='manual' OR ${transactions.transfer_id} IS NOT NULL OR NOT ${notSplit} OR (${transactions.type}='transfer' AND ${transactions.type_rule_id} IS NULL AND excluded.type_rule_id IS NULL)`;

/**
 * Inserts new entries and updates existing ones. `createdAt` replaces the database clock only for inserted rows; updates keep the original `created_at`.
 * Updates replace the provider data with the latest delivery for every row; only rule-sourced categories are recalculated. Payee and description overrides and hidden state are separate columns, so a delivery never undoes them.
 * The type is recalculated only while nobody corrected it, the booking is not linked and it is not split; a rule's type takes precedence over the derived one. Without a rule, a detected transfer stays a transfer: no source reports that a booking is not a transfer, so a delivery without a transfer signal never downgrades one. A split booking keeps its type; a changed currency removes its split, whose parts were amounts in the old currency. A booking entered in Ufer follows the corrected date and amount of the imported booking it is linked with; other links whose corrected amount or currency no longer pairs are released first.
 */
export async function upsertTransactions(tx: DatabaseTransaction, accountId: string, entries: CategorizedEntry[], createdAt?: string) {
  // Bound statement parameters for both local SQLite and remote libSQL deployments.
  for (let offset = 0; offset < entries.length; offset += 50) {
    const chunk = entries.slice(offset, offset + 50);

    await dropSplitsOnCurrencyChange(tx, accountId, chunk);
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
      type: entry.ruleType ?? derivedTransactionType(entry.amount, entry.transfer),
      type_rule_id: entry.typeRuleId,
      type_transfer_account_id: entry.typeTransferAccountId,
      transfer_detected: entry.transfer ? 1 : 0,
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
        type: sql`CASE WHEN ${keepsType} THEN ${transactions.type} ELSE excluded.type END`,
        // A kept or rule-set type keeps an earlier transfer signal for when the rule stops deciding; a type derived from this delivery takes the delivery's signal.
        transfer_detected: sql`CASE WHEN ${keepsType} OR excluded.type_rule_id IS NOT NULL THEN max(${transactions.transfer_detected},excluded.transfer_detected) ELSE excluded.transfer_detected END`,
        type_rule_id: sql`CASE WHEN ${keepsType} THEN ${transactions.type_rule_id} ELSE excluded.type_rule_id END`,
        type_transfer_account_id: sql`CASE WHEN ${keepsType} THEN ${transactions.type_transfer_account_id} ELSE excluded.type_transfer_account_id END`
      }
    });
  }
}

/** Assigns a category manually; archiving freezes balances but not categories, so bookings on archived accounts take one too. */
export async function setTransactionCategory(id: string, categoryId: string | null) {
  const db = await database();
  const scope = and(eq(transactions.id, id), notSplit);
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
 * Returns a manual assignment to automatic categorization: the category, assigning rule and, for an automatic, unlinked booking, the rule's type and transfer account come from the transaction's source and overridden text, as applying rules would assign them.
 * The rules and the transaction are read in the write transaction that stores the result. Resolves to undefined for an unknown transaction; a booking on an archived account takes only the category, since its type stays frozen.
 */
export async function returnTransactionToRules(id: string, assign: (rules: Rule[], text: RuleText) => RuleAssignment) {
  const db = await database();

  return db.transaction(async tx => {
    // A split booking keeps its categories in its parts.
    const returnable = await tx.select({
      id: transactions.id
    }).from(transactions).where(and(eq(transactions.id, id), notSplit)).get();

    if (!returnable) {
      return undefined;
    }

    // The same decision as applying rules: category, and for an automatic, unlinked booking the rule's type and transfer account, then pairing.
    await assignRuleDecision(tx, id, assign);
    await pairTransfers(tx);

    return tx.select({
      id: transactions.id,
      category_id: transactions.category_id,
      category_source: transactions.category_source,
      category_rule_id: transactions.category_rule_id
    }).from(transactions).where(eq(transactions.id, id)).get();
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
export async function saveTransactionDetails(
  id: string,
  type: TransactionType,
  target: TransferTarget | undefined,
  text: TextOverrides,
  dropSplit?: (rules: Rule[], text: RuleText) => RuleAssignment
): Promise<ManualEntryResult> {
  return refusable(async tx => {
    const subject = await findSubject(tx, id);

    if (!subject) {
      return "not_found";
    }

    // Archiving freezes balances, not the payee, description or categories; `applyTransactionType` allows only balance-neutral link changes.
    const keepsType = type === subject.type && target === undefined;
    const frozen = await touchesArchivedAccount(tx, subject);

    // Removing the split in the same write transaction lets it take a type a split booking refuses; a refused save keeps the split.
    const dissolved = dropSplit ? await dissolveSplit(tx, id, dropSplit) : false;

    if (await splitRefusesType(tx, id, type)) {
      return "split";
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

    // The rules decide the former split's category from the text as saved here, overrides included.
    if (dropSplit && dissolved) {
      await assignRuleDecision(tx, id, dropSplit);
    }

    if (frozen && keepsType) {
      return "saved";
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

    // On an archived account hiding may not change a balance: a manual account's balance sums its shown bookings, and hiding a linked booking ends the link.
    if (await touchesArchivedAccount(tx, subject) && (subject.account_provider === "manual" || subject.transfer_id)) {
      return "archived_account";
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
