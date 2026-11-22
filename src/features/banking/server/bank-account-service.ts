import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/errors";
import { withTransaction } from "@/server/database/transaction";
import { decideAccountMapping, decideTargetBankAccount, mappableBankAccount, type AccountMapping } from "./bank-account-mapping";
import { findConnectTarget, findIdentifierMatches, insertBankAccount, markConnectionLinked, relinkAccount, saveIdentifiers, supersedeEmptyConnections } from "./bank-account-repository";
import type { BankAccount } from "./enable-banking-client";

// Maps the authorized accounts and links the connection in one transaction; a connection removed meanwhile is never linked.
// An authorization started from a manual account connects that account to one authorized bank account; the others map by their identifiers.
export async function saveSessionAccounts(requisitionId: string, institution: string, validUntil: string, bankAccounts: BankAccount[], targetAccountId: string | null = null) {
  return withTransaction(async tx => {
    const displacedConnections = new Set<string>();
    const identified = [];

    for (const bankAccount of bankAccounts) {
      const {
        account,
        hashes
      } = mappableBankAccount(bankAccount);

      identified.push({
        account,
        hashes,
        matches: await findIdentifierMatches(tx, hashes)
      });
    }

    let targetIndex = -1;

    if (targetAccountId) {
      const target = await findConnectTarget(tx, targetAccountId);

      if (!target) {
        throw new HttpError(422, "The account to connect is no longer an active manual account.");
      }

      targetIndex = decideTargetBankAccount(target, identified);
    }

    for (const [index, {
      account,
      hashes
    }] of identified.entries()) {
      // Matches are read again per account so that identifiers saved for an earlier account of this callback count.
      const mapping: AccountMapping = index === targetIndex ? {
        existing: true,
        accountId: targetAccountId as string,
        displaced: null
      } : decideAccountMapping(await findIdentifierMatches(tx, hashes), requisitionId);
      let accountId: string;

      if (mapping.existing) {
        accountId = mapping.accountId;

        if (!(await relinkAccount(tx, accountId, requisitionId, account))) {
          throw new HttpError(409, "The account currency has changed; automatic mapping stopped.");
        }

        if (mapping.displaced) {
          displacedConnections.add(mapping.displaced);
        }
      } else {
        accountId = randomUUID();
        await insertBankAccount(tx, accountId, requisitionId, institution, account);
      }

      await saveIdentifiers(tx, accountId, hashes);
    }

    if (!(await markConnectionLinked(tx, requisitionId, validUntil))) {
      throw new HttpError(409, "The bank connection was removed during authorization.");
    }

    if (!displacedConnections.size) {
      return [];
    }

    return supersedeEmptyConnections(tx, [...displacedConnections], requisitionId);
  });
}
