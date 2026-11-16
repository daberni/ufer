"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId } from "react";
import styles from "./sync-problem-details.module.css";
import { ArrowRight, TriangleAlert, X } from "lucide-react";
import type { SyncProblem } from "@/features/banking/use-sync-status";

type Props = {
  id: string;
  problem: SyncProblem;
  onDismiss: () => void;
  onOpenConnections: () => void;
};

export function SyncProblemDetails({
  id,
  problem,
  onDismiss,
  onOpenConnections
}: Props) {
  const titleId = useId();

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
