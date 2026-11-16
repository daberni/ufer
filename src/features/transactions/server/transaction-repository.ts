import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { accounts, transactions } from "@/server/database/schema";
import type { CategorizedEntry, ProviderDetails } from "./transaction-entry";

function providerColumns(provider: ProviderDetails = {}) {
  return {
    value_date: provider.valueDate ?? null,
    transaction_date: provider.transactionDate ?? null,
    bank_transaction_code: provider.bankTransactionCode ?? null,
    bank_transaction_sub_code: provider.bankTransactionSubCode ?? null,
    bank_transaction_description: provider.bankTransactionDescription ?? null,
    merchant_category_code: provider.merchantCategoryCode ?? null,
    exchange_rate: provider.exchangeRate ?? null,
    exchange_rate_unit_currency: provider.exchangeRateUnitCurrency ?? null,
    exchange_rate_type: provider.exchangeRateType ?? null,
    instructed_amount_minor: provider.instructedAmount ?? null,
    instructed_currency: provider.instructedCurrency ?? null,
    balance_after_minor: provider.balanceAfter ?? null,
    balance_after_currency: provider.balanceAfterCurrency ?? null,
    reference_number: provider.referenceNumber ?? null,
    counterparty_iban: provider.counterpartyIban ?? null,
    counterparty_account_id: provider.counterpartyAccountId ?? null,
    counterparty_account_scheme: provider.counterpartyAccountScheme ?? null,
    counterparty_bic: provider.counterpartyBic ?? null,
    provider_payload: provider.payload ?? null
  };
}

const refreshedProviderColumns = {
  value_date: sql`excluded.value_date`,
  transaction_date: sql`excluded.transaction_date`,
  bank_transaction_code: sql`excluded.bank_transaction_code`,
  bank_transaction_sub_code: sql`excluded.bank_transaction_sub_code`,
  bank_transaction_description: sql`excluded.bank_transaction_description`,
  merchant_category_code: sql`excluded.merchant_category_code`,
  exchange_rate: sql`excluded.exchange_rate`,
  exchange_rate_unit_currency: sql`excluded.exchange_rate_unit_currency`,
  exchange_rate_type: sql`excluded.exchange_rate_type`,
  instructed_amount_minor: sql`excluded.instructed_amount_minor`,
  instructed_currency: sql`excluded.instructed_currency`,
  balance_after_minor: sql`excluded.balance_after_minor`,
  balance_after_currency: sql`excluded.balance_after_currency`,
  reference_number: sql`excluded.reference_number`,
  counterparty_iban: sql`excluded.counterparty_iban`,
  counterparty_account_id: sql`excluded.counterparty_account_id`,
  counterparty_account_scheme: sql`excluded.counterparty_account_scheme`,
  counterparty_bic: sql`excluded.counterparty_bic`,
  provider_payload: sql`excluded.provider_payload`
};

/**
 * Inserts new entries and updates existing ones. `createdAt` replaces the database clock only for inserted rows; updates keep the original `created_at`.
 * Updates replace the provider details with the latest delivery for every row; only rule-sourced categories are recalculated.
 */
export async function upsertTransactions(tx: DatabaseTransaction, accountId: string, entries: CategorizedEntry[], createdAt?: string) {
  // Stay below SQLite's conservative limit of 999 bound parameters (30 per row) for local SQLite and remote libSQL.
  for (let offset = 0; offset < entries.length; offset += 25) {
    const values = entries.slice(offset, offset + 25).map(entry => ({
      id: randomUUID(),
      account_id: accountId,
      provider_reference: entry.reference,
      booking_date: entry.date,
      amount_minor: entry.amount,
      currency: entry.currency,
      counterparty: entry.counterparty,
      description: entry.description,
      category_id: entry.categoryId,
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
        ...refreshedProviderColumns,
        category_id: sql`CASE WHEN ${transactions.category_source}='manual' THEN ${transactions.category_id} ELSE excluded.category_id END`
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
    category_source: "manual"
  }).where(scope).returning({
    id: transactions.id,
    category_id: transactions.category_id,
    category_source: transactions.category_source
  });

  return assignment;
}
