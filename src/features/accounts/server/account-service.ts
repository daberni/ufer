import { Temporal } from "temporal-polyfill";
import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { today } from "@/lib/time";
import { accountInput, valuationInput } from "./account-schema";
import { findManualAccount, insertManualAccount, saveManualValuation } from "./account-repository";

export async function createManualAccount(payload: unknown) {
  const input = accountInput.parse(payload);
  const amount = minorUnits(input.balance, input.currency);

  validateLiability(input.kind, amount);

  return insertManualAccount(input, amount);
}

export async function updateManualValuation(accountId: string, payload: unknown, now = Temporal.Now.instant()) {
  const input = valuationInput.parse(payload);
  const account = await findManualAccount(accountId);

  if (!account) {
    throw new HttpError(404, "Manual account not found.");
  }

  const amount = minorUnits(input.balance, account.currency);

  validateLiability(account.kind, amount);

  if (Temporal.PlainDate.compare(Temporal.PlainDate.from(input.date), today(now)) > 0) {
    throw new ValidationError("The valuation date cannot be in the future.");
  }

  await saveManualValuation(accountId, amount, input.date);

  return {
    ok: true
  };
}

export function validateLiability(kind: string, amount: number) {
  if (kind === "loan" && amount > 0) {
    throw new ValidationError("Enter outstanding debt as a negative balance.");
  }
}
