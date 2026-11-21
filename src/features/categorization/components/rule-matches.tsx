"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./rule-form.module.css";

import { Temporal } from "temporal-polyfill";
import { useLocale } from "@/client/locale-provider";
import { describeDate } from "@/lib/date-format";
import { formatCount, formatCountLabel } from "@/lib/locale";
import { signedMoney } from "@/lib/money";
import type { Category, RulePreviewTransaction } from "@/features/categorization/types";
import { ArrowRight } from "lucide-react";
import { CategoryLabel } from "./category-label";

export type RuleMatchList = {
  /** Every transaction the rule decides, manual assignments included. */
  total: number;
  /** Matched transactions without a manual category whose category would change. */
  changing: number;
  /** Manual assignments whose category the rule would replace when adopted. */
  manualDiffering: number;
  transactions: RulePreviewTransaction[];
};

type Outcome = "changes" | "overrides" | "same" | "manual";

/** What saving and applying the rule would do to a listed transaction's category. */
function outcomeOf(transaction: RulePreviewTransaction, categoryId: string | null, adoptManual: boolean): Outcome {
  if (transaction.manual && !adoptManual) {
    return "manual";
  }

  if (categoryId !== null && transaction.category_id === categoryId) {
    return "same";
  }

  return transaction.manual ? "overrides" : "changes";
}

const outcomeLabels: Record<Outcome, string> = {
  changes: "Would change",
  overrides: "Overrides manual",
  same: "Already set",
  manual: "Manual, unchanged"
};

/** The transactions a drafted rule matches, collapsed behind their count. */
/** The count line, with how many categories would change; adopted manual assignments count once the option is chosen. */
function matchSummary(matches: RuleMatchList, adoptManual: boolean, locale: string) {
  const changing = matches.changing + (adoptManual ? matches.manualDiffering : 0);
  const total = `Matches ${formatCountLabel(matches.total, "transaction", "transactions", locale)}`;

  return changing === 0 ? `${total}, none would change` : `${total}, ${formatCount(changing, locale)} would change`;
}

export function RuleMatches({
  matches,
  categories,
  categoryId,
  adoptManual
}: {
  matches: RuleMatchList;
  categories: Category[];
  categoryId: string | null;
  adoptManual: boolean;
}) {
  const locale = useLocale();
  const hidden = matches.total - matches.transactions.length;

  return (
    <details>
      <summary className={styles["matches-summary"]}>{matchSummary(matches, adoptManual, locale)}</summary>
      <ul className={styles["match-list"]}>
        {matches.transactions.map(transaction => {
          const date = describeDate(Temporal.PlainDate.from(transaction.date), locale);
          const category = categories.find(candidate => candidate.id === transaction.category_id);
          const outcome = outcomeOf(transaction, categoryId, adoptManual);
          const ruleCategory = categories.find(candidate => candidate.id === categoryId);
          const changing = (outcome === "changes" || outcome === "overrides") && ruleCategory !== undefined;

          return (
            <li key={transaction.id} className={styles["match"]}>
              <time className={styles["match-date"]} dateTime={date.dateTime}>{date.label}</time>
              <span className={styles["match-payee"]}>{transaction.payee || transaction.description || "No payee"}</span>
              <span className={styles["match-amount"]}>{signedMoney(transaction.amount_minor, transaction.currency, locale)}</span>
              <span className={styles["match-category"]}>
                <CategoryLabel category={category ?? "uncategorized"} />
                {changing && (
                  <>
                    <ArrowRight className={styles["arrow"]} size={14} aria-label="to" />
                    <CategoryLabel category={ruleCategory} />
                  </>
                )}
              </span>
              <span className={styles[`outcome-${outcome}`]}>{outcomeLabels[outcome]}</span>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <p className={ui["form-hint"]}>{`Showing the newest ${formatCount(matches.transactions.length, locale)}; ${formatCountLabel(hidden, "older transaction is", "older transactions are", locale)} not listed.`}</p>}
    </details>
  );
}
