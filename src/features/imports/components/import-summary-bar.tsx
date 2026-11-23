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
import { useTranslations } from "next-intl";

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
  const t = useTranslations("imports.summary");
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
    [t("newRows"), newRows],
    [t("updates"), totals ? updates : null],
    [t("unchanged"), totals ? totals.unchanged : null],
    [t("undecided"), totals ? undecided : null, "warning"],
    [t("errors"), errors, "danger"]
  ];
  const importLabel = updates > 0 ? t("importAndUpdate", {
    count: newRows ?? 0,
    updates
  }) : t("import", {
    count: newRows ?? 0
  });

  return (
    <section className={clsx(ui["panel"], styles["bar"])} aria-labelledby="import-summary">
      <h2 id="import-summary" className={ui["visually-hidden"]}>{t("heading")}</h2>
      <dl className={styles["counts"]}>
        {counts.map(([label, value, tone]) => (
          <div key={label} className={clsx(styles["count"], tone && value ? styles[tone] : undefined)}>
            <dt>{label}</dt>
            <dd>{value === null ? "–" : formatCount(value, locale)}</dd>
          </div>
        ))}
      </dl>
      {prepared && prepared.skipped > 0 && (
        <p className={ui["form-hint"]}>{t("skipped", {
          count: prepared.skipped
        })}</p>
      )}
      {summary && summary.createdCategories.length > 0 && (
        <p className={ui["form-hint"]}>{t("newCategories", {
          categories: summary.createdCategories.join(", ")
        })}</p>
      )}
      {undecided > 0 && (
        <p className={styles["blocked"]}>{t("decideFirst", {
          count: undecided
        })}</p>
      )}
      <FormError failure={mutation.error ? toFailure(mutation.error) : null} />
      <div className={styles["actions"]}>
        {draft.table && (issues.size > 0 || reviewing) && (
          <button
            type="button"
            className={ui["button"]}
            aria-pressed={reviewing}
            onClick={() => onReview(!reviewing)}
          >
            {reviewing ? <X size={15} /> : <ListFilter size={15} />}
            {reviewing ? t("showAll") : t("review", {
              count: issues.size
            })}
          </button>
        )}
        {summary ? (
          <button
            type="button"
            className={clsx(ui["button"], ui["primary"], styles["primary"])}
            disabled={pending || (newRows ?? 0) + updates + undecided === 0}
            onClick={() => draft.run(true)}
          >
            {pending ? t("importing") : importLabel}
            <ArrowDownToLine size={16} />
          </button>
        ) : (
          <button
            type="button"
            className={clsx(ui["button"], ui["primary"], styles["primary"])}
            disabled={pending || !ready}
            onClick={() => draft.run(false)}
          >
            {pending ? t("checking") : t("check", {
              count: prepared?.rows.length ?? 0
            })}
            <SearchCheck size={16} />
          </button>
        )}
      </div>
    </section>
  );
}
