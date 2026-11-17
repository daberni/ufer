import { HttpError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import { categoryExists } from "@/features/categorization/server/category-repository";
import { transactionTypes } from "@/features/transactions/transaction-types";
import { setTransactionCategory } from "./transaction-repository";
import { manualLinkDays } from "./transfer-pairing";
import { readTransferOptions, saveTransactionType, type TransferTarget, type TypeChangeResult } from "./transfer-repository";

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

// Omitted keeps a transfer's current link; null means no counterpart.
const transferTarget = z.union([z.object({
  counterpart_id: z.string().min(1)
}).strict(), z.object({
  account_id: z.string().min(1)
}).strict()]).nullable();

const typeInput = z.object({
  type: z.enum(transactionTypes),
  transfer: transferTarget.optional()
});

const typeFailures: Record<Exclude<TypeChangeResult, "saved" | "not_found">, string> = {
  manual_account_only: "Opening balances and adjustments are only available for manual accounts.",
  counterpart_not_found: "The selected booking does not exist.",
  account_not_found: "Choose one of your manual accounts.",
  same_account: "A transfer moves money between two different accounts.",
  not_a_candidate: `Link a booking with the opposite amount in the same currency on another account, at most ${manualLinkDays} days apart.`,
  currency_mismatch: "The manual account must use the booking's currency.",
  zero_amount: "A booking without an amount cannot be a transfer to another account."
};

function target(transfer: z.infer<typeof transferTarget> | undefined): TransferTarget | undefined {
  if (!transfer) {
    return transfer;
  }

  return "counterpart_id" in transfer ? {
    counterpartId: transfer.counterpart_id
  } : {
    accountId: transfer.account_id
  };
}

/** Saves a transaction's type and, for a transfer, where it goes. */
export async function updateTransactionType(id: string, payload: unknown) {
  const input = typeInput.parse(payload);

  if (input.type !== "transfer" && input.transfer) {
    throw new ValidationError("Only a transfer has a target account.");
  }

  const result = await saveTransactionType(id, input.type, target(input.transfer));

  if (result === "not_found") {
    throw new HttpError(404, "Transaction not found.");
  }

  if (result !== "saved") {
    throw new ValidationError(typeFailures[result]);
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
