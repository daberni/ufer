"use client";

import { useActionFeedback, type Feedback } from "@/components/ui/use-action-feedback";
import { settle, type ActionResult, type DashboardController } from "@/features/dashboard/use-dashboard";
import { useSync, type SyncOutcome } from "./mutations";

export function useSyncFeedback(view: DashboardController["view"]) {
  const syncMutation = useSync();

  const {
    feedback,
    report,
    dismiss
  } = useActionFeedback(view);

  async function sync() {
    // Progress is shown on the button only; the popover opens once there is a result.
    dismiss();
    const result = await settle(syncMutation.mutateAsync());

    report(syncFeedback(result));
  }

  return {
    syncing: syncMutation.isPending,
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
