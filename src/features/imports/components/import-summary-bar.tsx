"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { ArrowDownToLine, ListFilter, SearchCheck, X } from "lucide-react";
import styles from "./import-summary-bar.module.css";
import { FormError } from "@/components/ui/form-error";
import { toFailure } from "@/client/api";
import { useRowIssues } from "./column-preview";
import type { ImportDraft } from "./use-import-draft";
import { formatCount } from "@/lib/locale";
import { useLocale } from "@/client/locale-provider";

/** The import's counts, the review filter and the one primary action: check the rows, then import them. */
export function ImportSummaryBar({
  draft,
  reviewing,
  onReview
}: {
  draft: ImportDraft;
  reviewing: boolean;
  onReview: (reviewing: boolean) => void;
}) {
  const locale = useLocale();
  const issues = useRowIssues(draft);
  const {
    summary,
    prepared,
    mapped,
    mutation
  } = draft;
  const errors = summary?.errors.length ?? mapped?.errors.length ?? 0;
  const totals = draft.totals;
  const newRows = summary && totals ? summary.newRows + totals.created : null;
  const updates = totals?.updated ?? 0;
  const undecided = totals?.undecided ?? 0;
  // Missing inputs do not disable the action: pressing it leads to them.
  const ready = draft.accountsReady;
  const pending = mutation.isPending;
  const counts: [string, number | null, string?][] = [
    ["New rows", newRows],
    ["Updates", totals ? updates : null],
    ["Already in Ufer", totals ? totals.unchanged : null],
    ["Undecided duplicates", totals ? undecided : null, "warning"],
    ["Errors", errors, "danger"]
  ];
  const importLabel = updates > 0 ? `Import ${formatCount(newRows ?? 0, locale)}, update ${formatCount(updates, locale)}` : `Import ${formatCount(newRows ?? 0, locale)}`;

  return (
    <section className={clsx(ui["panel"], styles["bar"])} aria-labelledby="import-summary">
      <h2 id="import-summary" className={ui["visually-hidden"]}>Import summary</h2>
      <dl className={styles["counts"]}>
        {counts.map(([label, value, tone]) => (
          <div key={label} className={clsx(styles["count"], tone && value ? styles[tone] : undefined)}>
            <dt>{label}</dt>
            <dd>{value === null ? "–" : formatCount(value, locale)}</dd>
          </div>
        ))}
      </dl>
      {prepared && prepared.skipped > 0 && <p className={ui["form-hint"]}>{formatCount(prepared.skipped, locale)} rows of skipped accounts are left out.</p>}
      {summary && summary.createdCategories.length > 0 && <p className={ui["form-hint"]}>New categories: {summary.createdCategories.join(", ")}.</p>}
      {undecided > 0 && <p className={styles["blocked"]}>Decide what the {formatCount(undecided, locale)} possible {undecided === 1 ? "duplicate does" : "duplicates do"} under Rows before importing.</p>}
      <FormError failure={mutation.error ? toFailure(mutation.error) : null} />
      <div className={styles["actions"]}>
        {(issues.size > 0 || reviewing) && (
          <button
            type="button"
            className={ui["button"]}
            aria-pressed={reviewing}
            onClick={() => onReview(!reviewing)}
          >
            {reviewing ? <X size={15} /> : <ListFilter size={15} />}
            {reviewing ? "Show all rows" : `Review rows (${formatCount(issues.size, locale)})`}
          </button>
        )}
        {summary ? (
          <button
            type="button"
            className={clsx(ui["button"], ui["primary"], styles["primary"])}
            disabled={pending || (newRows ?? 0) + updates + undecided === 0}
            onClick={() => draft.run(true)}
          >
            {pending ? "Importing …" : importLabel}
            <ArrowDownToLine size={16} />
          </button>
        ) : (
          <button
            type="button"
            className={clsx(ui["button"], ui["primary"], styles["primary"])}
            disabled={pending || !ready}
            onClick={() => draft.run(false)}
          >
            {pending ? "Checking …" : `Check ${formatCount(prepared?.rows.length ?? 0, locale)} rows`}
            <SearchCheck size={16} />
          </button>
        )}
      </div>
    </section>
  );
}
