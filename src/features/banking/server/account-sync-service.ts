import { HttpError } from "@/lib/errors";
import type { Rule } from "@/lib/rules";
import type { Database } from "@/server/database/connection";
import { categorizeEntries } from "@/features/transactions/server/categorize-entries";
import type { Entry } from "@/features/transactions/server/transaction-entry";
import { selectedBalance } from "./bank-data";
import { saveSyncedAccount } from "./sync-repository";
import type { Balance } from "./enable-banking-client";

export async function saveAccountSync(db: Database, accountId: string, currency: string, balances: Balance[], entries: Entry[], rules: Rule[]) {
  if (entries.some(entry => entry.currency !== currency)) {
    throw new HttpError(502, "The bank transaction currency does not match the account currency.");
  }

  const balance = selectedBalance(balances, currency);
  const categorized = categorizeEntries(entries, rules);

  return saveSyncedAccount(db, accountId, balance, categorized);
}
