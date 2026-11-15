"use client";

import { useEffect, useState } from "react";

export type Feedback = {
  tone: "success" | "problem";
  messages: string[];
};

const successDismissDelay = 8000;

// Transient feedback belongs to its context: a changed resetKey (such as the current view) drops it.
export function useActionFeedback(resetKey?: string) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [scope, setScope] = useState(resetKey);

  if (scope !== resetKey) {
    setScope(resetKey);
    setFeedback(null);
  }

  useEffect(() => {
    if (!feedback) {
      return;
    }

    // An open modal dialog owns Escape; leave the feedback for after it closes.
    function dismissOnEscape(event: KeyboardEvent) {
      const modalOpen = document.querySelector("dialog[open]") !== null;

      if (event.key === "Escape" && !event.defaultPrevented && !modalOpen) {
        setFeedback(null);
      }
    }

    document.addEventListener("keydown", dismissOnEscape);

    return () => document.removeEventListener("keydown", dismissOnEscape);
  }, [feedback]);

  useEffect(() => {
    if (feedback?.tone !== "success") {
      return;
    }

    const timer = setTimeout(() => setFeedback(null), successDismissDelay);

    return () => clearTimeout(timer);
  }, [feedback]);

  function dismiss() {
    setFeedback(null);
  }

  return {
    feedback,
    report: setFeedback,
    dismiss
  };
}
