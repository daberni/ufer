"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./rule-form.module.css";

import { Temporal } from "temporal-polyfill";
import { useLocale } from "@/client/locale-provider";
import { describeDate } from "@/lib/date-format";
import { formatCount, formatCountLabel } from "@/lib/locale";
import { signedMoney } from "@/lib/money";
import type { Category, RulePreviewTransaction } from "@/features/categorization/types";
import { CategoryLabel } from "./category-label";

export type RuleMatchList = {
  /** Every transaction the rule decides, manual assignments included. */
  total: number;
  transactions: RulePreviewTransaction[];
};

type Outcome = "changes" | "same" | "manual";

/** What saving and applying the rule would do to a listed transaction's category. */
function outcomeOf(transaction: RulePreviewTransaction, categoryId: string | null, adoptManual: boolean): Outcome {
  if (transaction.manual && !adoptManual) {
    return "manual";
  }

  return categoryId !== null && transaction.category_id === categoryId ? "same" : "changes";
}

const outcomeLabels: Record<Outcome, string> = {
  changes: "Would change",
  same: "Already set",
  manual: "Manual, unchanged"
};

/** The transactions a drafted rule matches, collapsed behind their count. */
export function RuleMatches({
  summary,
  matches,
  categories,
  categoryId,
  adoptManual
}: {
  summary: string;
  matches: RuleMatchList;
  categories: Category[];
  categoryId: string | null;
  adoptManual: boolean;
}) {
  const locale = useLocale();
  const hidden = matches.total - matches.transactions.length;

  return (
    <details>
      <summary className={styles["matches-summary"]}>{summary}</summary>
      <ul className={styles["match-list"]}>
        {matches.transactions.map(transaction => {
          const date = describeDate(Temporal.PlainDate.from(transaction.booking_date), locale);
          const category = categories.find(candidate => candidate.id === transaction.category_id);
          const outcome = outcomeOf(transaction, categoryId, adoptManual);

          return (
            <li key={transaction.id} className={styles["match"]}>
              <time className={styles["match-date"]} dateTime={date.dateTime}>{date.label}</time>
              <span className={styles["match-payee"]}>{transaction.payee || transaction.description || "No payee"}</span>
              <span className={styles["match-amount"]}>{signedMoney(transaction.amount_minor, transaction.currency, locale)}</span>
              <CategoryLabel className={styles["match-category"]} category={category ?? "uncategorized"} />
              <span className={styles[`outcome-${outcome}`]}>{outcomeLabels[outcome]}</span>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <p className={ui["form-hint"]}>{`Showing the newest ${formatCount(matches.transactions.length, locale)}; ${formatCountLabel(hidden, "older transaction is", "older transactions are", locale)} not listed.`}</p>}
    </details>
  );
}
