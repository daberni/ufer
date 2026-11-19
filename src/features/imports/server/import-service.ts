import { z } from "zod";
import { parseBalancesCsv, parseTransactionsCsv } from "@/lib/import";
import { requireWritableManualAccount } from "@/features/accounts/server/account-service";
import { validateLiability } from "@/features/accounts/server/account-service";
import { listRules } from "@/features/categorization/server/rule-repository";
import { saveImportedTransactions, saveImportedValuations } from "./import-repository";
import { categorizeEntries } from "@/features/transactions/server/categorize-entries";

const importInput = z.object({
  account_id: z.string(),
  csv: z.string().max(1_000_000)
});

export async function importTransactions(payload: unknown) {
  const input = importInput.parse(payload);
  const account = await requireImportAccount(input.account_id);
  const entries = parseTransactionsCsv(input.csv, account.currency);
  const rules = await listRules();

  await saveImportedTransactions(input.account_id, categorizeEntries(entries, rules));

  return {
    processed: entries.length,
    message: "Transactions imported. They count toward the account balance."
  };
}

export async function importValuations(payload: unknown) {
  const input = importInput.parse(payload);
  const account = await requireImportAccount(input.account_id);
  const entries = parseBalancesCsv(input.csv, account.currency);

  for (const entry of entries) {
    validateLiability(account.kind, entry.amount);
  }

  await saveImportedValuations(account, entries);

  return {
    processed: entries.length,
    message: "Balances imported. Differences to the account balance were booked as adjustments."
  };
}

async function requireImportAccount(accountId: string) {
  return requireWritableManualAccount(accountId, "CSV import requires a manual account.");
}
