"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { useFileDrag } from "./use-file-drag";
import { useStartFileImport } from "./use-start-file-import";
import styles from "./file-drop-area.module.css";

/** Starts the file import with a file dropped anywhere on its content, preselecting the given account. */
export function FileDropArea({
  accountId = null,
  className,
  children
}: {
  accountId?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const drop = useFileDropTarget(accountId);

  return (
    <div className={clsx(drop.className, className)} {...drop.handlers}>
      {children}
    </div>
  );
}

/** The class and handlers that make an existing element a drop target for the file import. */
export function useFileDropTarget(accountId: string | null = null) {
  const startImport = useStartFileImport();
  const {
    dragging,
    handlers
  } = useFileDrag({
    disabled: false,
    onFile: file => startImport(file, accountId)
  });

  return {
    className: clsx(styles["area"], dragging && styles["dragging"]),
    handlers
  };
}
