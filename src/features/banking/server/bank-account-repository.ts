import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, notExists } from "drizzle-orm";
import { HttpError } from "@/lib/errors";
import type { Database } from "@/server/database/connection";
import { accountIdentifiers, accounts, requisitions } from "@/server/database/schema";
import type { BankAccount } from "./enable-banking-client";

// Maps the authorized accounts and links the connection in one transaction; a connection removed meanwhile is never linked.
export async function saveSessionAccounts(db: Database, environment: string, requisitionId: string, institution: string, bankAccounts: BankAccount[]) {
  return db.transaction(async tx => {
    const displacedConnections = new Set<string>();

    for (const account of bankAccounts) {
      if (!account.identification_hash || !account.uid || !account.currency || account.currency === "XXX") {
        throw new HttpError(502, "Bank account is missing a stable identifier or an unambiguous currency.");
      }

      const hashes = [...new Set([account.identification_hash, ...(account.identification_hashes || [])])];
      const scope = and(eq(accountIdentifiers.environment, environment), inArray(accountIdentifiers.identification_hash, hashes));
      const matches = await tx.selectDistinct({
        account_id: accountIdentifiers.account_id,
        requisition_id: accounts.requisition_id
      }).from(accountIdentifiers).innerJoin(accounts, eq(accounts.id, accountIdentifiers.account_id)).where(scope);

      if (matches.length > 1) {
        throw new HttpError(409, "Bank identifiers match multiple existing accounts. Check the account mapping.");
      }

      const id = matches[0]?.account_id || randomUUID();
      const iban = account.account_id?.iban;

      if (matches.length) {
        const accountScope = and(eq(accounts.id, id), eq(accounts.environment, environment), eq(accounts.currency, account.currency));
        const saved = await tx.update(accounts).set({
          provider_uid: account.uid,
          requisition_id: requisitionId,
          ...(iban ? {
            iban
          } : {}),
          sync_error: null
        }).where(accountScope).returning({
          id: accounts.id
        });

        if (!saved.length) {
          throw new HttpError(409, "The account currency or environment has changed; automatic mapping stopped.");
        }

        if (matches[0].requisition_id && matches[0].requisition_id !== requisitionId) {
          displacedConnections.add(matches[0].requisition_id);
        }
      } else {
        await tx.insert(accounts).values({
          id,
          environment,
          name: account.name || account.product || institution,
          institution,
          kind: "checking",
          currency: account.currency,
          provider: "enable_banking",
          provider_uid: account.uid,
          requisition_id: requisitionId,
          iban: iban || null
        });
      }

      await tx.insert(accountIdentifiers).values(hashes.map(identification => ({
        environment,
        identification_hash: identification,
        account_id: id
      }))).onConflictDoNothing();
    }

    const linked = await tx.update(requisitions).set({
      status: "LINKED"
    }).where(and(eq(requisitions.id, requisitionId), eq(requisitions.environment, environment), eq(requisitions.status, "EXCHANGING"))).returning({
      id: requisitions.id
    });

    if (!linked.length) {
      throw new HttpError(409, "The bank connection was removed during authorization.");
    }

    if (!displacedConnections.size) {
      return [];
    }

    const linkedAccounts = tx.select({
      id: accounts.id
    }).from(accounts).where(eq(accounts.requisition_id, requisitions.id));
    const superseded = and(eq(requisitions.environment, environment), eq(requisitions.status, "LINKED"), inArray(requisitions.id, [...displacedConnections]), ne(requisitions.id, requisitionId), notExists(linkedAccounts));

    return tx.update(requisitions).set({
      status: "SUPERSEDED"
    }).where(superseded).returning({
      id: requisitions.id,
      session_cipher: requisitions.session_cipher
    });
  });
}
