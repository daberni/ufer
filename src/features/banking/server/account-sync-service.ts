import { HttpError } from "@/lib/errors";
import type { Rule } from "@/features/categorization/server/rule-assignment";
import { categorizeEntries } from "@/features/categorization/server/rule-assignment";
import type { Entry } from "@/features/transactions/server/transaction-entry";
import { selectedBalance } from "./bank-data";
import { saveSyncedAccount, type SyncRunStart } from "./sync-repository";
import type { Balance } from "./enable-banking-client";

export async function saveAccountSync(run: SyncRunStart, accountId: string, currency: string, balances: Balance[], entries: Entry[], rules: Rule[]) {
  if (entries.some(entry => entry.currency !== currency)) {
    throw new HttpError(502, "The bank transaction currency does not match the account currency.");
  }

  const balance = selectedBalance(balances, currency);

  return saveSyncedAccount(run, accountId, balance, entries, stored => categorizeEntries(stored, rules, accountId));
}
