"use client";

import { importFileTypes } from "@/features/imports/pending-import-file";
import { clsx } from "clsx";
import { useId, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import styles from "./file-drop-zone.module.css";
import { useTranslations } from "next-intl";

/** A dashed drop area that also opens the file chooser by click or keyboard. */
export function FileDropZone({
  disabled,
  onFile
}: {
  disabled: boolean;
  onFile: (file: File | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();
  const t = useTranslations("imports.dropZone");

  return (
    <div
      className={clsx(styles["zone"], dragging && styles["dragging"])}
      onDragOver={event => {
        event.preventDefault();
        setDragging(!disabled);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => {
        event.preventDefault();
        setDragging(false);

        if (!disabled) {
          onFile(event.dataTransfer.files[0]);
        }
      }}
    >
      <FileUp size={28} aria-hidden="true" />
      <p className={styles["title"]}>
        {t.rich("title", {
          choose: chunks => (
            <button
              type="button"
              className={styles["choose"]}
              disabled={disabled}
              aria-describedby={hintId}
              onClick={() => input.current?.click()}
            >
              {chunks}
            </button>
          )
        })}
      </p>
      <p id={hintId} className={styles["hint"]}>{t("hint", {
        megabytes: 25
      })}</p>
      <input
        ref={input}
        className={styles["input"]}
        type="file"
        accept={importFileTypes}
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={event => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
