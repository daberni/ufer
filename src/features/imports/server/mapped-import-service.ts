import { createHash, randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { categoryNameKey, normalizeCategoryName } from "@/lib/category-name";
import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { maximumSplitParts, partAmountSupported } from "@/features/transactions/split-limits";
import { today, validDate } from "@/lib/time";
import { isCategoryIcon } from "@/features/categorization/category-icons";
import { listRules } from "@/features/categorization/server/rule-repository";
import { categorizeEntries } from "@/features/categorization/server/rule-assignment";
import { pairAllTransfers } from "@/features/transactions/server/transfer-pairing-repository";
import { environment } from "@/server/environment";
import { syncLease, withLease } from "@/server/jobs/lease";
import { accountKinds } from "@/features/accounts/account-kinds";
import { validateLiability } from "@/features/accounts/server/account-service";
import { currencyAllows } from "../csv-values";
import { importTypes, withSplitTags, maxAccountNameLength, maxCategoryLength, maxIdLength, maxSourceLength, type RowError } from "../import-rows";
import { maxCategoryChoicesPerRequest, maxConsumedPerRequest, maxTargetsPerRequest } from "../import-batches";
import { mappedReferencePrefix } from "@/lib/booking-references";
import { duplicateDateToleranceDays } from "@/lib/booking-matching";
import { normalizeText } from "@/lib/text";
import { rowDecisions, type DuplicateReason, type MatchedBooking, type SentRowMatch } from "../reimport-decisions";
import type { SplitPartValues } from "@/features/transactions/server/split-repository";
import { checkMappedEntries, findImportOpening, findImportTarget, listCategoryNames, saveMappedBatch, type MappedEntry, type NewImportAccount, type NewImportCategory, type OpeningBalance } from "./mapped-import-repository";

export const maxRowsPerRequest = 2000;

const row = z.object({
  line: z.number().int().min(1),
  date: z.string(),
  amount: z.string().max(30),
  currency: z.string().max(10).nullable(),
  payee: z.string().max(500),
  description: z.string().max(2000),
  category: z.string().max(maxCategoryLength).nullable(),
  source: z.string().max(maxSourceLength),
  occurrence: z.number().int().min(0),
  id: z.string().max(maxIdLength).nullable().default(null),
  type: z.enum(importTypes).nullable().default(null),
  hidden: z.boolean().default(false),
  parts: z.array(z.object({
    category: z.string().max(maxCategoryLength),
    amount: z.string().max(30)
  })).max(maximumSplitParts).nullable().default(null),
  tags: z.string().max(10_000).nullable().default(null)
});

/** The balance a new account should have: today's balance, or its balance before the file's first row. The difference to the imported rows is booked as an opening balance on `date`. */
const opening = z.object({
  kind: z.enum(["current", "start"]),
  amount: z.string().max(30),
  date: z.string()
});

/** A target is an existing account or a new manual account, which the first confirmed batch with rows for it creates. */
const target = z.object({
  source: z.string().max(maxSourceLength),
  account_id: z.string().optional(),
  new_account: z.object({
    name: z.string().trim().min(1).max(maxAccountNameLength),
    kind: z.enum(accountKinds),
    currency: z.string().regex(/^[A-Z]{3}$/),
    opening: opening.optional()
  }).optional()
}).refine(value => (value.account_id === undefined) !== (value.new_account === undefined));

/**
 * How the rows' category cells map to categories: an existing category, one created on confirmation, or uncategorized, which leaves unsplit rows to the rules.
 * Values without a choice match existing categories by name.
 */
const categoryChoice = z.object({
  value: z.string().max(maxCategoryLength),
  action: z.enum(["existing", "create", "uncategorized"]),
  category_id: z.string().optional(),
  /** The category a "create" choice creates, with the icon and color the person saw; without them it gets the ones suggested for the name. */
  name: z.string().max(maxCategoryLength).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toLowerCase()).optional(),
  icon: z.string().nullable().optional()
});

const matchedBooking = z.object({
  account_id: z.string(),
  reference: z.string(),
  date: z.string()
});

/** A person's decision for a matched or possibly duplicate row; `booking` names the ID of the candidate an update applies to. */
const decision = z.object({
  line: z.number().int().min(1),
  action: z.enum(rowDecisions),
  booking: z.string().max(100).optional()
});

const mappedImportInput = z.object({
  /** Identifies one import of one file; batches and retries with the same ID create each new account once. */
  import_id: z.uuid(),
  rows: z.array(row).min(1).max(maxRowsPerRequest),
  targets: z.array(target).min(1).max(maxTargetsPerRequest),
  /** Bookings that earlier batches of this import matched as duplicates or saved. */
  consumed: z.array(matchedBooking).max(maxConsumedPerRequest).default([]),
  categories: z.array(categoryChoice).max(maxCategoryChoicesPerRequest).default([]),
  /** Decisions for the batch's matched and possibly duplicate rows; a match without one updates, a possible duplicate without one is left out. */
  decisions: z.array(decision).max(maxRowsPerRequest).default([]),
  confirm: z.boolean(),
  /** Marks the last batch of a confirmed import; transfers are paired only then, so the order of batches and accounts cannot decide an ambiguous link. */
  final: z.boolean().default(true)
});

type Target = {
  accountId: string | null;
  currency: string;
  newAccount: NewImportAccount | null;
  opening: OpeningBalance | null;
};

type PlannedRow = {
  line: number;
  accountId: string | null;
  entry: MappedEntry;
};

export type MappedImportResult = {
  confirmed: boolean;
  /** Rows that are new or decided to be created, or with `confirmed` were saved. */
  newRows: number;
  /** Matched rows whose source fields an update changes, or with `confirmed` changed. */
  updatedRows: number;
  /** Lines that may duplicate an existing booking without a unique match; only a decision creates or updates them. */
  possibleDuplicates: number[];
  /** Possible duplicates without a valid decision, which are neither created nor updated. */
  undecided: number[];
  /** Every matched or possibly duplicate row with the IDs of the bookings it compares to. */
  matches: SentRowMatch[];
  /** The bookings the matches name, each once. */
  bookings: Record<string, MatchedBooking>;
  /** Bookings this batch matched or, when confirmed, saved; the next batch passes them as `consumed`. */
  matched: z.infer<typeof matchedBooking>[];
  duplicates: {
    line: number;
    reason: DuplicateReason;
  }[];
  errors: RowError[];
  /** CSV category names without a matching category or choice; their rows are categorized by rules. */
  unknownCategories: string[];
  /** Categories created for "create" choices; with `confirmed` they were saved. */
  createdCategories: string[];
  toleranceDays: number;
};

/** Checks one batch of mapped rows against their target accounts and, when confirmed, saves the new ones. Nothing persists without confirmation. */
export async function importMappedRows(payload: unknown, now = Temporal.Now.instant()): Promise<MappedImportResult> {
  const input = mappedImportInput.parse(payload);

  // A confirmed import writes and pairs the bookings a sync adopts and links, so it waits for a running sync.
  if (input.confirm) {
    return withLease(syncLease, "A sync is running. Import the file after it has finished.", () => checkAndImport(input, now));
  }

  return checkAndImport(input, now);
}

async function checkAndImport(input: z.infer<typeof mappedImportInput>, now: Temporal.Instant): Promise<MappedImportResult> {
  const targets = await resolveTargets(input.import_id, input.targets, input.confirm);
  const errors: RowError[] = [];
  const planned: PlannedRow[] = [];
  const categories = await resolveCategories(input.categories);
  const unknownCategories = new Set<string>();
  const latestDate = today(now);
  const repeatedIds = repeatedIdLines(input.rows, targets);

  for (const item of input.rows) {
    const destination = targets.get(item.source);
    const failure = repeatedIds.has(item.line) ? "The ID appears more than once for this account." : rowFailure(item, destination, latestDate);

    if (failure || !destination) {
      errors.push({
        line: item.line,
        message: failure ?? "No target account."
      });

      continue;
    }

    const resolveCategory = (value: string) => {
      const category = categories.resolve(value);

      if (category === "unknown") {
        unknownCategories.add(value);

        return null;
      }

      return category;
    };
    const amount = minorUnits(item.amount, destination.currency);
    const parts = item.parts ? splitParts(item, amount, destination.currency, resolveCategory) : null;
    // Tags the server cannot take as a split leave an ordinary booking that keeps them in its description.
    const description = item.parts && !parts ? withSplitTags(item.description, item.tags ?? "").slice(0, 2000) : item.description;
    const categoryId = item.category && !parts ? resolveCategory(item.category) : null;

    planned.push({
      line: item.line,
      accountId: destination.accountId,
      entry: {
        reference: item.id === null ? importReference(item.date, amount, item.payee, item.description, item.occurrence) : idReference(item.id),
        date: item.date,
        amount,
        currency: destination.currency,
        counterparty: item.payee,
        description,
        categoryId,
        // A split booking's categories are its parts, which rules leave alone.
        categorySource: categoryId || parts ? "manual" : "rule",
        categoryRuleId: null,
        ruleType: null,
        typeRuleId: null,
        typeTransferAccountId: null,
        fileType: item.type,
        hiddenAt: item.hidden ? now.toString() : null,
        parts
      }
    });
  }

  // Checking and confirming classify rows with the same function on the same data; confirming does it inside the write transaction.
  const {
    duplicates,
    matched,
    possible,
    newRows,
    updatedRows,
    undecided,
    matches,
    bookings,
    createdCategories
  } = await classifyAndSave(planned, targets, input.consumed, input.decisions, input.confirm, categories.created);

  // Pairing sees every account this import touched at once, so a transfer with candidates in two of them stays ambiguous.
  if (input.confirm && input.final) {
    await pairAllTransfers();
  }

  return {
    confirmed: input.confirm,
    newRows,
    updatedRows,
    matched,
    possibleDuplicates: possible.sort((left, right) => left - right),
    undecided: undecided.sort((left, right) => left - right),
    matches: matches.sort((left, right) => left.line - right.line),
    bookings,
    duplicates: [...duplicates].map(([line, reason]) => ({
      line,
      reason
    })).sort((left, right) => left.line - right.line),
    errors,
    unknownCategories: [...unknownCategories].sort(),
    createdCategories,
    toleranceDays: duplicateDateToleranceDays
  };
}

// Archived accounts are read-only until restored, including an account this import created earlier.
function requireActiveTarget(account: {
  archived_at: string | null
} | undefined) {
  if (account?.archived_at) {
    throw new HttpError(409, "This account is archived. Restore the account first.");
  }
}

async function resolveTargets(importId: string, inputs: z.infer<typeof target>[], confirm: boolean) {
  const targets = new Map<string, Target>();

  for (const input of inputs) {
    if (input.new_account) {
      const id = importAccountId(importId, input.source);
      const persisted = await findImportTarget(id);

      requireActiveTarget(persisted);
      const opening = input.new_account.opening ? openingBalance(importAccountId(importId, `${input.source}|opening|${input.new_account.opening.kind}`), input.new_account.opening, input.new_account.currency) : null;

      // The stated balance follows the same liability rule as creating or retyping an account.
      if (opening) {
        validateLiability(input.new_account.kind, opening.amount);
      }

      // An earlier confirmed batch of this import created the account; its stored configuration is authoritative.
      if (persisted && (persisted.currency !== input.new_account.currency || persisted.name !== input.new_account.name || persisted.kind !== input.new_account.kind || !await sameOpening(importId, input.source, persisted.id, opening))) {
        throw new ValidationError(`The account “${persisted.name}” (${persisted.currency}) was already created by this import; keep its name, type, currency and balance.`);
      }

      // Checking creates nothing: until the account exists it has no bookings to compare against.
      targets.set(input.source, {
        accountId: confirm || persisted ? id : null,
        currency: input.new_account.currency,
        newAccount: persisted ? null : {
          name: input.new_account.name,
          kind: input.new_account.kind,
          currency: input.new_account.currency
        },
        opening
      });

      continue;
    }

    const account = await findImportTarget(input.account_id ?? "");

    if (!account) {
      throw new HttpError(404, "Target account not found.");
    }

    requireActiveTarget(account);

    targets.set(input.source, {
      accountId: account.id,
      currency: account.currency,
      newAccount: null,
      opening: null
    });
  }

  return targets;
}

/**
 * Whether a resumed import states the opening balance the account already has: the same kind (part of the booking's ID), date and amount.
 * A `current` balance is compared as the account's balance, its opening booking plus every other transaction.
 */
async function sameOpening(importId: string, source: string, accountId: string, opening: OpeningBalance | null) {
  const kinds = ["current", "start"] as const;
  const stored = await findImportOpening(accountId, kinds.map(kind => importAccountId(importId, `${source}|opening|${kind}`)));

  if (!opening || !stored) {
    return !opening && !stored;
  }

  const statedAmount = opening.kind === "current" ? stored.amount + stored.others : stored.amount;

  return stored.id === opening.id && stored.date === opening.date && statedAmount === opening.amount;
}

/** A stable account ID per import and source account, so every batch and retry of one import targets the same new account. The configured banking environment stays in the hash because IDs persisted before changeset 0016 were derived with it. */
function importAccountId(importId: string, source: string) {
  const hex = createHash("sha256").update(`${environment()}|${importId}|${source}`).digest("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
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

  if (!currencyAllows(item.currency, destination.currency)) {
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

/** A reference from the export's ID, so a reimport recognizes the row even when its content changed. References are unique per account, so equal IDs in different accounts do not collide. */
function idReference(id: string) {
  return `${mappedReferencePrefix}${createHash("sha256").update(`id|${id}`).digest("hex").slice(0, 32)}`;
}

/** Lines whose ID another row for the same target account repeats; the client rejects them already, so this guards each batch. */
function repeatedIdLines(rows: z.infer<typeof row>[], targets: Map<string, Target>) {
  const lines = new Map<string, number[]>();

  for (const item of rows) {
    if (item.id !== null) {
      const account = targets.get(item.source)?.accountId ?? `new:${item.source}`;
      const key = `${account}\u0000${item.id}`;

      lines.set(key, [...lines.get(key) ?? [], item.line]);
    }
  }

  return new Set([...lines.values()].filter(group => group.length > 1).flat());
}

function openingBalance(id: string, input: z.infer<typeof opening>, currency: string): OpeningBalance {
  if (!validDate(input.date)) {
    throw new ValidationError("The opening balance date is invalid.");
  }

  return {
    id,
    kind: input.kind,
    amount: minorUnits(input.amount, currency),
    date: input.date
  };
}

/**
 * Resolves category choices once per batch. "create" choices reuse a category whose name matches; otherwise rows refer to a new category that the confirmed save creates in its transaction when a saved row uses it.
 * Values without a choice match existing categories by name, and unmatched ones are reported as unknown.
 */
async function resolveCategories(choices: z.infer<typeof categoryChoice>[]) {
  const existing = await listCategoryNames();
  const byName = new Map(existing.map(category => [categoryNameKey(category.name), category.id]));
  const byId = new Set(existing.map(category => category.id));
  const chosen = new Map<string, string | null>();
  // Several values mapped to one new category share it.
  const created = new Map<string, NewImportCategory>();

  for (const choice of choices) {
    if (choice.action === "uncategorized") {
      chosen.set(choice.value, null);

      continue;
    }

    if (choice.action === "existing") {
      if (!choice.category_id || !byId.has(choice.category_id)) {
        throw new ValidationError(`The category chosen for “${choice.value}” no longer exists.`);
      }

      chosen.set(choice.value, choice.category_id);

      continue;
    }

    const name = normalizeCategoryName(choice.name ?? "");

    if (!name) {
      throw new ValidationError("A category name cannot be empty.");
    }

    if (choice.icon && !isCategoryIcon(choice.icon)) {
      throw new ValidationError("Choose one of the available category icons.");
    }

    const key = categoryNameKey(name);
    const match = byName.get(key);

    if (match) {
      chosen.set(choice.value, match);

      continue;
    }

    const category = created.get(key) ?? {
      id: randomUUID(),
      name,
      shown: choice.color === undefined ? undefined : {
        color: choice.color,
        icon: choice.icon && isCategoryIcon(choice.icon) ? choice.icon : null
      }
    };

    created.set(key, category);
    chosen.set(choice.value, category.id);
  }

  return {
    created: [...created.values()],
    resolve(value: string): string | null | "unknown" {
      if (chosen.has(value)) {
        return chosen.get(value) ?? null;
      }

      const key = categoryNameKey(value);

      return byName.get(key) ?? created.get(key)?.id ?? "unknown";
    }
  };
}

/**
 * The parts of a split row in the account's minor units, checked like a split saved in the edit dialog: they must add up exactly to the booking's amount. Only income and expenses are split.
 * Null when they cannot, so the row imports unsplit.
 */
function splitParts(item: z.infer<typeof row>, amount: number, currency: string, resolveCategory: (value: string) => string | null): SplitPartValues[] | null {
  const parts = item.parts ?? [];

  if (item.type === "transfer" || item.hidden) {
    return null;
  }

  if (parts.length < 2) {
    return null;
  }

  const amounts: number[] = [];

  for (const part of parts) {
    try {
      amounts.push(minorUnits(part.amount, currency));
    } catch (error) {
      if (error instanceof ValidationError) {
        return null;
      }

      throw error;
    }
  }

  if (amounts.some(value => value === 0 || !partAmountSupported(value))) {
    return null;
  }

  if (amounts.reduce((sum, value) => sum + value, 0) !== amount) {
    return null;
  }

  return parts.map((part, index) => ({
    amount: amounts[index],
    categoryId: resolveCategory(part.category),
    note: ""
  }));
}

/** A stable reference from the row's content, so the same file imported again matches its earlier rows exactly. */
function importReference(date: string, amount: number, payee: string, description: string, occurrence: number) {
  const content = [date, amount, normalizeText(payee), normalizeText(description), occurrence].join("|");

  return `${mappedReferencePrefix}${createHash("sha256").update(content).digest("hex").slice(0, 32)}`;
}

async function classifyAndSave(planned: PlannedRow[], targets: Map<string, Target>, consumed: z.infer<typeof matchedBooking>[], decisions: z.infer<typeof decision>[], confirm: boolean, newCategories: NewImportCategory[]) {
  const duplicates = new Map<number, DuplicateReason>();
  const matched: z.infer<typeof matchedBooking>[] = [];
  const possible: number[] = [];
  const undecided: number[] = [];
  const matches: SentRowMatch[] = [];
  const bookings: Record<string, MatchedBooking> = {};
  const decisionOf = new Map(decisions.map(item => [item.line, {
    action: item.action,
    booking: item.booking
  }]));
  const decisionsOf = (rows: PlannedRow[]) => new Map(rows.flatMap((item, index) => {
    const chosen = decisionOf.get(item.line);

    return chosen ? [[index, chosen] as const] : [];
  }));
  let updatedRows = 0;
  const rules = confirm ? await listRules() : [];
  const newAccounts = new Map([...targets.values()].flatMap(target => target.accountId && target.newAccount ? [[target.accountId, target.newAccount] as const] : []));
  const openings = new Map([...targets.values()].flatMap(target => target.accountId && target.opening ? [[target.accountId, target.opening] as const] : []));
  const accountIds = [...new Set(planned.flatMap(item => item.accountId ? [item.accountId] : []))];
  const rowsOf = new Map(accountIds.map(accountId => [accountId, planned.filter(item => item.accountId === accountId)]));
  const absorbedOf = (accountId: string) => new Set(consumed.filter(item => item.account_id === accountId).map(item => item.reference));
  let newRows = planned.filter(item => item.accountId === null).length;
  let createdCategories = newCategories.map(category => category.name);
  let results: Awaited<ReturnType<typeof checkMappedEntries>>[];

  if (confirm) {
    // One transaction for every account of the batch, so a failure saves none of them.
    const saved = await saveMappedBatch(accountIds.map(accountId => ({
      accountId,
      entries: categorized((rowsOf.get(accountId) ?? []).map(item => item.entry), rules),
      newAccount: newAccounts.get(accountId) ?? null,
      consumed: absorbedOf(accountId),
      opening: openings.get(accountId) ?? null,
      decisions: decisionsOf(rowsOf.get(accountId) ?? [])
    })), newCategories);

    results = saved.results;
    createdCategories = saved.createdCategories;
  } else {
    results = [];

    for (const accountId of accountIds) {
      const rows = rowsOf.get(accountId) ?? [];

      results.push(await checkMappedEntries(accountId, rows.map(item => item.entry), absorbedOf(accountId), decisionsOf(rows)));
    }
  }

  accountIds.forEach((accountId, position) => {
    const rows = rowsOf.get(accountId) ?? [];
    const result = results[position];

    for (const [index, reason] of result.duplicates) {
      duplicates.set(rows[index].line, reason);
    }

    possible.push(...result.possible.map(index => rows[index].line));
    undecided.push(...result.undecided.map(index => rows[index].line));
    updatedRows += result.updated.length;

    Object.assign(bookings, result.bookings);

    for (const [index, match] of result.matches) {
      matches.push({
        line: rows[index].line,
        ...match,
        accountId
      });
    }

    matched.push(...result.matched.map(booking => ({
      account_id: accountId,
      ...booking
    })));
    newRows += result.inserted;
  });

  return {
    duplicates,
    matched,
    possible,
    newRows,
    updatedRows,
    undecided,
    matches,
    bookings,
    createdCategories
  };
}

/** Rules categorize rows without a category from the CSV; a rule's type applies to every row it decides except split ones, which stay income or expense. */
function categorized(entries: MappedEntry[], rules: Awaited<ReturnType<typeof listRules>>) {
  const ruled = categorizeEntries(entries, rules);

  return entries.map((entry, index) => {
    const assignment = ruled[index];

    if (entry.parts) {
      return entry;
    }

    const typed = {
      ...entry,
      ruleType: assignment.ruleType,
      typeRuleId: assignment.typeRuleId,
      typeTransferAccountId: assignment.typeTransferAccountId
    };

    if (entry.categorySource === "manual") {
      return typed;
    }

    return {
      ...typed,
      categoryId: assignment.categoryId,
      categoryRuleId: assignment.categoryRuleId
    };
  });
}
