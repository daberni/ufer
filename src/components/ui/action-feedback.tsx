"use client";

import ui from "./primitives.module.css";

import { clsx } from "clsx";
import styles from "./action-feedback.module.css";
import { Check, CircleHelp, X } from "lucide-react";
import type { Feedback } from "./use-action-feedback";

type Props = {
  feedback: Feedback | null;
  dismissLabel: string;
  onDismiss: () => void;
  // Anchored cards sit below a control inside a positioned wrapper; overlays float above the page.
  placement: "anchored" | "overlay";
  // Announced to screen readers without a visible card, such as progress while an action runs.
  pendingAnnouncement?: string;
};

export function ActionFeedback({
  feedback,
  dismissLabel,
  onDismiss,
  placement,
  pendingAnnouncement = ""
}: Props) {
  const problem = feedback?.tone === "problem";

  const text = feedback?.messages.join(" ") ?? "";

  const politeText = feedback && !problem ? text : pendingAnnouncement;

  const assertiveText = problem ? text : "";

  // Both live regions stay mounted so that changes to their text are announced.
  return (
    <>
      <div className={styles["announcer"]} role="status">
        {politeText}
      </div>
      <div className={styles["announcer"]} role="alert">
        {assertiveText}
      </div>
      {feedback && (
        <div className={clsx(styles["card"], styles[placement], problem && styles["problem"])}>
          <span className={styles["icon"]}>
            {problem ? <CircleHelp size={16} /> : <Check size={16} />}
          </span>
          <div className={styles["text"]}>
            {feedback.messages.map(message => (
              <p key={message}>{message}</p>
            ))}
          </div>
          <button
            type="button"
            className={clsx(ui["icon-button"], styles["dismiss"])}
            aria-label={dismissLabel}
            onClick={onDismiss}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
