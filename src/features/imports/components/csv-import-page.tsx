"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, X } from "lucide-react";
import styles from "./csv-import-page.module.css";
import { viewPaths } from "@/client/app-location";
import { FileDropZone } from "./file-drop-zone";
import { FileCard } from "./file-card";
import { TargetAccounts } from "./target-accounts";
import { ColumnPreview } from "./column-preview";
import { CategoryChoices } from "./category-choices";
import { TypeChoices } from "./type-choices";
import { ImportSummaryBar } from "./import-summary-bar";
import { MatchReview } from "./match-review";
import { SaveTemplate } from "./save-template";
import { TemplateList } from "./template-list";
import { TemplateNotice } from "./template-notice";
import { useImportDraft } from "./use-import-draft";
import { takeImportFile } from "@/features/imports/pending-import-file";
import { formatCount } from "@/lib/locale";
import { useLocale } from "@/client/locale-provider";

/** The full-page CSV import: file, accounts, columns and categories, then a check and the import. */
export function CsvImportPage() {
  const locale = useLocale();
  const draft = useImportDraft();
  const [reviewing, setReviewing] = useState(false);
  const load = draft.load;

  // A file chosen in the transactions view's dialog opens here already loaded; opened directly, the page shows its own drop zone.
  useEffect(() => {
    const file = takeImportFile();

    if (file) {
      void load(file);
    }
  }, [load]);
  const loaded = draft.file && draft.settings;

  if (draft.imported) {
    return (
      <div className={styles["page"]}>
        <section className={clsx(ui["panel"], styles["done"])} aria-labelledby="import-done">
          <CircleCheck size={32} aria-hidden="true" />
          <h2 id="import-done">{formatCount(draft.imported.newRows, locale)} {draft.imported.newRows === 1 ? "transaction" : "transactions"} imported</h2>
          {draft.imported.updatedRows > 0 && <p>{formatCount(draft.imported.updatedRows, locale)} existing {draft.imported.updatedRows === 1 ? "booking" : "bookings"} updated from the file.</p>}
          {draft.imported.undecided.length > 0 && <p className={ui["form-hint"]}>{formatCount(draft.imported.undecided.length, locale)} possible {draft.imported.undecided.length === 1 ? "duplicate was" : "duplicates were"} left out because the booking chosen for the update changed or was taken by another row.</p>}
          <p className={ui["form-hint"]}>Rules categorized the rows without a chosen category. Importing the same file again updates the bookings it already holds from the file.</p>
          <div className={ui["button-group"]}>
            <Link className={clsx(ui["button"], ui["primary"])} href={viewPaths.transactions}>
              View transactions <ArrowRight size={16} />
            </Link>
            <button type="button" className={ui["button"]} onClick={draft.clear}>Import another file</button>
          </div>
          <SaveTemplate draft={draft} />
        </section>
        <TemplateList templates={draft.templates} disabled={false} onDeleted={draft.forgetTemplate} />
      </div>
    );
  }

  return (
    <div className={styles["page"]}>
      <Link className={clsx(ui["text-button"], styles["back"])} href={viewPaths.transactions}>
        <X size={15} />
        Cancel import
      </Link>
      <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-file">
        <h2 id="import-file">File</h2>
        {loaded ? <FileCard draft={draft} /> : <FileDropZone disabled={draft.inputsLocked} onFile={file => void draft.load(file)} />}
        {loaded && <TemplateNotice draft={draft} />}
        {draft.fileError && <p className={ui["error-text"]} role="alert">{draft.fileError}</p>}
        {draft.formatError && <p className={ui["error-text"]} role="alert">{draft.formatError}</p>}
        {!loaded && <p className={ui["form-hint"]}>Any CSV export with a date and an amount works: bank exports, Buxfer, spreadsheets. Files matching a template, such as Buxfer exports, are mapped automatically. You choose what each column means, check the result, then import. Nothing is saved before you import.</p>}
      </section>
      {loaded && draft.table && (
        <>
          <TargetAccounts draft={draft} />
          <ColumnPreview draft={draft} reviewing={reviewing} />
          {draft.typeOptions.length > 0 && <TypeChoices draft={draft} />}
          {draft.categoryValues.length > 0 && <CategoryChoices draft={draft} />}
          <MatchReview draft={draft} />
          <ImportSummaryBar
            draft={draft}
            reviewing={reviewing}
            onReview={review => {
              setReviewing(review);
              document.getElementById("import-columns")?.scrollIntoView({
                block: "start"
              });
            }}
          />
        </>
      )}
      <TemplateList templates={draft.templates} disabled={draft.inputsLocked} onDeleted={draft.forgetTemplate} />
    </div>
  );
}
