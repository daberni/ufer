import { Temporal } from "temporal-polyfill";
import { HttpError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import { minorUnits } from "@/lib/money";
import { categorize, prepareRules } from "@/lib/rules";
import { today, validDate } from "@/lib/time";
import { requireWritableManualAccount } from "@/features/accounts/server/account-service";
import { categoryExists } from "@/features/categorization/server/category-repository";
import { listRules } from "@/features/categorization/server/rule-repository";
import { transactionTypes } from "@/features/transactions/transaction-types";
import { categorizeEntries } from "./categorize-entries";
import { createManualTransaction, deleteManualTransaction, findEntryCurrency, updateManualTransaction, type ManualEntryResult } from "./manual-transaction-repository";
import { setTransactionCategory } from "./transaction-repository";
import { manualLinkDays } from "./transfer-pairing";
import { readTransferOptions, saveTransactionType, type TransferTarget } from "./transfer-repository";

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

const typeFailures: Record<Exclude<ManualEntryResult, "saved" | "not_found" | "archived_account">, string> = {
  manual_account_only: "Opening balances and adjustments are only available for manual accounts.",
  counterpart_not_found: "The selected booking does not exist.",
  account_not_found: "Choose one of your manual accounts.",
  same_account: "A transfer moves money between two different accounts.",
  not_a_candidate: `Link a booking with the opposite amount in the same currency on another account, at most ${manualLinkDays} days apart.`,
  currency_mismatch: "The manual account must use the booking's currency.",
  zero_amount: "A booking without an amount cannot be a transfer to another account.",
  created_counterpart: "Ufer created this booking for the transfer of its linked booking. Change where the transfer goes on that booking, or remove this one.",
  not_entered: "Only transactions entered in Ufer on a manual account can be edited or deleted this way.",
  follows_import: "This booking is linked with an imported booking and keeps its date and amount. Unlink it to change them."
};

function requireSaved(result: ManualEntryResult) {
  if (result === "not_found") {
    throw new HttpError(404, "Transaction not found.");
  }

  if (result === "archived_account") {
    throw new HttpError(409, "This account is archived. Restore the account first.");
  }

  if (result !== "saved") {
    throw new ValidationError(typeFailures[result]);
  }
}

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

  requireSaved(await saveTransactionType(id, input.type, target(input.transfer)));

  return {
    ok: true
  };
}

const entryInput = typeInput.extend({
  booking_date: z.string().refine(validDate),
  amount: z.string().max(30),
  counterparty: z.string().trim().max(500).default(""),
  description: z.string().trim().max(2000).default("")
});

const newEntryInput = entryInput.extend({
  category_id: z.string().min(1).nullable().optional()
});

function validateEntry(input: z.infer<typeof entryInput>, currency: string, now: Temporal.Instant) {
  if (input.type !== "transfer" && input.transfer) {
    throw new ValidationError("Only a transfer has a target account.");
  }

  if (Temporal.PlainDate.compare(Temporal.PlainDate.from(input.booking_date), today(now)) > 0) {
    throw new ValidationError("The booking date cannot be in the future.");
  }

  return {
    date: input.booking_date,
    amount: minorUnits(input.amount, currency),
    counterparty: input.counterparty,
    description: input.description,
    type: input.type,
    target: target(input.transfer)
  };
}

async function ruleCategory(entry: ReturnType<typeof validateEntry>, currency: string) {
  const [categorized] = categorizeEntries([{
    reference: "",
    date: entry.date,
    amount: entry.amount,
    currency,
    counterparty: entry.counterparty,
    description: entry.description
  }], await listRules());

  return categorized.categoryId;
}

/** Enters a manual booking: an omitted category applies rules; an explicit category or null records a manual assignment. */
export async function enterManualTransaction(accountId: string, payload: unknown, now = Temporal.Now.instant()) {
  const input = newEntryInput.parse(payload);
  const account = await requireWritableManualAccount(accountId, "Manual account not found.");
  const entry = validateEntry(input, account.currency, now);

  if (input.category_id && !(await categoryExists(input.category_id))) {
    throw new ValidationError("Category does not exist.");
  }

  const automatic = input.category_id === undefined;
  const categoryId = input.category_id === undefined ? await ruleCategory(entry, account.currency) : input.category_id;
  const {
    result,
    id
  } = await createManualTransaction({
    ...entry,
    accountId: account.id,
    currency: account.currency,
    categoryId,
    categorySource: automatic ? "rule" : "manual"
  });

  requireSaved(result);

  return {
    id
  };
}

/** Saves the date, amount, payee, description and type of a transaction entered in Ufer. */
export async function editManualTransaction(id: string, payload: unknown, now = Temporal.Now.instant()) {
  const input = entryInput.parse(payload);
  const currency = await findEntryCurrency(id);

  if (!currency) {
    throw new HttpError(404, "Transaction not found.");
  }

  const entry = validateEntry(input, currency, now);
  const rules = prepareRules(await listRules());
  const categoryFor = (counterparty: string, description: string) => categorize(counterparty, description, rules);

  requireSaved(await updateManualTransaction(id, entry, categoryFor));

  return {
    ok: true
  };
}

export async function removeManualTransaction(id: string) {
  requireSaved(await deleteManualTransaction(id));

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
