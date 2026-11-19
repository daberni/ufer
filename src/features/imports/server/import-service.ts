import { z } from "zod";
import { parseBalancesCsv } from "@/lib/import";
import { requireWritableManualAccount, validateLiability } from "@/features/accounts/server/account-service";
import { saveImportedValuations } from "./import-repository";

const importInput = z.object({
  account_id: z.string(),
  csv: z.string().max(1_000_000)
});

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
