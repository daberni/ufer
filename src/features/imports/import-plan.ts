import { categoryNameKey } from "@/lib/category-name";
import { categoryTags, rowCategoryValues, maxAccountNameLength, maxCategoryLength, type MappedRow } from "./import-rows";
import { currencyAllows, parseAmount, splitCurrency, type DecimalSeparator } from "./csv-values";
import type { CsvTemplate } from "./csv-templates";
import type { AccountKind } from "@/features/accounts/account-kinds";
import type { CategoryChoice, ImportTarget } from "./mutations";
import type { ImportMessages } from "./import-messages";

/** What the person chose for one source account's rows. */
export type TargetChoice = {
  kind: "unset";
} | {
  kind: "existing";
  accountId: string;
} | {
  kind: "new";
  name: string;
  accountKind: AccountKind;
  currency: string;
  /** Today's balance, or the balance before the file's first row. */
  balanceKind: "current" | "start";
  /** Empty books no opening balance: the account balance is the sum of the imported rows. */
  balance: string;
} | {
  kind: "skip";
};

export type SourceAccount = {
  source: string;
  rows: number;
  /** The currency all of the source's rows state; null when they state none or differ. */
  currency: string | null;
};

export type CategoryValue = {
  value: string;
  rows: number;
  /** Several tags, such as a Buxfer tag list; the import does not guess one of them. */
  multiTag: boolean;
  /** An existing category with the same name. */
  matchId: string | null;
};

/** A category the import creates on confirmation, with the suggested icon and color it is shown with while pending and created with. */
export type NewImportCategory = {
  name: string;
  color: string;
  icon: string | null;
};

/**
 * What the person chose for one category value; an unset value blocks the check like an unset account.
 * Uncategorized rows are imported without a category, so rules may categorize unsplit ones like any uncategorized booking.
 */
export type CategorySelection = {
  action: "unset";
} | {
  action: "existing";
  categoryId: string;
} | {
  action: "create";
  category: NewImportCategory;
} | {
  action: "uncategorized";
};

type AccountOption = {
  id: string;
  name: string;
  currency: string;
};

/** Distinct source account values with their row counts, in file order; without an account column all rows share the empty source. */
export function sourceAccounts(rows: MappedRow[]): SourceAccount[] {
  const counts = new Map<string, number>();
  const currencies = new Map<string, Set<string | null>>();

  for (const row of rows) {
    counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
    currencies.set(row.source, (currencies.get(row.source) ?? new Set()).add(row.currency));
  }

  return [...counts].map(([source, count]) => {
    const stated = [...currencies.get(source) ?? []];

    return {
      source,
      rows: count,
      currency: stated.length === 1 && stated[0] && /^[A-Z]{3}$/.test(stated[0]) ? stated[0] : null
    };
  });
}

/** The one existing account named like the source value is preselected; with none or several, the person chooses. */
export function defaultTargetChoice(source: string, accounts: AccountOption[]): TargetChoice {
  const matches = source ? accounts.filter(account => categoryNameKey(account.name) === categoryNameKey(source)) : [];

  if (matches.length === 1) {
    return {
      kind: "existing",
      accountId: matches[0].id
    };
  }

  return {
    kind: "unset"
  };
}

/** An account's option label; accounts sharing a name also show their institution and the end of their ID, so the options stay distinguishable. */
export function accountLabel(account: AccountOption & {
  institution: string | null;
}, accounts: AccountOption[]) {
  const shared = accounts.filter(other => categoryNameKey(other.name) === categoryNameKey(account.name)).length > 1;

  const details = shared ? [account.currency, account.institution, `…${account.id.slice(-4)}`] : [account.currency];

  return `${account.name} (${details.filter(Boolean).join(" · ")})`;
}

/** A new account named after the source value, shortened to the longest allowed name; the person sees and can edit the prefill. */
/** A new manual account named after the source, in the currency its rows state, else EUR. */
export function newAccountChoice(source: string, currency: string | null = null): TargetChoice {
  return {
    kind: "new",
    name: source.slice(0, maxAccountNameLength),
    accountKind: "checking",
    currency: currency ?? "EUR",
    balanceKind: "current",
    balance: ""
  };
}

/** Distinct category values with their row counts and an existing category of the same name. */
export function categoryValues(rows: MappedRow[], categories: {
  id: string;
  name: string;
}[]): CategoryValue[] {
  const counts = new Map<string, number>();
  const byName = new Map(categories.map(category => [categoryNameKey(category.name), category.id]));

  // A split row counts once for each of its parts' category values, which are mapped like any other value.
  for (const row of rows) {
    for (const value of rowCategoryValues(row)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return [...counts].map(([value, count]) => ({
    value,
    rows: count,
    multiTag: categoryTags(value).length > 1,
    matchId: byName.get(categoryNameKey(value)) ?? null
  })).sort((left, right) => right.rows - left.rows || left.value.localeCompare(right.value));
}

/** The existing category named like the value is preselected; any other value, including a multi-tag one, waits for the person's choice. */
export function defaultCategorySelection(value: CategoryValue): CategorySelection {
  if (value.matchId && !value.multiTag) {
    return {
      action: "existing",
      categoryId: value.matchId
    };
  }

  return {
    action: "unset"
  };
}

/** Identifies what a check covered: the rows, targets and category choices sent. A check result only applies while this key is unchanged. */
export function importKey(prepared: Pick<PreparedImport, "rows" | "targets" | "categories">) {
  return JSON.stringify([prepared.rows, prepared.targets, prepared.categories]);
}

export type PreparedImport = {
  rows: MappedRow[];
  targets: ImportTarget[];
  categories: CategoryChoice[];
  /** Rows of sources the person skipped. */
  skipped: number;
  /** What still blocks a check, in the order the page shows it; each belongs to one input of one source account. */
  problems: ImportProblem[];
};

/** A missing or invalid input of one source account's target. */
export type AccountProblem = {
  source: string;
  field: "target" | "name" | "currency" | "balance";
  message: string;
};

/** A missing or invalid input that blocks the check, shown next to that input: a source account's input or a category value's choice. */
export type ImportProblem = AccountProblem | {
  value: string;
  field: "category";
  message: string;
};

/** Turns the page's choices into the import request: skipped sources drop their rows, and a new account's opening balance is dated on its first row. */
export function prepareImport(rows: MappedRow[], choices: ReadonlyMap<string, TargetChoice>, accounts: AccountOption[], selections: ReadonlyMap<string, CategorySelection>, decimal: DecimalSeparator, t: ImportMessages): PreparedImport {
  const targets: ImportTarget[] = [];
  const problems: ImportProblem[] = [];
  const kept = rows.filter(row => choices.get(row.source)?.kind !== "skip");

  for (const { source } of sourceAccounts(rows)) {
    const choice = choices.get(source) ?? {
      kind: "unset"
    };
    const problem = (field: AccountProblem["field"], message: string) => problems.push({
      source,
      field,
      message
    });

    if (choice.kind === "skip") {
      continue;
    }

    if (choice.kind === "unset") {
      problem("target", t("problems.chooseAccount"));

      continue;
    }

    if (choice.kind === "existing") {
      const account = accounts.find(item => item.id === choice.accountId);

      if (!account) {
        problem("target", t("problems.chooseAccount"));

        continue;
      }

      targets.push({
        source,
        accountId: account.id,
        currency: account.currency,
        newAccount: null
      });

      continue;
    }

    const name = choice.name.trim();
    const balance = choice.balance.trim() ? parseAmount(choice.balance, decimal) : null;

    if (!name) {
      problem("name", t("problems.accountName"));
    }

    if (name.length > maxAccountNameLength) {
      problem("name", t("problems.accountNameLength", {
        max: maxAccountNameLength
      }));
    }

    if (!/^[A-Z]{3}$/.test(choice.currency)) {
      problem("currency", t("problems.currency"));
    }

    if (choice.balance.trim() && balance === null) {
      problem("balance", t("problems.balanceNumber"));
    }

    if (choice.accountKind === "loan" && balance !== null && Number(balance) > 0) {
      problem("balance", t("problems.loanBalance"));
    }

    const balanceCurrency = splitCurrency(choice.balance.trim()).currency;

    // The amount is stored in the account currency, so a balance stated in another currency must not be relabelled.
    if (balance !== null && balanceCurrency && !currencyAllows(balanceCurrency, choice.currency)) {
      problem("balance", t("problems.balanceCurrency", {
        currency: choice.currency
      }));
    }

    const firstDate = kept.filter(row => row.source === source).map(row => row.date).sort()[0];

    targets.push({
      source,
      accountId: null,
      currency: choice.currency,
      newAccount: {
        name,
        kind: choice.accountKind,
        opening: balance !== null && firstDate ? {
          kind: choice.balanceKind,
          amount: balance,
          date: firstDate
        } : null
      }
    });
  }

  const categories: CategoryChoice[] = [];

  for (const [value, selection] of selections) {
    if (selection.action === "unset") {
      problems.push({
        value,
        field: "category",
        message: t("problems.chooseCategory")
      });

      continue;
    }

    // A new category's name is typed in the picker, which has no length limit of its own.
    if (selection.action === "create" && selection.category.name.trim().length > maxCategoryLength) {
      problems.push({
        value,
        field: "category",
        message: t("problems.categoryLength", {
          max: maxCategoryLength
        })
      });

      continue;
    }

    categories.push({
      value,
      action: selection.action,
      categoryId: selection.action === "existing" ? selection.categoryId : undefined,
      newCategory: selection.action === "create" ? selection.category : undefined
    });
  }

  return {
    rows: kept,
    targets,
    categories,
    skipped: rows.length - kept.length,
    problems
  };
}

/** A template's remembered choices that still apply: accounts and categories that no longer exist are left to the defaults. A remembered category counts as the person's choice. */
export function templateChoices(template: Pick<CsvTemplate, "accounts" | "categories">, accounts: AccountOption[], categories: {
  id: string;
}[]) {
  const accountIds = new Set(accounts.map(account => account.id));
  const categoryIds = new Set(categories.map(category => category.id));
  const targets = new Map<string, TargetChoice>();
  const selections = new Map<string, CategorySelection>();

  for (const [source, accountId] of Object.entries(template.accounts)) {
    if (accountIds.has(accountId)) {
      targets.set(source, {
        kind: "existing",
        accountId
      });
    }
  }

  for (const [value, categoryId] of Object.entries(template.categories)) {
    if (categoryIds.has(categoryId)) {
      selections.set(value, {
        action: "existing",
        categoryId
      });
    }
  }

  return {
    targets,
    selections
  };
}

/** The account and category choices a template can remember: existing accounts and categories only, since new ones exist under their own IDs after the import. */
export function rememberedChoices(targets: ReadonlyMap<string, TargetChoice>, selections: ReadonlyMap<string, CategorySelection>) {
  const accounts: Record<string, string> = {};
  const categories: Record<string, string> = {};

  for (const [source, choice] of targets) {
    if (choice.kind === "existing") {
      accounts[source] = choice.accountId;
    }
  }

  for (const [value, selection] of selections) {
    if (selection.action === "existing" && selection.categoryId) {
      categories[value] = selection.categoryId;
    }
  }

  return {
    accounts,
    categories
  };
}

/** Each source's target: the person's choice, else the account the file was dropped on, else the template's remembered account once the accounts are loaded, else the default. Remembered choices are resolved on every render, so they apply whenever the option lists arrive. */
export function resolveTargets(sources: string[], chosen: ReadonlyMap<string, TargetChoice>, preferredAccountId: string | null, remembered: ReadonlyMap<string, TargetChoice>, accounts: AccountOption[]) {
  // A file dropped on an account goes there only when the file names no account itself and the account can take it.
  const preferredAccount = sources.length === 1 && sources[0] === "" ? accounts.find(account => account.id === preferredAccountId) : undefined;
  const preferred: TargetChoice | null = preferredAccount ? {
    kind: "existing",
    accountId: preferredAccount.id
  } : null;

  return new Map(sources.map(source => [source, chosen.get(source) ?? preferred ?? remembered.get(source) ?? defaultTargetChoice(source, accounts)]));
}

/** Each category value's selection: the person's choice, else the template's remembered category, else the default. */
export function resolveCategories(values: CategoryValue[], chosen: ReadonlyMap<string, CategorySelection>, remembered: ReadonlyMap<string, CategorySelection>) {
  return new Map(values.map(value => [value.value, chosen.get(value.value) ?? remembered.get(value.value) ?? defaultCategorySelection(value)]));
}
