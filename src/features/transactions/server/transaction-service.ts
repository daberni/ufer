import { Temporal } from "temporal-polyfill";
import { HttpError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import { minorUnits } from "@/lib/money";
import { prepareRules, ruleAssignment, type RuleText } from "@/lib/rules";
import { today, validDate } from "@/lib/time";
import { requireWritableManualAccount } from "@/features/accounts/server/account-service";
import { categoryExists } from "@/features/categorization/server/category-repository";
import { listRules } from "@/features/categorization/server/rule-repository";
import { transactionTypes } from "@/features/transactions/transaction-types";
import { categorizeEntries } from "./categorize-entries";
import { createManualTransaction, deleteManualTransaction, findEntryCurrency, updateManualTransaction, type ManualEntryResult } from "./manual-transaction-repository";
import { returnTransactionToRules, saveTransactionDetails, setTransactionCategory, setTransactionHidden } from "./transaction-repository";
import { manualLinkDays } from "./transfer-pairing";
import { readTransferOptions, type TransferTarget } from "./transfer-repository";
import { formatCount } from "@/lib/locale";
import { currentFormatLocale } from "@/server/http/request-locale";

// A category ID or null sets the category manually; automatic returns the transaction to the rules.
const categoryChoice = z.union([z.object({
  category_id: z.string().min(1).nullable()
}).strict(), z.object({
  automatic: z.literal(true)
}).strict()]);

/** Sets a transaction's category manually, or returns it to automatic categorization with the category and rule that the stored rules decide. */
export async function updateTransactionCategory(id: string, payload: unknown) {
  const choice = categoryChoice.parse(payload);
  const assignment = "automatic" in choice ? await automaticCategory(id) : await manualCategory(id, choice.category_id);

  if (assignment === "archived_account") {
    throw new HttpError(409, "This account is archived. Restore the account first.");
  }

  if (!assignment) {
    throw new HttpError(404, "Transaction not found.");
  }

  return assignment;
}

function automaticCategory(id: string) {
  return returnTransactionToRules(id, (storedRules, text) => ruleAssignment(text, prepareRules(storedRules)));
}

async function manualCategory(id: string, categoryId: string | null) {
  if (categoryId && !(await categoryExists(categoryId))) {
    throw new ValidationError("Category does not exist.");
  }

  return setTransactionCategory(id, categoryId);
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

// Omitted text keeps a booking's current payee or description.
const detailsInput = typeInput.extend({
  counterparty: z.string().trim().max(500).optional(),
  description: z.string().trim().max(2000).optional()
});

const typeFailures: Record<Exclude<ManualEntryResult, "saved" | "not_found" | "hidden" | "archived_account" | "not_a_candidate">, string> = {
  manual_account_only: "Opening balances and adjustments are only available for manual accounts.",
  counterpart_not_found: "The selected booking does not exist.",
  account_not_found: "Choose one of your manual accounts.",
  same_account: "A transfer moves money between two different accounts.",
  currency_mismatch: "The manual account must use the booking's currency.",
  zero_amount: "A booking without an amount cannot be a transfer to another account.",
  created_counterpart: "Ufer created this booking for the transfer of its linked booking. Change where the transfer goes on that booking, or remove this one.",
  not_entered: "Only transactions entered in Ufer on a manual account can be edited or deleted this way.",
  follows_import: "This booking is linked with an imported booking and keeps its date and amount. Unlink it to change them.",
  entered: "This transaction was entered in Ufer. Edit or delete it instead."
};

async function requireSaved(result: ManualEntryResult) {
  if (result === "not_found") {
    throw new HttpError(404, "Transaction not found.");
  }

  if (result === "archived_account") {
    throw new HttpError(409, "This account is archived. Restore the account first.");
  }

  if (result === "hidden") {
    throw new HttpError(409, "This transaction is hidden. Show it before linking it with another booking.");
  }

  if (result === "not_a_candidate") {
    throw new ValidationError(`Link a booking with the opposite amount in the same currency on another account, at most ${formatCount(manualLinkDays, await currentFormatLocale())} days apart.`);
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

/** Saves a transaction's type and, for a transfer, where it goes; an imported booking also takes the person's payee and description, which later syncs and imports keep. */
export async function updateTransactionDetails(id: string, payload: unknown) {
  const input = detailsInput.parse(payload);

  if (input.type !== "transfer" && input.transfer) {
    throw new ValidationError("Only a transfer has a target account.");
  }

  await requireSaved(await saveTransactionDetails(id, input.type, target(input.transfer), {
    counterparty: input.counterparty,
    description: input.description
  }));

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

async function automaticAssignment(entry: ReturnType<typeof validateEntry>, currency: string) {
  const [categorized] = categorizeEntries([{
    reference: "",
    date: entry.date,
    amount: entry.amount,
    currency,
    counterparty: entry.counterparty,
    description: entry.description
  }], await listRules());

  return categorized;
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
  const assignment = automatic ? await automaticAssignment(entry, account.currency) : {
    categoryId: input.category_id ?? null,
    categoryRuleId: null
  };
  const {
    result,
    id
  } = await createManualTransaction({
    ...entry,
    accountId: account.id,
    currency: account.currency,
    categoryId: assignment.categoryId,
    categorySource: automatic ? "rule" : "manual",
    categoryRuleId: assignment.categoryRuleId
  });

  await requireSaved(result);

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
  const categoryFor = (text: RuleText) => ruleAssignment(text, rules);

  await requireSaved(await updateManualTransaction(id, entry, categoryFor));

  return {
    ok: true
  };
}

export async function removeManualTransaction(id: string) {
  await requireSaved(await deleteManualTransaction(id));

  return {
    ok: true
  };
}

/** Hides an imported booking from balances and reports, or shows it again; later syncs and imports keep it hidden. */
export async function hideTransaction(id: string, hidden: boolean, now = Temporal.Now.instant()) {
  await requireSaved(await setTransactionHidden(id, hidden, now.toString()));

  return {
    hidden
  };
}

export async function transferOptions(id: string) {
  const options = await readTransferOptions(id);

  if (!options) {
    throw new HttpError(404, "Transaction not found.");
  }

  return options;
}
