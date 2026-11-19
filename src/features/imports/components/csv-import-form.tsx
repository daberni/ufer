"use client";

import { useRef } from "react";
import { type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { Dialog } from "@/components/ui/dialog";
import { MappedCsvImport, type ImportProgress } from "./mapped-csv-import";

export function CsvImportDialog({
  close
}: DialogFormProps) {
  const progress = useRef<ImportProgress>("idle");

  // A started confirmation owns its import ID and any accounts it created; dismissing would let a reopened dialog import differently.
  function canClose() {
    if (progress.current === "pending") {
      return false;
    }

    return progress.current !== "unfinished" || window.confirm("The import has not finished. Close anyway? Rows saved so far stay imported.");
  }

  return (
    <Dialog
      eyebrow="YOUR FINANCES"
      title="Import CSV"
      onClose={close}
      canClose={canClose}
    >
      <MappedCsvImport
        close={close}
        modeSelect={() => null}
        onProgress={value => {
          progress.current = value;
        }}
      />
    </Dialog>
  );
}
