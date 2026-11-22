import { HttpError } from "@/lib/errors";
import type { BankAccount } from "./enable-banking-client";

/** An existing account whose stored identifiers a bank account's identifiers match, with the connection it is linked to. */
export type IdentifierMatch = {
  account_id: string;
  requisition_id: string | null;
};

/** A bank account with the identifier and currency a mapping needs. */
export type MappableBankAccount = BankAccount & {
  identification_hash: string;
  uid: string;
  currency: string;
};

/** Refuses a bank account without a stable identifier or an unambiguous currency; its identifiers are the primary hash and every alternative one, once each. */
export function mappableBankAccount(account: BankAccount) {
  if (!account.identification_hash || !account.uid || !account.currency || account.currency === "XXX") {
    throw new HttpError(502, "Bank account is missing a stable identifier or an unambiguous currency.");
  }

  return {
    account: account as MappableBankAccount,
    hashes: [...new Set([account.identification_hash, ...(account.identification_hashes || [])])]
  };
}

/** The account mapping for a bank account's identifier matches. */
export type AccountMapping = {
  existing: false;
} | {
  existing: true;
  accountId: string;
  /** The other connection the account was linked to, which this connection displaces. */
  displaced: string | null;
};

/** A bank account maps to the one existing account its identifiers match, or to a new account; identifiers matching several accounts stop the mapping. */
export function decideAccountMapping(matches: IdentifierMatch[], requisitionId: string): AccountMapping {
  if (matches.length > 1) {
    throw new HttpError(409, "Bank identifiers match multiple existing accounts. Check the account mapping.");
  }

  const [match] = matches;

  if (!match) {
    return {
      existing: false
    };
  }

  return {
    existing: true,
    accountId: match.account_id,
    displaced: match.requisition_id && match.requisition_id !== requisitionId ? match.requisition_id : null
  };
}
