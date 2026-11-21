import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { acquireLease, releaseLease } from "@/server/jobs/lease-repository";
import { syncLeaseName } from "@/features/banking/server/sync-service";
import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { timestamp, today } from "@/lib/time";
import { accountDeletionInput, accountEditInput, accountInput, archiveInput, valuationInput } from "./account-schema";
import { ClosingBeforeLastBooking, archiveSettledAccount, closeAndArchiveManualAccount, convertDetachedAccount, deleteUnlinkedAccount, findManualAccount, insertManualAccount, reconcileWithReportedBalance, saveAccountArchived, saveAccountKind, saveAccountName, saveManualValuation, type ClosingResult } from "./account-repository";
import { findAccountWithBalance } from "./account-queries";
import { archivedAccountMessage } from "./writable-account";
import type { AccountKind } from "../account-kinds";
import { currentFormatLocale } from "@/server/http/request-locale";
import { formatCount } from "@/lib/locale";
import { dateWithYear } from "@/lib/date-format";

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

/** Books an adjustment so a bank-linked account's balance matches the newest booked balance its bank reported. A sync may be writing a new report, so this waits for it to finish. */
export async function reconcileBankBalance(accountId: string) {
  const account = await findAccountWithBalance(accountId);

  if (!account || account.provider === "manual") {
    throw new HttpError(404, "Bank account not found.");
  }

  if (account.archived_at !== null) {
    throw new HttpError(409, archivedAccountMessage);
  }

  const owner = randomUUID();

  if (!(await acquireLease(syncLeaseName, owner))) {
    throw new HttpError(409, "A sync is running. Reconcile the balance after it has finished.");
  }

  try {
    if (!await reconcileWithReportedBalance(account)) {
      throw new HttpError(409, "The bank has not reported a booked balance to compare with yet.");
    }
  } finally {
    await releaseLease(syncLeaseName, owner);
  }

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


/** Saves an account's name and, for a manual or imported account, its type; a bank-synced account keeps the type from its bank connection. */
export async function updateAccount(accountId: string, payload: unknown) {
  const result = accountEditInput.safeParse(payload);

  if (!result.success) {
    const locale = await currentFormatLocale();
    const message = result.error.issues.some(issue => issue.path[0] === "kind") ? "Choose a valid account type." : `Enter an account name between ${formatCount(1, locale)} and ${formatCount(100, locale)} characters.`;

    throw new ValidationError(message);
  }

  const input = result.data;
  const account = await findAccountWithBalance(accountId);

  if (!account) {
    throw new HttpError(404, "Account not found.");
  }

  if (input.kind !== undefined && input.kind !== account.kind) {
    await changeAccountKind(account, input.kind);
  }

  await saveAccountName(accountId, input.name);

  return {
    ok: true
  };
}

async function changeAccountKind(account: {
  id: string;
  provider: string;
  archived_at: string | null;
  balance_minor: number | null;
}, kind: AccountKind) {
  if (account.provider !== "manual") {
    throw new HttpError(409, "A bank-synced account keeps the type from its bank connection.");
  }

  if (account.archived_at !== null) {
    throw new HttpError(409, archivedAccountMessage);
  }

  if (kind === "loan" && (account.balance_minor ?? 0) > 0) {
    throw new ValidationError("A loan's balance is the debt still owed and cannot be positive. Update the balance to a negative amount first.");
  }

  if (!await saveAccountKind(account.id, kind)) {
    throw new HttpError(409, "The account changed meanwhile. Review it and try again.");
  }
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

  // The balance is the sum of the bookings, so it is 0 without any.
  const balance = account.balance_minor ?? 0;

  // A closing confirms the balance the user saw; any other current balance needs a new confirmation.
  const confirmedOther = input.closing !== undefined && input.closing.balance_minor !== balance;

  if (balance === 0) {
    if (confirmedOther) {
      throw new HttpError(409, closingFailures.balance_changed!);
    }

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

  if (confirmedOther) {
    throw new HttpError(409, closingFailures.balance_changed!);
  }

  validateBalanceDate(input.closing.date, now);
  const result = await closeAccount(account, input.closing, timestamp(now));

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

async function closeAccount(account: Parameters<typeof closeAndArchiveManualAccount>[0], closing: {
  balance_minor: number;
  date: string;
  transfer_account_id: string | null;
}, archivedAt: string) {
  try {
    return await closeAndArchiveManualAccount(account, closing.balance_minor, closing.date, closing.transfer_account_id, archivedAt);
  } catch (error) {
    if (error instanceof ClosingBeforeLastBooking) {
      throw new ValidationError(`Choose a date on or after the last booking (${dateWithYear(Temporal.PlainDate.from(error.lastBooking), await currentFormatLocale())}).`);
    }

    throw error;
  }
}

// A bank sync may be writing a new balance; archiving waits until it has finished.
async function archiveSettled(account: {
  id: string;
  provider: string
}) {
  if (account.provider === "manual") {
    return archiveSettledAccount(account.id, timestamp());
  }

  return whileNoSync("Archive the account", () => archiveSettledAccount(account.id, timestamp()));
}

/** Runs a change to a bank account while no sync can write to it. */
async function whileNoSync<Result>(action: string, change: () => Promise<Result>) {
  const owner = randomUUID();

  if (!(await acquireLease(syncLeaseName, owner))) {
    throw new HttpError(409, `A sync is running. ${action} after it has finished.`);
  }

  try {
    return await change();
  } finally {
    await releaseLease(syncLeaseName, owner);
  }
}

/** Makes a bank account whose connection was removed a manual account that keeps its history and its last bank balance; balance updates, entries and type changes then work as for any manual account. */
export async function convertToManualAccount(accountId: string) {
  const account = await findAccountWithBalance(accountId);

  if (!account) {
    throw new HttpError(404, "Account not found.");
  }

  if (account.provider === "manual") {
    return {
      ok: true
    };
  }

  if (account.requisition_id !== null) {
    throw new HttpError(409, "Disconnect the bank before converting this account to a manual account.");
  }

  if (!await whileNoSync("Convert the account", () => convertDetachedAccount(accountId))) {
    throw new HttpError(409, "The account changed meanwhile. Review it and try again.");
  }

  return {
    ok: true
  };
}

/**
 * Permanently deletes an account that is not linked to a bank, with its bookings and balance history; the request repeats the account's name as confirmation.
 * Reports then leave the account out, while linked bookings on other accounts keep their amounts as transfers without a counterpart.
 */
export async function deleteAccount(accountId: string, payload: unknown) {
  const input = accountDeletionInput.parse(payload);
  const account = await findAccountWithBalance(accountId);

  if (!account) {
    throw new HttpError(404, "Account not found.");
  }

  if (input.name !== account.name) {
    throw new ValidationError("Enter the account's name to confirm the deletion.");
  }

  if (account.requisition_id !== null) {
    throw new HttpError(409, "Disconnect the bank before deleting this account; a sync would otherwise restore it.");
  }

  const deleted = account.provider === "manual" ? await deleteUnlinkedAccount(accountId, input.name) : await whileNoSync("Delete the account", () => deleteUnlinkedAccount(accountId, input.name));

  if (!deleted) {
    throw new HttpError(409, "The account changed meanwhile. Review it and try again.");
  }

  return {
    ok: true
  };
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
    throw new HttpError(409, archivedAccountMessage);
  }

  return account;
}
