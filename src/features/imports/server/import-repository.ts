import { database } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { recordManualBalances } from "@/features/transactions/server/manual-transaction-repository";
import { upsertTransactions } from "@/features/transactions/server/transaction-repository";
import { pairTransfers } from "@/features/transactions/server/transfer-repository";
import type { CategorizedEntry } from "@/features/transactions/server/transaction-entry";

export async function saveImportedTransactions(accountId: string, entries: CategorizedEntry[]) {
  const db = await database();

  await db.transaction(async tx => {
    await upsertTransactions(tx, accountId, entries);
    await pairTransfers(tx, environment());
  });
}

/** Records each imported balance, oldest first, as the account's balance at the end of its date: an opening balance or an adjustment for the difference. Rows matching the balance book nothing, so importing a file again changes nothing. */
export async function saveImportedValuations(account: {
  id: string;
  currency: string;
}, entries: {
  date: string;
  amount: number;
}[]) {
  const db = await database();

  await db.transaction(async tx => {
    await recordManualBalances(tx, account, entries);
  });
}
