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
import { useFormatLocale } from "@/client/format-locale-provider";

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
  const locale = useFormatLocale();
  const issues = useRowIssues(draft);
  const {
    summary,
    prepared,
    mapped,
    mutation
  } = draft;
  const errors = summary?.errors.length ?? mapped?.errors.length ?? 0;
  const alreadyImported = summary?.duplicates.length ?? 0;
  // Missing inputs do not disable the action: pressing it leads to them.
  const ready = draft.accountsReady;
  const pending = mutation.isPending;
  const counts: [string, number | null, string?][] = [
    ["New rows", summary ? summary.newRows : null],
    ["Already in Ufer", summary ? alreadyImported : null],
    ["Possible duplicates", summary ? summary.possibleDuplicates.length : null, "warning"],
    ["Errors", errors, "danger"]
  ];

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
            disabled={pending || summary.newRows === 0}
            onClick={() => draft.run(true)}
          >
            {pending ? "Importing …" : `Import ${formatCount(summary.newRows, locale)}`}
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
