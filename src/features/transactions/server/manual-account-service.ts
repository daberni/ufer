import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { syncLease, withLease } from "@/server/jobs/lease";
import { refuse, withAccountBookingTransaction, withRefusableAccountBookingTransaction } from "./account-booking-repository";
import { currentFormatLocale } from "@/server/http/request-locale";
import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { timestamp, today } from "@/lib/time";
import { dateWithYear } from "@/lib/date-format";
import { accountInput, archiveInput, valuationInput } from "@/features/accounts/server/account-schema";
import { archiveIfSettled, archiveSettledAccount, insertManualAccount, readBookedTotal, readLatestReportedBalance } from "@/features/accounts/server/account-repository";
import { comparableBankBalanceTypes, findAccountWithBalance } from "@/features/accounts/server/account-queries";
import { requireWritableManualAccount, validateBalanceDate, validateLiability } from "@/features/accounts/server/account-service";
import { archivedAccountMessage, assertWritableAccount } from "@/features/accounts/server/writable-account";
import { decideClosing, decideReconciliation } from "./manual-account-decisions";
import { bookManualEntry, recordManualBalance, type ManualEntryResult } from "./manual-transaction-repository";

/** Creates a manual account with its starting balance as the opening balance transaction, in one transaction. */
export async function createManualAccount(payload: unknown, now = Temporal.Now.instant()) {
  const input = accountInput.parse(payload);
  const amount = minorUnits(input.balance, input.currency);
  const date = input.date ?? today(now).toString();

  validateLiability(input.kind, amount);
  validateBalanceDate(date, now);

  const id = randomUUID();

  await withAccountBookingTransaction(async tx => {
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

/** Records a manual account's balance on a date as an opening balance or an adjustment for the difference. */
export async function updateManualValuation(accountId: string, payload: unknown, now = Temporal.Now.instant()) {
  const input = valuationInput.parse(payload);
  const account = await requireWritableManualAccount(accountId, "Manual account not found.");

  const amount = minorUnits(input.balance, account.currency);

  validateLiability(account.kind, amount);
  validateBalanceDate(input.date, now);

  await withAccountBookingTransaction(async tx => {
    await assertWritableAccount(tx, account.id);
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
    const reconciled = await withAccountBookingTransaction(async tx => {
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

type ClosingResult = ManualEntryResult | "balance_changed";

/** Refuses a closing date before the account's last booking; the closing words the refusal for the request. */
class ClosingBeforeLastBooking extends Error {
  constructor(readonly lastBooking: string) {
    super("The closing date precedes the last booking.");
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

async function closeAccount(account: {
  id: string;
  currency: string;
}, closing: {
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

/**
 * Books a manual account's remaining balance away on `date` and archives it in one transaction: as an adjustment, or as a transfer to another active manual account.
 * `expectedBalance` is the balance the user confirmed; a concurrent booking that changed it refuses the closing.
 */
async function closeAndArchiveManualAccount(account: {
  id: string;
  currency: string;
}, expectedBalance: number, date: string, transferAccountId: string | null, archivedAt: string): Promise<ClosingResult> {
  return withRefusableAccountBookingTransaction<ClosingResult>(async tx => {
    const decision = decideClosing(await readBookedTotal(tx, account.id), expectedBalance, date, transferAccountId !== null);

    if (decision.refused === "balance_changed") {
      return refuse(decision.refused);
    }

    if (decision.refused === "before_last_booking") {
      throw new ClosingBeforeLastBooking(decision.lastBooking);
    }

    const result = await bookManualEntry(tx, randomUUID(), {
      accountId: account.id,
      currency: account.currency,
      date,
      amount: decision.amount,
      counterparty: "",
      description: "Account closed",
      categoryId: null,
      categorySource: "manual",
      categoryRuleId: null,
      type: decision.type,
      target: transferAccountId ? {
        accountId: transferAccountId
      } : undefined
    });

    if (result !== "saved") {
      return refuse(result);
    }

    // A concurrent booking leaves a balance other than 0, which refuses the closing and rolls back its booking.
    if (!await archiveIfSettled(tx, account.id, archivedAt)) {
      return refuse("balance_changed");
    }

    return "saved";
  });
}

// A bank sync may be writing a new balance; archiving waits until it has finished.
async function archiveSettled(account: {
  id: string;
  provider: string;
}) {
  if (account.provider === "manual") {
    return archiveSettledAccount(account.id, timestamp());
  }

  return withLease(syncLease, "A sync is running. Archive the account after it has finished.", () => archiveSettledAccount(account.id, timestamp()));
}
