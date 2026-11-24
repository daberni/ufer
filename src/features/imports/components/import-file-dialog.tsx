"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useRouter } from "next/navigation";
import { importPath } from "@/client/app-location";
import { Dialog } from "@/components/ui/dialog";
import { handOverImportFile } from "@/features/imports/pending-import-file";
import { FileDropZone } from "./file-drop-zone";
import { useTranslations } from "next-intl";

/** Picks the file for an import; choosing one opens the import page with it, closing stays on the current view. */
export function ImportFileDialog({
  close
}: {
  close: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("imports");

  return (
    <Dialog eyebrow={t("eyebrow")} title={t("dialog.title")} onClose={close}>
      <div className={ui["form"]}>
        <p className={ui["form-description"]}>{t("dialog.description")}</p>
        <FileDropZone
          disabled={false}
          onFile={file => {
            if (file) {
              handOverImportFile(file);
              router.push(importPath);
            }
          }}
        />
      </div>
    </Dialog>
  );
}
