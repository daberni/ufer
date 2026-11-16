"use client";

import { useCallback, useEffect, useState } from "react";

export type Feedback = {
  tone: "success" | "problem";
  messages: string[];
  /** The trace ID of the server failure behind a problem, shown apart from the messages. */
  traceId?: string;
};

const successDismissDelay = 8000;

/** Feedback for an action, kept by the component that started it. */
export function useActionFeedback() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const dismiss = useCallback(() => {
    setFeedback(null);
  }, []);

  useFeedbackDismissal(feedback, dismiss);

  return {
    feedback,
    report: setFeedback,
    dismiss
  };
}

/** Escape dismisses shown feedback and success dismisses itself after a while; problems stay until dismissed. `dismiss` must be stable. */
export function useFeedbackDismissal(feedback: Feedback | null, dismiss: () => void) {
  useEffect(() => {
    if (!feedback) {
      return;
    }

    // An open modal dialog owns Escape; leave the feedback for after it closes.
    function dismissOnEscape(event: KeyboardEvent) {
      const modalOpen = document.querySelector("dialog[open]") !== null;

      if (event.key === "Escape" && !event.defaultPrevented && !modalOpen) {
        dismiss();
      }
    }

    document.addEventListener("keydown", dismissOnEscape);

    return () => document.removeEventListener("keydown", dismissOnEscape);
  }, [feedback, dismiss]);

  useEffect(() => {
    if (feedback?.tone !== "success") {
      return;
    }

    const timer = setTimeout(dismiss, successDismissDelay);

    return () => clearTimeout(timer);
  }, [feedback, dismiss]);
}
