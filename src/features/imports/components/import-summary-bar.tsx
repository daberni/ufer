"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { ArrowDownToLine, ListFilter, SearchCheck, X } from "lucide-react";
import styles from "./import-summary-bar.module.css";
import { FormError } from "@/components/ui/form-error";
import { toFailure } from "@/client/api";
import { useRowIssues } from "./column-preview";
import type { ImportDraft } from "./use-import-draft";

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
            <dd>{value === null ? "–" : value.toLocaleString("en")}</dd>
          </div>
        ))}
      </dl>
      {prepared && prepared.skipped > 0 && <p className={ui["form-hint"]}>{prepared.skipped.toLocaleString("en")} rows of skipped accounts are left out.</p>}
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
            {reviewing ? "Show all rows" : `Review rows (${issues.size.toLocaleString("en")})`}
          </button>
        )}
        {summary ? (
          <button
            type="button"
            className={clsx(ui["button"], ui["primary"], styles["primary"])}
            disabled={pending || summary.newRows === 0}
            onClick={() => draft.run(true)}
          >
            {pending ? "Importing …" : `Import ${summary.newRows.toLocaleString("en")}`}
            <ArrowDownToLine size={16} />
          </button>
        ) : (
          <button
            type="button"
            className={clsx(ui["button"], ui["primary"], styles["primary"])}
            disabled={pending || !ready}
            onClick={() => draft.run(false)}
          >
            {pending ? "Checking …" : `Check ${(prepared?.rows.length ?? 0).toLocaleString("en")} rows`}
            <SearchCheck size={16} />
          </button>
        )}
      </div>
    </section>
  );
}
