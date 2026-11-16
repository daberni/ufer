"use client";

import ui from "./primitives.module.css";

import { clsx } from "clsx";
import styles from "./action-feedback.module.css";
import { Check, CircleHelp, X } from "lucide-react";
import { LiveAnnouncements } from "./live-announcements";
import { TraceId } from "./trace-id";
import type { Feedback } from "./use-action-feedback";

type Props = {
  feedback: Feedback | null;
  dismissLabel: string;
  onDismiss: () => void;
  // Anchored cards sit below a control inside a positioned wrapper; overlays float above the page.
  placement: "anchored" | "overlay";
};

export function ActionFeedback({
  feedback,
  dismissLabel,
  onDismiss,
  placement
}: Props) {
  const problem = feedback?.tone === "problem";

  const text = feedback?.messages.join(" ") ?? "";

  return (
    <>
      <LiveAnnouncements polite={problem ? "" : text} assertive={problem ? text : ""} />
      {feedback && (
        <div className={clsx(styles["card"], styles[placement], problem && styles["problem"])}>
          <span className={styles["icon"]}>
            {problem ? <CircleHelp size={16} /> : <Check size={16} />}
          </span>
          <div className={styles["text"]}>
            {feedback.messages.map(message => (
              <p key={message} className={styles["message"]}>
                {message}
              </p>
            ))}
            <TraceId id={feedback.traceId} />
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
