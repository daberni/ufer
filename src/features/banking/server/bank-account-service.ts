import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/errors";
import { withTransaction } from "@/server/database/transaction";
import { decideAccountMapping, mappableBankAccount } from "./bank-account-mapping";
import { findIdentifierMatches, insertBankAccount, markConnectionLinked, relinkAccount, saveIdentifiers, supersedeEmptyConnections } from "./bank-account-repository";
import type { BankAccount } from "./enable-banking-client";

// Maps the authorized accounts and links the connection in one transaction; a connection removed meanwhile is never linked.
export async function saveSessionAccounts(requisitionId: string, institution: string, validUntil: string, bankAccounts: BankAccount[]) {
  return withTransaction(async tx => {
    const displacedConnections = new Set<string>();

    for (const bankAccount of bankAccounts) {
      const {
        account,
        hashes
      } = mappableBankAccount(bankAccount);
      const mapping = decideAccountMapping(await findIdentifierMatches(tx, hashes), requisitionId);
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
