"use client";

import { useEffect, useState } from "react";
import { api } from "@/client/api";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

export type SyncOutcome = {
  inserted: number;
  failures: string[];
};

const successDismissDelay = 8000;

export function useSyncFeedback(perform: DashboardController["perform"]) {
  const [open, setOpen] = useState(false);

  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);

  const [requestError, setRequestError] = useState("");

  const hasProblem = Boolean(requestError) || Boolean(outcome?.failures.length);

  useEffect(() => {
    if (!open) {
      return;
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", dismissOnEscape);

    return () => document.removeEventListener("keydown", dismissOnEscape);
  }, [open]);

  useEffect(() => {
    if (!outcome || hasProblem) {
      return;
    }

    const timer = window.setTimeout(() => setOpen(false), successDismissDelay);

    return () => window.clearTimeout(timer);
  }, [outcome, hasProblem]);

  async function sync() {
    setOpen(true);
    setOutcome(null);
    setRequestError("");

    // Failures are reported in the popover, so they are not rethrown into the page-level error banner.
    await perform(async () => {
      try {
        setOutcome(await api<SyncOutcome>("sync", {}));
      } catch (error) {
        setRequestError(error instanceof Error ? error.message : "Request failed.");
      }
    });
  }

  function dismiss() {
    setOpen(false);
  }

  return {
    open,
    outcome,
    requestError,
    hasProblem,
    sync,
    dismiss
  };
}
