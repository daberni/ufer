"use client";

import ui from "../../../components/ui/primitives.module.css";

import { Dialog } from "@/components/ui/dialog";
import { useStartFileImport } from "./use-start-file-import";
import { FileDropZone } from "./file-drop-zone";
import { useTranslations } from "next-intl";

/** Picks the file for an import; choosing one opens the import page with it, closing stays on the current view. */
export function ImportFileDialog({
  close
}: {
  close: () => void;
}) {
  const startImport = useStartFileImport();
  const t = useTranslations("imports");

  return (
    <Dialog eyebrow={t("eyebrow")} title={t("dialog.title")} onClose={close}>
      <div className={ui["form"]}>
        <p className={ui["form-description"]}>{t("dialog.description")}</p>
        <FileDropZone
          disabled={false}
          onFile={file => {
            if (file) {
              startImport(file);
            }
          }}
        />
      </div>
    </Dialog>
  );
}
