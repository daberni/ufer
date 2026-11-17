import { HttpError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import { categoryExists } from "@/features/categorization/server/category-repository";
import { transactionTypes } from "@/features/transactions/transaction-types";
import { setTransactionCategory } from "./transaction-repository";
import { manualLinkDays } from "./transfer-pairing";
import { readTransferOptions, removeTransferLink, saveTransactionType, saveTransferLink, saveTransferToManualAccount, type LinkResult, type ManualCounterpartResult } from "./transfer-repository";

export async function updateTransactionCategory(id: string, payload: unknown) {
  const {
    category_id: categoryId
  } = z.object({
    category_id: z.string().min(1).nullable()
  }).parse(payload);

  if (categoryId && !(await categoryExists(categoryId))) {
    throw new ValidationError("Category does not exist.");
  }

  const assignment = await setTransactionCategory(id, categoryId);

  if (!assignment) {
    throw new HttpError(404, "Transaction not found.");
  }

  return assignment;
}

const typeInput = z.object({
  type: z.enum(transactionTypes)
});

export async function updateTransactionType(id: string, payload: unknown) {
  const { type } = typeInput.parse(payload);
  const result = await saveTransactionType(id, type);

  if (result === "not_found") {
    throw new HttpError(404, "Transaction not found.");
  }

  if (result === "manual_account_only") {
    throw new ValidationError("Opening balances and adjustments are only available for manual accounts.");
  }

  return {
    ok: true
  };
}

// Either an existing booking on another account, or a manual account on which the counterpart is created.
const linkInput = z.union([z.object({
  counterpart_id: z.string().min(1)
}).strict(), z.object({
  account_id: z.string().min(1)
}).strict()]);

const linkFailures: Record<Exclude<LinkResult | ManualCounterpartResult, "saved" | "not_found">, string> = {
  counterpart_not_found: "The selected booking does not exist.",
  account_not_found: "Choose one of your manual accounts.",
  same_account: "A transfer moves money between two different accounts.",
  not_a_candidate: `Link a booking with the opposite amount in the same currency on another account, at most ${manualLinkDays} days apart.`,
  currency_mismatch: "The manual account must use the booking's currency.",
  zero_amount: "A booking without an amount cannot be a transfer to another account.",
  already_linked: "Unlink the current counterpart first."
};

export async function linkTransfer(id: string, payload: unknown) {
  const input = linkInput.parse(payload);
  const result = "counterpart_id" in input ? await saveTransferLink(id, input.counterpart_id) : await saveTransferToManualAccount(id, input.account_id);

  if (result === "not_found") {
    throw new HttpError(404, "Transaction not found.");
  }

  if (result === "already_linked") {
    throw new HttpError(409, linkFailures.already_linked);
  }

  if (result !== "saved") {
    throw new ValidationError(linkFailures[result]);
  }

  return {
    ok: true
  };
}

export async function unlinkTransfer(id: string) {
  const result = await removeTransferLink(id);

  if (result === "not_found") {
    throw new HttpError(404, "Transaction not found.");
  }

  if (result === "not_linked") {
    throw new HttpError(409, "The transaction is not linked to a counterpart.");
  }

  return {
    ok: true
  };
}

export async function transferOptions(id: string) {
  const options = await readTransferOptions(id);

  if (!options) {
    throw new HttpError(404, "Transaction not found.");
  }

  return options;
}
