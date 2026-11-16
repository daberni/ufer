"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useEffect, useId, type RefObject } from "react";
import styles from "./sync-problem-details.module.css";
import { ArrowRight, TriangleAlert, X } from "lucide-react";
import { TraceId } from "@/components/ui/trace-id";
import type { SyncProblem } from "@/features/banking/use-sync-status";

type Props = {
  id: string;
  // The details close on outside interaction; the boundary also contains the badge that toggles them.
  boundary: RefObject<HTMLElement | null>;
  problem: SyncProblem;
  onClose: (restoreFocus: boolean) => void;
  onDismiss: () => void;
  onOpenConnections: () => void;
};

export function SyncProblemDetails({
  id,
  boundary,
  problem,
  onClose,
  onDismiss,
  onOpenConnections
}: Props) {
  const titleId = useId();

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!boundary.current?.contains(event.target as Node)) {
        onClose(false);
      }
    }

    // An open modal dialog owns Escape.
    function closeOnEscape(event: KeyboardEvent) {
      const modalOpen = document.querySelector("dialog[open]") !== null;

      if (event.key !== "Escape" || event.defaultPrevented || modalOpen) {
        return;
      }

      const focusInside = boundary.current?.contains(document.activeElement) ?? false;

      onClose(focusInside);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [boundary, onClose]);

  return (
    <div
      id={id}
      className={styles["details"]}
      role="region"
      aria-labelledby={titleId}
    >
      <div className={styles["heading"]}>
        <span className={styles["icon"]}>
          <TriangleAlert size={16} />
        </span>
        <strong id={titleId} className={styles["title"]}>
          {problem.title}
        </strong>
        <button
          type="button"
          className={clsx(ui["icon-button"], styles["dismiss"])}
          aria-label="Dismiss sync warning"
          onClick={onDismiss}
        >
          <X size={14} />
        </button>
      </div>
      <div className={styles["body"]}>
        {problem.failures.length > 0 && (
          <ul className={styles["failures"]}>
            {problem.failures.map(failure => (
              <li key={`${failure.account}: ${failure.message}`} className={styles["failure"]}>
                <strong className={styles["account"]}>{failure.account}</strong>
                <span className={styles["message"]}>{failure.message}</span>
              </li>
            ))}
          </ul>
        )}
        <p className={styles["note"]}>{problem.note}</p>
        <TraceId id={problem.traceId} />
        {problem.failures.some(failure => failure.reconnect) && (
          <button type="button" className={clsx(ui["text-button"], styles["connections"])} onClick={onOpenConnections}>
            Reconnect in Bank connections
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
