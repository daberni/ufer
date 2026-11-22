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

/** The manual account an authorization was started from. */
export type ConnectTarget = {
  id: string;
  currency: string;
  iban: string | null;
};

/** An authorized bank account with the existing accounts its identifiers match. */
export type IdentifiedBankAccount = {
  account: MappableBankAccount;
  matches: IdentifierMatch[];
};

function compactIban(iban: string | null | undefined) {
  return (iban || "").replace(/\s/g, "").toUpperCase();
}

/**
 * The index of the authorized bank account the target account connects to: the one its identifiers already name, else the only one in its currency that no other account owns, preferring an equal IBAN.
 * No candidate or several stop the connection, since guessing could sync another account's bookings into it.
 */
export function decideTargetBankAccount(target: ConnectTarget, bankAccounts: IdentifiedBankAccount[]) {
  const identified = bankAccounts.flatMap((item, index) => item.matches.some(match => match.account_id === target.id) ? [index] : []);

  // A second bank account naming the target would be mapped onto it as well and overwrite the chosen link.
  if (identified.length > 1) {
    throw new HttpError(422, "Several authorized bank accounts were connected to this account before. Connect again and authorize only this account at the bank.");
  }

  if (identified.length === 1) {
    const index = identified[0];

    if (bankAccounts[index].matches.some(match => match.account_id !== target.id)) {
      throw new HttpError(422, "The authorized bank account also belongs to another account in Ufer, so it cannot be connected to this one.");
    }

    return index;
  }

  const targetIban = compactIban(target.iban);

  // The bank account with the target's IBAN belongs to another account, so no other authorized account can stand in for it.
  if (targetIban && bankAccounts.some(item => item.matches.length > 0 && compactIban(item.account.account_id?.iban) === targetIban)) {
    throw new HttpError(422, "The authorized bank account with this account's IBAN already belongs to another account in Ufer.");
  }

  const free = bankAccounts.flatMap((item, index) => {
    const available = item.matches.length === 0 && item.account.currency === target.currency;
    const bankIban = compactIban(item.account.account_id?.iban);
    const ibanConflict = Boolean(targetIban && bankIban && targetIban !== bankIban);

    return available && !ibanConflict ? [{
      index,
      sameIban: Boolean(targetIban && bankIban === targetIban)
    }] : [];
  });
  const sameIban = free.filter(item => item.sameIban);
  const candidates = sameIban.length ? sameIban : free;

  if (candidates.length === 1) {
    return candidates[0].index;
  }

  if (!candidates.length) {
    throw new HttpError(422, "No authorized bank account can be this account: none has its currency and IBAN without already belonging to another account.");
  }

  throw new HttpError(422, "Several authorized bank accounts could be this account. Connect again and authorize only this account at the bank.");
}
