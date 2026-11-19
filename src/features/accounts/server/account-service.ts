import { Temporal } from "temporal-polyfill";
import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { timestamp, today } from "@/lib/time";
import { accountInput, accountRenameInput, valuationInput } from "./account-schema";
import { findManualAccount, insertManualAccount, saveAccountArchived, saveAccountName, saveManualValuation } from "./account-repository";

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
  const account = await findManualAccount(accountId);

  if (!account) {
    throw new HttpError(404, "Manual account not found.");
  }

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

/** Hides an account from the account lists and pickers; restoring it shows it again with its unchanged history. */
export async function setAccountArchived(accountId: string, archived: boolean) {
  if (!await saveAccountArchived(accountId, archived ? timestamp() : null)) {
    throw new HttpError(404, "Account not found.");
  }

  return {
    ok: true
  };
}
