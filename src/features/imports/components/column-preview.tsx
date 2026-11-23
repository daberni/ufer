"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useMemo } from "react";
import styles from "./column-preview.module.css";
import { Select } from "@/components/ui/select";
import type { CsvMapping } from "@/features/imports/csv-mapping";
import { problemProps } from "./field-problem";
import type { ImportDraft } from "./use-import-draft";
import { useTranslations } from "next-intl";

const roles: (keyof CsvMapping)[] = ["date", "payee", "description", "amount", "debit", "credit", "currency", "category", "account", "id", "type"];

const previewRows = 8;

const maxReviewRows = 200;

/** The file's first rows, or the rows needing attention, with one role select per column in the header. */
export function ColumnPreview({
  draft,
  reviewing
}: {
  draft: ImportDraft;
  reviewing: boolean;
}) {
  const t = useTranslations("imports.columns");
  const issues = useRowIssues(draft);
  const table = draft.table;

  if (!table) {
    return null;
  }

  const roleOf = (column: number) => roles.find(field => draft.mapping?.[field] === column) ?? "";
  const indexes = table.rows.map((_row, index) => index);
  const shown = reviewing ? indexes.filter(index => issues.has(table.lines[index])).slice(0, maxReviewRows) : indexes.slice(0, previewRows);
  const keptLines = new Set(draft.keptRows.map(row => row.line));
  const skipped = (line: number) => Boolean(draft.mapped?.rows.some(row => row.line === line)) && !keptLines.has(line);
  const reviewCount = reviewing ? indexes.filter(index => issues.has(table.lines[index])).length : 0;
  const reviewHint = reviewCount > maxReviewRows ? t("reviewHintTruncated", {
    count: reviewCount,
    shown: maxReviewRows
  }) : t("reviewHint", {
    count: reviewCount
  });
  const shownHint = {
    shown: previewRows,
    count: table.rows.length
  };

  return (
    <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-columns">
      <div className={styles["heading"]}>
        <h2 id="import-columns">{reviewing ? t("reviewHeading") : t("heading")}</h2>
        <p className={ui["form-hint"]}>{reviewing ? reviewHint : t("hint")}</p>
      </div>
      {draft.problem && <p id="import-columns-problem" className={styles["problem"]}>{draft.problem}</p>}
      <div
        className={styles["preview"]}
        role="region"
        aria-labelledby="import-columns"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th scope="col" className={styles["line"]}>{t("row")}</th>
              {reviewing && <th scope="col" className={styles["issue"]}>{t("issue")}</th>}
              {table.header.map((column, index) => (
                <th key={index} scope="col">
                  <Select
                    variant="compact"
                    className={clsx(styles["role"], roleOf(index) && styles["assigned"])}
                    aria-label={t("roleOf", {
                      column: column || t("unnamed", {
                        number: index + 1
                      })
                    })}
                    {...index === 0 ? problemProps(draft.problem ? {
                      message: draft.problem
                    } : null, "import-columns-problem") : {}}
                    value={roleOf(index)}
                    disabled={draft.inputsLocked}
                    onChange={event => draft.assignRole(index, (event.target.value || null) as keyof CsvMapping | null)}
                  >
                    <option value="">{t("ignore")}</option>
                    {roles.map(field => <option key={field} value={field}>{t(`roles.${field}`)}</option>)}
                  </Select>
                  <span className={styles["original"]}>{column || t("unnamed", {
                    number: index + 1
                  })}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(index => (
              <tr key={index} className={clsx(!reviewing && issues.has(table.lines[index]) && styles["flagged"], skipped(table.lines[index]) && styles["skipped"])}>
                <td className={styles["line"]}>{table.lines[index]}</td>
                {reviewing && <td className={styles["issue"]}>{issues.get(table.lines[index])}</td>}
                {table.header.map((_column, column) => <td key={column} className={clsx(!roleOf(column) && styles["ignored"])}>{table.rows[index][column] ?? ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!reviewing && table.rows.length > previewRows && <p className={ui["form-hint"]}>{draft.prepared?.skipped ? t("showingFirstSkipped", shownHint) : t("showingFirst", shownHint)}</p>}
    </section>
  );
}

/** Why each line needs attention: errors first, then the check's duplicate findings. */
export function useRowIssues(draft: ImportDraft) {
  const {
    mapped,
    summary
  } = draft;
  const t = useTranslations("imports.columns");

  return useMemo(() => {
    const issues = new Map<number, string>();
    const add = (line: number, reason: string) => {
      if (!issues.has(line)) {
        issues.set(line, reason);
      }
    };

    for (const error of summary?.errors ?? mapped?.errors ?? []) {
      add(error.line, error.message);
    }

    // Rows imported before need no attention; a match with another booking may be a false positive.
    for (const duplicate of summary?.duplicates ?? []) {
      if (duplicate.reason === "existing_booking") {
        add(duplicate.line, t("existingBooking"));
      }
    }

    for (const line of summary?.possibleDuplicates ?? []) {
      add(line, t("possibleDuplicate"));
    }

    return issues;
  }, [mapped, summary, t]);
}
