import { createHash } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { today, validDate } from "@/lib/time";
import { accountKinds } from "@/features/accounts/account-kinds";
import { listRules } from "@/features/categorization/server/rule-repository";
import { categorizeEntries } from "@/features/transactions/server/categorize-entries";
import type { RowError } from "../csv-mapping";
import { duplicateDateToleranceDays, findDuplicates, normalizeText, type DuplicateReason } from "./duplicate-matching";
import { findImportTarget, insertImportAccount, insertMappedEntries, listCategoryNames, readBookingsBetween, type MappedEntry } from "./mapped-import-repository";

export const maxRowsPerRequest = 2000;

const row = z.object({
  line: z.number().int().min(1),
  date: z.string(),
  amount: z.string().max(30),
  currency: z.string().max(10).nullable(),
  payee: z.string().max(500),
  description: z.string().max(2000),
  category: z.string().max(100).nullable(),
  source: z.string().max(200),
  occurrence: z.number().int().min(0)
});

/** A target is an existing account, or, while checking, a manual account that is created only on confirmation. */
const target = z.object({
  source: z.string().max(200),
  account_id: z.string().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional()
}).refine(value => value.account_id !== undefined || value.currency !== undefined);

const mappedImportInput = z.object({
  rows: z.array(row).min(1).max(maxRowsPerRequest),
  targets: z.array(target).min(1).max(100),
  confirm: z.boolean()
});

const importAccountInput = z.object({
  name: z.string().trim().min(1).max(100),
  institution: z.string().trim().min(1).max(100).default("CSV import"),
  kind: z.enum(accountKinds).default("checking"),
  currency: z.string().regex(/^[A-Z]{3}$/).default("EUR")
});

type Target = {
  accountId: string | null;
  currency: string;
};

type PlannedRow = {
  line: number;
  accountId: string | null;
  entry: MappedEntry;
};

export type MappedImportResult = {
  confirmed: boolean;
  /** Rows that are new, or with `confirmed` were saved. */
  newRows: number;
  duplicates: {
    line: number;
    reason: DuplicateReason;
  }[];
  errors: RowError[];
  /** CSV category names without a matching category; their rows are categorized by rules. */
  unknownCategories: string[];
  toleranceDays: number;
};

/** Checks one batch of mapped rows against their target accounts and, when confirmed, saves the new ones. Nothing persists without confirmation. */
export async function importMappedRows(payload: unknown, now = Temporal.Now.instant()): Promise<MappedImportResult> {
  const input = mappedImportInput.parse(payload);
  const targets = await resolveTargets(input.targets, input.confirm);
  const errors: RowError[] = [];
  const planned: PlannedRow[] = [];
  const categoryIds = new Map((await listCategoryNames()).map(category => [category.name.toLocaleLowerCase(), category.id]));
  const unknownCategories = new Set<string>();
  const latestDate = today(now);

  for (const item of input.rows) {
    const destination = targets.get(item.source);
    const failure = rowFailure(item, destination, latestDate);

    if (failure || !destination) {
      errors.push({
        line: item.line,
        message: failure ?? "No target account."
      });

      continue;
    }

    const categoryId = item.category ? categoryIds.get(item.category.toLocaleLowerCase()) ?? null : null;

    if (item.category && !categoryId) {
      unknownCategories.add(item.category);
    }

    const amount = minorUnits(item.amount, destination.currency);

    planned.push({
      line: item.line,
      accountId: destination.accountId,
      entry: {
        reference: importReference(item.date, amount, item.payee, item.description, item.occurrence),
        date: item.date,
        amount,
        currency: destination.currency,
        counterparty: item.payee,
        description: item.description,
        categoryId,
        categorySource: categoryId ? "manual" : "rule"
      }
    });
  }

  const duplicates = await markDuplicates(planned);
  const fresh = planned.filter(item => !duplicates.has(item.line));
  let newRows = fresh.length;

  if (input.confirm) {
    newRows = await saveRows(fresh);
  }

  return {
    confirmed: input.confirm,
    newRows,
    duplicates: [...duplicates].map(([line, reason]) => ({
      line,
      reason
    })).sort((left, right) => left.line - right.line),
    errors,
    unknownCategories: [...unknownCategories].sort(),
    toleranceDays: duplicateDateToleranceDays
  };
}

export async function createImportAccount(payload: unknown) {
  return insertImportAccount(importAccountInput.parse(payload));
}

async function resolveTargets(inputs: z.infer<typeof target>[], confirm: boolean) {
  const targets = new Map<string, Target>();

  for (const input of inputs) {
    if (input.account_id === undefined) {
      if (confirm) {
        throw new ValidationError("Create new accounts before confirming the import.");
      }

      targets.set(input.source, {
        accountId: null,
        currency: input.currency ?? "EUR"
      });

      continue;
    }

    const account = await findImportTarget(input.account_id);

    if (!account) {
      throw new HttpError(404, "Target account not found.");
    }

    targets.set(input.source, {
      accountId: account.id,
      currency: account.currency
    });
  }

  return targets;
}

function rowFailure(item: z.infer<typeof row>, destination: Target | undefined, latestDate: Temporal.PlainDate) {
  if (!destination) {
    return `No target account for “${item.source}”.`;
  }

  if (!validDate(item.date)) {
    return "The date is invalid.";
  }

  if (Temporal.PlainDate.compare(Temporal.PlainDate.from(item.date), latestDate) > 0) {
    return "The booking date is in the future.";
  }

  if (item.currency && item.currency !== destination.currency) {
    return `The currency ${item.currency} differs from the account currency ${destination.currency}.`;
  }

  try {
    minorUnits(item.amount, destination.currency);
  } catch (error) {
    if (error instanceof ValidationError) {
      return error.message;
    }

    throw error;
  }

  return null;
}

/** A stable reference from the row's content, so the same file imported again matches its earlier rows exactly. */
function importReference(date: string, amount: number, payee: string, description: string, occurrence: number) {
  const content = [date, amount, normalizeText(payee), normalizeText(description), occurrence].join("|");

  return `csv:${createHash("sha256").update(content).digest("hex").slice(0, 32)}`;
}

async function markDuplicates(planned: PlannedRow[]) {
  const duplicates = new Map<number, DuplicateReason>();
  const accountIds = new Set(planned.flatMap(item => item.accountId ? [item.accountId] : []));

  for (const accountId of accountIds) {
    const rows = planned.filter(item => item.accountId === accountId);
    const dates = rows.map(item => item.entry.date).sort();
    const from = shiftDate(dates[0], -duplicateDateToleranceDays);
    const to = shiftDate(dates[dates.length - 1], duplicateDateToleranceDays);
    const existing = await readBookingsBetween(accountId, from, to);
    const found = findDuplicates(rows.map(item => item.entry), existing);

    for (const [index, reason] of found) {
      duplicates.set(rows[index].line, reason);
    }
  }

  return duplicates;
}

async function saveRows(rows: PlannedRow[]) {
  const rules = await listRules();
  const accountIds = new Set(rows.flatMap(item => item.accountId ? [item.accountId] : []));
  let saved = 0;

  for (const accountId of accountIds) {
    const entries = rows.filter(item => item.accountId === accountId).map(item => item.entry);
    const uncategorized = entries.filter(entry => !entry.categoryId);
    const ruled = categorizeEntries(uncategorized, rules);
    const categorized = entries.map(entry => entry.categoryId ? entry : {
      ...entry,
      categoryId: ruled[uncategorized.indexOf(entry)].categoryId
    });

    saved += await insertMappedEntries(accountId, categorized);
  }

  return saved;
}

function shiftDate(date: string, days: number) {
  return Temporal.PlainDate.from(date).add({
    days
  }).toString();
}
