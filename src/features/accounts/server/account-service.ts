import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { database } from "@/server/database/connection";
import { acquireLease, releaseLease } from "@/server/jobs/lease-repository";
import { environment } from "@/features/banking/server/environment";
import { syncLeaseName } from "@/features/banking/server/sync-service";
import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { timestamp, today } from "@/lib/time";
import { accountInput, accountRenameInput, archiveInput, valuationInput } from "./account-schema";
import { archiveSettledAccount, closeAndArchiveManualAccount, findManualAccount, insertManualAccount, saveAccountArchived, saveAccountName, saveManualValuation, type ClosingResult } from "./account-repository";
import { findAccountWithBalance } from "./account-queries";

export async function createManualAccount(payload: unknown, now = Temporal.Now.instant()) {
  const input = accountInput.parse(payload);
  const amount = minorUnits(input.balance, input.currency);
  const date = input.date ?? today(now).toString();

  validateLiability(input.kind, amount);
  validateBalanceDate(date, now);

  return insertManualAccount(input, amount, date);
}

export async function updateManualValuation(accountId: string, payload: unknown, now = Temporal.Now.instant()) {
  const input = valuationInput.parse(payload);
  const account = await requireWritableManualAccount(accountId, "Manual account not found.");

  const amount = minorUnits(input.balance, account.currency);

  validateLiability(account.kind, amount);
  validateBalanceDate(input.date, now);

  await saveManualValuation(account, amount, input.date);

  return {
    ok: true
  };
}

function validateBalanceDate(date: string, now: Temporal.Instant) {
  if (Temporal.PlainDate.compare(Temporal.PlainDate.from(date), today(now)) > 0) {
    throw new ValidationError("The balance date cannot be in the future.");
  }
}

export function validateLiability(kind: string, amount: number) {
  if (kind === "loan" && amount > 0) {
    throw new ValidationError("Enter outstanding debt as a negative balance.");
  }
}


export async function renameAccount(accountId: string, payload: unknown) {
  const result = accountRenameInput.safeParse(payload);

  if (!result.success) {
    throw new ValidationError("Enter an account name between 1 and 100 characters.");
  }

  if (!await saveAccountName(accountId, result.data.name)) {
    throw new HttpError(404, "Account not found.");
  }

  return {
    ok: true
  };
}

const closingFailures: Partial<Record<ClosingResult, string>> = {
  account_not_found: "Choose another active manual account to transfer the balance to.",
  same_account: "Choose another account to transfer the balance to.",
  currency_mismatch: "The transfer account must use the same currency.",
  balance_changed: "The balance changed meanwhile. Review it and try again."
};

/** Archives an account whose balance is 0; a manual account can first book its remaining balance away. Archived accounts are hidden from lists and pickers and keep their history. */
export async function archiveAccount(accountId: string, payload: unknown, now = Temporal.Now.instant()) {
  const input = archiveInput.parse(payload);
  const account = await findAccountWithBalance(accountId);

  if (!account) {
    throw new HttpError(404, "Account not found.");
  }

  if (account.archived_at !== null) {
    return {
      ok: true
    };
  }

  // A manual account's balance is the sum of its bookings, so it is 0 without any; only a provider balance can be unknown.
  const balance = account.provider === "manual" ? account.balance_minor ?? 0 : account.balance_minor;

  if (balance === null) {
    throw new HttpError(409, "No balance is known yet. An account can only be archived with a balance of 0.");
  }

  if (balance === 0) {
    if (!await archiveSettled(account)) {
      throw new HttpError(409, closingFailures.balance_changed!);
    }

    return {
      ok: true
    };
  }

  if (!input.closing || account.provider !== "manual") {
    throw new HttpError(409, "Bring the balance to 0 before archiving.");
  }

  validateBalanceDate(input.closing.date, now);
  const result = await closeAndArchiveManualAccount(account, balance, input.closing.date, input.closing.transfer_account_id, timestamp(now));

  if (result === "balance_changed") {
    throw new HttpError(409, closingFailures.balance_changed!);
  }

  if (result !== "saved") {
    throw new ValidationError(closingFailures[result] ?? "The remaining balance could not be booked.");
  }

  return {
    ok: true
  };
}

// A bank sync may be writing a new balance; archiving waits until it has finished.
async function archiveSettled(account: {
  id: string;
  provider: string
}) {
  if (account.provider === "manual") {
    return archiveSettledAccount(await database(), account.id, timestamp());
  }

  const db = await database();
  const owner = randomUUID();
  const leaseName = syncLeaseName(environment());

  if (!(await acquireLease(db, leaseName, owner))) {
    throw new HttpError(409, "A sync is running. Archive the account after it has finished.");
  }

  try {
    return await archiveSettledAccount(db, account.id, timestamp());
  } finally {
    await releaseLease(db, leaseName, owner);
  }
}

/** Shows an archived account again with its unchanged history. */
export async function restoreAccount(accountId: string) {
  if (!await saveAccountArchived(accountId, null)) {
    throw new HttpError(404, "Account not found.");
  }

  return {
    ok: true
  };
}

/** A manual account that accepts new bookings; an archived account is read-only until it is restored. */
export async function requireWritableManualAccount(accountId: string, notFound: string) {
  const account = await findManualAccount(accountId);

  if (!account) {
    throw new HttpError(404, notFound);
  }

  if (account.archived_at !== null) {
    throw new HttpError(409, "This account is archived. Restore the account first.");
  }

  return account;
}
