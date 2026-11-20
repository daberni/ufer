"use client";

import { clsx } from "clsx";
import { useId, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import styles from "./file-drop-zone.module.css";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";

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
  const locale = useLocale();

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
        Drop a CSV file here or{" "}
        <button
          type="button"
          className={styles["choose"]}
          disabled={disabled}
          aria-describedby={hintId}
          onClick={() => input.current?.click()}
        >
          choose a file
        </button>
      </p>
      <p id={hintId} className={styles["hint"]}>{`CSV or TXT, up to ${formatCount(25, locale)} MB`}</p>
      <input
        ref={input}
        className={styles["input"]}
        type="file"
        accept=".csv,.txt,text/csv"
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
