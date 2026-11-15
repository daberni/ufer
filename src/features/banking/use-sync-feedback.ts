"use client";

import { useState } from "react";
import { api } from "@/client/api";
import { useActionFeedback, type Feedback } from "@/components/ui/use-action-feedback";
import type { ActionResult, DashboardController } from "@/features/dashboard/use-dashboard";

type SyncOutcome = {
  inserted: number;
  failures: string[];
};

export function useSyncFeedback(perform: DashboardController["perform"], view: DashboardController["view"]) {
  const [syncing, setSyncing] = useState(false);

  const {
    feedback,
    report,
    dismiss
  } = useActionFeedback(view);

  async function sync() {
    // Progress is shown on the button only; the popover opens once there is a result.
    dismiss();
    setSyncing(true);
    const result = await perform(() => api<SyncOutcome>("sync", {}));

    setSyncing(false);
    report(syncFeedback(result));
  }

  return {
    syncing,
    feedback,
    sync,
    dismiss
  };
}

function syncFeedback(result: ActionResult<SyncOutcome>): Feedback {
  if (!result.ok) {
    return {
      tone: "problem",
      messages: [`Sync failed: ${result.message}`]
    };
  }

  const outcome = result.value;
  const transactionLabel = outcome.inserted === 1 ? "transaction" : "transactions";

  return {
    tone: outcome.failures.length ? "problem" : "success",
    messages: [`${outcome.inserted} new ${transactionLabel} synced.`, ...outcome.failures]
  };
}
