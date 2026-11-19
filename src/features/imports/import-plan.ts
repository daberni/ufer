import { categoryNameKey } from "@/lib/category-name";
import { categoryTags, currencyAllows, parseAmount, splitCurrency, type DecimalSeparator, type MappedRow } from "./csv-mapping";
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

/** An existing account named like the source value is preselected; otherwise the person chooses. */
export function defaultTargetChoice(source: string, accounts: AccountOption[]): TargetChoice {
  const match = source ? accounts.find(account => categoryNameKey(account.name) === categoryNameKey(source)) : undefined;

  if (match) {
    return {
      kind: "existing",
      accountId: match.id
    };
  }

  return {
    kind: "unset"
  };
}

export function newAccountChoice(source: string): TargetChoice {
  return {
    kind: "new",
    name: source,
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

export type PreparedImport = {
  rows: MappedRow[];
  targets: ImportTarget[];
  categories: CategoryChoice[];
  /** Rows of sources the person skipped. */
  skipped: number;
  /** What still blocks a check, in the order the page shows it. */
  problems: string[];
};

/** Turns the page's choices into the import request: skipped sources drop their rows, and a new account's opening balance is dated on its first row. */
export function prepareImport(rows: MappedRow[], choices: ReadonlyMap<string, TargetChoice>, accounts: AccountOption[], selections: ReadonlyMap<string, CategorySelection>, decimal: DecimalSeparator): PreparedImport {
  const targets: ImportTarget[] = [];
  const problems: string[] = [];
  const kept = rows.filter(row => choices.get(row.source)?.kind !== "skip");

  for (const { source } of sourceAccounts(rows)) {
    const choice = choices.get(source) ?? {
      kind: "unset"
    };
    const label = source ? `“${source}”` : "the rows";

    if (choice.kind === "skip") {
      continue;
    }

    if (choice.kind === "unset") {
      problems.push(`Choose an account for ${label}.`);

      continue;
    }

    if (choice.kind === "existing") {
      const account = accounts.find(item => item.id === choice.accountId);

      if (!account) {
        problems.push(`Choose an account for ${label}.`);

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
      problems.push(`Name the new account for ${label}.`);
    }

    if (!/^[A-Z]{3}$/.test(choice.currency)) {
      problems.push(`Enter a three-letter currency code for ${label}.`);
    }

    if (choice.balance.trim() && balance === null) {
      problems.push(`Enter the balance for ${label} as a number.`);
    }

    const balanceCurrency = splitCurrency(choice.balance.trim()).currency;

    // The amount is stored in the account currency, so a balance stated in another currency must not be relabelled.
    if (balance !== null && balanceCurrency && !currencyAllows(balanceCurrency, choice.currency)) {
      problems.push(`Enter the balance for ${label} in ${choice.currency}.`);
    }

    const firstDate = kept.filter(row => row.source === source).map(row => row.date).sort()[0];

    targets.push({
      source,
      accountId: null,
      currency: choice.currency,
      newAccount: {
        name,
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
