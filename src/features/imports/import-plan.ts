import { categoryNameKey } from "@/lib/category-name";
import { categoryTags, currencyAllows, maxAccountNameLength, parseAmount, splitCurrency, type DecimalSeparator, type MappedRow } from "./csv-mapping";
import type { AccountKind } from "@/features/accounts/account-kinds";
import type { CategoryChoice, ImportTarget } from "./mutations";

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
};

export type CategoryValue = {
  value: string;
  rows: number;
  /** Several tags, such as a Buxfer tag list; the import does not guess one of them. */
  multiTag: boolean;
  /** An existing category with the same name. */
  matchId: string | null;
};

export type CategorySelection = {
  action: CategoryChoice["action"];
  categoryId?: string;
  /** Set once the person picked an option; a multi-tag value needs review until then. */
  chosen: boolean;
};

type AccountOption = {
  id: string;
  name: string;
  currency: string;
};

export function rowCount(count: number) {
  return `${count.toLocaleString("en")} ${count === 1 ? "row" : "rows"}`;
}

/** Distinct source account values with their row counts, in file order; without an account column all rows share the empty source. */
export function sourceAccounts(rows: MappedRow[]): SourceAccount[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
  }

  return [...counts].map(([source, count]) => ({
    source,
    rows: count
  }));
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
  institution: string;
}, accounts: AccountOption[]) {
  const shared = accounts.filter(other => categoryNameKey(other.name) === categoryNameKey(account.name)).length > 1;

  return shared ? `${account.name} (${account.currency} · ${account.institution} · …${account.id.slice(-4)})` : `${account.name} (${account.currency})`;
}

/** A new account named after the source value, shortened to the longest allowed name; the person sees and can edit the prefill. */
export function newAccountChoice(source: string): TargetChoice {
  return {
    kind: "new",
    name: source.slice(0, maxAccountNameLength),
    accountKind: "checking",
    currency: "EUR",
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

  for (const row of rows) {
    if (row.category) {
      counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    }
  }

  return [...counts].map(([value, count]) => ({
    value,
    rows: count,
    multiTag: categoryTags(value).length > 1,
    matchId: byName.get(categoryNameKey(value)) ?? null
  })).sort((left, right) => right.rows - left.rows || left.value.localeCompare(right.value));
}

/** A matching category is used; a multi-tag value is left to the rules until reviewed; any other value creates its category. */
export function defaultCategorySelection(value: CategoryValue): CategorySelection {
  if (value.matchId && !value.multiTag) {
    return {
      action: "existing",
      categoryId: value.matchId,
      chosen: false
    };
  }

  return {
    action: value.multiTag ? "rules" : "create",
    chosen: false
  };
}

export function needsCategoryReview(row: MappedRow, selections: ReadonlyMap<string, CategorySelection>) {
  return row.category !== null && categoryTags(row.category).length > 1 && !selections.get(row.category)?.chosen;
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

/** A missing or invalid input that blocks the check, shown next to that input. */
export type ImportProblem = {
  source: string;
  field: "target" | "name" | "currency" | "balance";
  message: string;
};

/** Turns the page's choices into the import request: skipped sources drop their rows, and a new account's opening balance is dated on its first row. */
export function prepareImport(rows: MappedRow[], choices: ReadonlyMap<string, TargetChoice>, accounts: AccountOption[], selections: ReadonlyMap<string, CategorySelection>, decimal: DecimalSeparator): PreparedImport {
  const targets: ImportTarget[] = [];
  const problems: ImportProblem[] = [];
  const kept = rows.filter(row => choices.get(row.source)?.kind !== "skip");

  for (const { source } of sourceAccounts(rows)) {
    const choice = choices.get(source) ?? {
      kind: "unset"
    };
    const problem = (field: ImportProblem["field"], message: string) => problems.push({
      source,
      field,
      message
    });

    if (choice.kind === "skip") {
      continue;
    }

    if (choice.kind === "unset") {
      problem("target", "Choose an account.");

      continue;
    }

    if (choice.kind === "existing") {
      const account = accounts.find(item => item.id === choice.accountId);

      if (!account) {
        problem("target", "Choose an account.");

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
      problem("name", "Enter a name for the new account.");
    }

    if (name.length > maxAccountNameLength) {
      problem("name", `Use at most ${maxAccountNameLength} characters.`);
    }

    if (!/^[A-Z]{3}$/.test(choice.currency)) {
      problem("currency", "Enter a three-letter code.");
    }

    if (choice.balance.trim() && balance === null) {
      problem("balance", "Enter the balance as a number.");
    }

    if (choice.accountKind === "loan" && balance !== null && Number(balance) > 0) {
      problem("balance", "Enter outstanding debt as a negative balance.");
    }

    const balanceCurrency = splitCurrency(choice.balance.trim()).currency;

    // The amount is stored in the account currency, so a balance stated in another currency must not be relabelled.
    if (balance !== null && balanceCurrency && !currencyAllows(balanceCurrency, choice.currency)) {
      problem("balance", `Enter the balance in ${choice.currency}.`);
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

  const categories = [...selections].map(([value, selection]) => ({
    value,
    action: selection.action,
    categoryId: selection.categoryId
  }));

  return {
    rows: kept,
    targets,
    categories,
    skipped: rows.length - kept.length,
    problems
  };
}
