import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { syncLease, withLease } from "@/server/jobs/lease";
import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { timestamp, today } from "@/lib/time";
import { accountDeletionInput, accountEditInput, accountInput, archiveInput, valuationInput } from "./account-schema";
import { archiveIfSettled, archiveSettledAccount, deleteUnlinkedAccount, findManualAccount, insertManualAccount, readBookedTotal, readLatestReportedBalance, refuse, saveAccountArchived, saveAccountKind, saveAccountName, withAccountTransaction, withRefusableAccountTransaction } from "./account-repository";
import { decideClosing, decideReconciliation } from "./account-decisions";
import { comparableBankBalanceTypes, findAccountWithBalance } from "./account-queries";
import { archivedAccountMessage, assertWritableAccount, assertWritableManualAccount } from "@/features/transactions/server/booking-accounts";
import { bookManualEntry, recordManualBalance, type ManualEntryResult } from "@/features/transactions/server/manual-transaction-repository";
import type { AccountKind } from "../account-kinds";
import { currentFormatLocale } from "@/server/http/request-locale";
import { holdsSecurities } from "@/features/securities/server/security-service";
import { formatCount } from "@/lib/locale";
import { dateWithYear } from "@/lib/date-format";

export async function createManualAccount(payload: unknown, now = Temporal.Now.instant()) {
  const input = accountInput.parse(payload);
  const amount = minorUnits(input.balance, input.currency);
  const date = input.date ?? today(now).toString();

  validateLiability(input.kind, amount);
  validateBalanceDate(date, now);

  const id = randomUUID();

  await withAccountTransaction(async tx => {
    await insertManualAccount(tx, id, input);
    await recordManualBalance(tx, {
      id,
      currency: input.currency
    }, date, amount);
  });

  return {
    id
  };
}

export async function updateManualValuation(accountId: string, payload: unknown, now = Temporal.Now.instant()) {
  const input = valuationInput.parse(payload);
  const account = await requireWritableManualAccount(accountId, "Manual account not found.");

  const amount = minorUnits(input.balance, account.currency);

  validateLiability(account.kind, amount);
  validateBalanceDate(input.date, now);

  await withAccountTransaction(async tx => {
    await assertWritableManualAccount(tx, account.id);
    await recordManualBalance(tx, account, input.date, amount);
  });

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

  await withLease(syncLease, "A sync is running. Reconcile the balance after it has finished.", async () => {
    const reconciled = await withAccountTransaction(async tx => {
      await assertWritableAccount(tx, account.id);
      const reported = await readLatestReportedBalance(tx, account.id);
      // The report may already contain bookings dated after it, as the shown difference allows; then nothing is off.
      const decision = decideReconciliation(reported, (await readBookedTotal(tx, account.id)).amount, comparableBankBalanceTypes);

      if (decision === "adjust" && reported) {
        await recordManualBalance(tx, account, reported.date, reported.amount);
      }

      return decision !== "not_reported";
    });

    if (!reconciled) {
      throw new HttpError(409, "The bank has not reported a booked balance to compare with yet.");
    }
  });

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

type ClosingResult = ManualEntryResult | "balance_changed";

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

/**
 * Books a manual account's remaining balance away on the closing date and archives it in one transaction: as an adjustment, or as a transfer to another active manual account.
 * The closing carries the balance the user confirmed; a concurrent booking that changed it refuses the closing.
 */
async function closeAccount(account: {
  id: string;
  currency: string;
}, closing: {
  balance_minor: number;
  date: string;
  transfer_account_id: string | null;
}, archivedAt: string) {
  const result = await withRefusableAccountTransaction<ClosingResult | {
    lastBooking: string;
  }>(async tx => {
    await assertWritableManualAccount(tx, account.id);
    const decision = decideClosing(await readBookedTotal(tx, account.id), closing.balance_minor, closing.date, closing.transfer_account_id !== null);

    if (decision.refused === "balance_changed") {
      return refuse(decision.refused);
    }

    if (decision.refused === "before_last_booking") {
      return refuse({
        lastBooking: decision.lastBooking
      });
    }

    const booked = await bookManualEntry(tx, randomUUID(), {
      accountId: account.id,
      currency: account.currency,
      date: closing.date,
      amount: decision.amount,
      counterparty: "",
      description: "Account closed",
      categoryId: null,
      categorySource: "manual",
      categoryRuleId: null,
      type: decision.type,
      target: closing.transfer_account_id ? {
        accountId: closing.transfer_account_id
      } : undefined
    });

    if (booked !== "saved") {
      return refuse(booked);
    }

    // A concurrent booking leaves a balance other than 0, which refuses the closing and rolls back its booking.
    if (!await archiveIfSettled(tx, account.id, archivedAt)) {
      return refuse("balance_changed");
    }

    return "saved";
  });

  if (typeof result === "object") {
    throw new ValidationError(`Choose a date on or after the last booking (${dateWithYear(Temporal.PlainDate.from(result.lastBooking), await currentFormatLocale())}).`);
  }

  return result;
}

// A bank sync may be writing a new balance; archiving waits until it has finished.
async function archiveSettled(account: {
  id: string;
  kind: string;
  provider: string
}) {
  // A brokerage account has no bookings; it is settled once it holds no securities. Trades take the sync lease, so archiving waits for them.
  if (account.kind === "brokerage") {
    return whileNoSync("Archive the account", () => withAccountTransaction(async tx => {
      if (await holdsSecurities(tx, account.id)) {
        throw new HttpError(409, "Sell every holding before archiving the brokerage account.");
      }

      return archiveIfSettled(tx, account.id, timestamp());
    }));
  }

  if (account.provider === "manual") {
    // A bank connection may have linked the account since the request's own check.
    return withAccountTransaction(async tx => {
      await assertWritableManualAccount(tx, account.id);

      return archiveIfSettled(tx, account.id, timestamp());
    });
  }

  return whileNoSync("Archive the account", () => archiveSettledAccount(account.id, timestamp()));
}

/** Runs a change to a bank account while no sync can write to it. */
async function whileNoSync<Result>(action: string, change: () => Promise<Result>) {
  return withLease(syncLease, `A sync is running. ${action} after it has finished.`, change);
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
async function requireWritableManualAccount(accountId: string, notFound: string) {
  const account = await findManualAccount(accountId);

  if (!account) {
    throw new HttpError(404, notFound);
  }

  if (account.archived_at !== null) {
    throw new HttpError(409, archivedAccountMessage);
  }

  return account;
}
