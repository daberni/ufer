"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useRouter } from "next/navigation";
import { importPath } from "@/client/app-location";
import { Dialog } from "@/components/ui/dialog";
import { handOverImportFile } from "@/features/imports/pending-import-file";
import { FileDropZone } from "./file-drop-zone";

/** Picks the file for an import; choosing one opens the import page with it, closing stays on the current view. */
export function ImportFileDialog({
  close
}: {
  close: () => void;
}) {
  const router = useRouter();

  return (
    <Dialog eyebrow="YOUR FINANCES" title="Import file" onClose={close}>
      <div className={ui["form"]}>
        <p className={ui["form-description"]}>Any CSV export with a date and an amount works: bank exports, Buxfer, spreadsheets. Next, you choose what each column means and check the result. Nothing is saved before you import.</p>
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
