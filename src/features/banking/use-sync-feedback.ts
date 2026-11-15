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

  const [syncing, setSyncing] = useState(false);

  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);

  const [requestError, setRequestError] = useState("");

  const hasProblem = Boolean(requestError) || Boolean(outcome?.failures.length);

  useEffect(() => {
    if (!open) {
      return;
    }

    // An open modal dialog owns Escape; leave the sync result for after it closes.
    function dismissOnEscape(event: KeyboardEvent) {
      const modalOpen = document.querySelector("dialog[open]") !== null;

      if (event.key === "Escape" && !event.defaultPrevented && !modalOpen) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", dismissOnEscape);

    return () => document.removeEventListener("keydown", dismissOnEscape);
  }, [open]);

  useEffect(() => {
    if (!open || syncing || !outcome || hasProblem) {
      return;
    }

    const timer = window.setTimeout(() => setOpen(false), successDismissDelay);

    return () => window.clearTimeout(timer);
  }, [open, syncing, outcome, hasProblem]);

  async function sync() {
    // Progress is shown on the button only; the popover opens once there is a result.
    setOpen(false);
    setSyncing(true);
    setOutcome(null);
    setRequestError("");

    // Failures are reported in the popover, so they are not rethrown into the page-level error banner.
    try {
      await perform(async () => {
        try {
          setOutcome(await api<SyncOutcome>("sync", {}));
        } catch (error) {
          setRequestError(error instanceof Error ? error.message : "Request failed.");
        }
      });
    } finally {
      setSyncing(false);
      setOpen(true);
    }
  }

  function dismiss() {
    setOpen(false);
  }

  return {
    open,
    syncing,
    outcome,
    requestError,
    hasProblem,
    sync,
    dismiss
  };
}
