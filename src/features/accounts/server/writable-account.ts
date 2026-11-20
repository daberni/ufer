import { eq } from "drizzle-orm";
import type { DatabaseTransaction } from "@/server/database/connection";
import { accounts } from "@/server/database/schema";
import { HttpError } from "@/lib/errors";

export const archivedAccountMessage = "This account is archived. Restore the account first.";

/** Rechecks inside a write transaction that the account is not archived, since it may have been archived after the request's own check; throwing rolls the transaction back. */
export async function assertWritableAccount(tx: DatabaseTransaction, accountId: string) {
  const account = await tx.select({
    archived_at: accounts.archived_at
  }).from(accounts).where(eq(accounts.id, accountId)).get();

  if (account?.archived_at) {
    throw new HttpError(409, archivedAccountMessage);
  }
}
