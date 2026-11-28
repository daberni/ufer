"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, X } from "lucide-react";
import styles from "./file-import-page.module.css";
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
import { useTranslations } from "next-intl";

/** The full-page file import: file, accounts, columns and categories, then a check and the import. */
export function FileImportPage() {
  const t = useTranslations("imports.page");
  const draft = useImportDraft();
  const [reviewing, setReviewing] = useState(false);
  const load = draft.load;

  // A file chosen in the dialog or dropped elsewhere opens here already loaded; opened directly, the page shows its own drop zone.
  useEffect(() => {
    const pending = takeImportFile();

    if (pending) {
      void load(pending.file, pending.accountId);
    }
  }, [load]);
  const loaded = draft.file && (draft.settings || draft.statement);

  if (draft.imported) {
    return (
      <div className={styles["page"]}>
        <section className={clsx(ui["panel"], styles["done"])} aria-labelledby="import-done">
          <CircleCheck size={32} aria-hidden="true" />
          <h2 id="import-done">
            {t("imported", {
              count: draft.imported.newRows
            })}
          </h2>
          {draft.imported.updatedRows > 0 && (
            <p>
              {t("updated", {
                count: draft.imported.updatedRows
              })}
            </p>
          )}
          {draft.imported.undecided.length > 0 && (
            <p className={ui["form-hint"]}>
              {t("undecided", {
                count: draft.imported.undecided.length
              })}
            </p>
          )}
          <p className={ui["form-hint"]}>{t("importedHint")}</p>
          <div className={ui["button-group"]}>
            <Link className={clsx(ui["button"], ui["primary"])} href={viewPaths.transactions}>
              {t("viewTransactions")} <ArrowRight size={16} />
            </Link>
            <button type="button" className={ui["button"]} onClick={draft.clear}>{t("importAnother")}</button>
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
        {t("cancel")}
      </Link>
      <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-file">
        <h2 id="import-file">{t("file")}</h2>
        {loaded ? <FileCard draft={draft} /> : <FileDropZone disabled={draft.inputsLocked} onFile={file => void draft.load(file)} />}
        {loaded && draft.table && <TemplateNotice draft={draft} />}
        {draft.fileError && <p className={ui["error-text"]} role="alert">{draft.fileError}</p>}
        {draft.formatError && <p className={ui["error-text"]} role="alert">{draft.formatError}</p>}
        {!loaded && <p className={ui["form-hint"]}>{t("hint")}</p>}
      </section>
      {loaded && (draft.table || draft.statement) && (
        <>
          <TargetAccounts draft={draft} />
          {draft.table && <ColumnPreview draft={draft} reviewing={reviewing} />}
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
