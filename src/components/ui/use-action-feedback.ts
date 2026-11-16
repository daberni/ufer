"use client";

import { useCallback, useEffect, useState } from "react";
import { useDismiss } from "./use-dismiss";

export type Feedback = {
  tone: "success" | "problem";
  messages: string[];
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
  useDismiss({
    active: feedback !== null,
    onDismiss: dismiss
  });

  useEffect(() => {
    if (feedback?.tone !== "success") {
      return;
    }

    const timer = setTimeout(dismiss, successDismissDelay);

    return () => clearTimeout(timer);
  }, [feedback, dismiss]);
}
