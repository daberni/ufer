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
import { ImportSummaryBar } from "./import-summary-bar";
import { SaveTemplate } from "./save-template";
import { TemplateList } from "./template-list";
import { TemplateNotice } from "./template-notice";
import { useImportDraft } from "./use-import-draft";
import { takeImportFile } from "@/features/imports/pending-import-file";

/** The full-page CSV import: file, accounts, columns and categories, then a check and the import. */
export function CsvImportPage() {
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
          <h2 id="import-done">{draft.imported.newRows.toLocaleString("en")} {draft.imported.newRows === 1 ? "transaction" : "transactions"} imported</h2>
          <p className={ui["form-hint"]}>Rules categorized the rows without a chosen category. Importing the same file again skips the rows it already holds.</p>
          <div className={ui["button-group"]}>
            <Link className={clsx(ui["button"], ui["primary"])} href={viewPaths.transactions}>
              View transactions <ArrowRight size={16} />
            </Link>
            <button type="button" className={ui["button"]} onClick={draft.clear}>Import another file</button>
          </div>
          <SaveTemplate draft={draft} />
        </section>
        <TemplateList templates={draft.savedTemplates} disabled={false} />
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
        {!loaded && <p className={ui["form-hint"]}>Any CSV export with a date and an amount works: bank exports, Buxfer, spreadsheets. Buxfer exports and files matching a saved template are mapped automatically. You choose what each column means, check the result, then import. Nothing is saved before you import.</p>}
      </section>
      {loaded && draft.table && (
        <>
          <TargetAccounts draft={draft} />
          <ColumnPreview draft={draft} reviewing={reviewing} />
          {draft.categoryValues.length > 0 && <CategoryChoices draft={draft} />}
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
      <TemplateList templates={draft.savedTemplates} disabled={draft.inputsLocked} />
    </div>
  );
}
