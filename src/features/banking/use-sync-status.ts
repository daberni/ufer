"use client";

import { useEffect, useRef, useState } from "react";
import { settle, type ActionResult } from "@/client/settle";
import { useIsMutating } from "@tanstack/react-query";
import { syncMutationKey, useSync, type SyncFailure, type SyncOutcome } from "./mutations";
import { useTranslations } from "next-intl";

type SyncMessages = ReturnType<typeof useTranslations<"banking.sync">>;

// A sync that did not fully succeed stays reported until it is dismissed or a later sync succeeds.
export type SyncProblem = {
  title: string;
  buttonLabel: string;
  note: string;
  traceId?: string;
  failures: SyncFailure[];
};

export type SyncPhase = "idle" | "syncing" | "synced";

export type SyncStatus = {
  phase: SyncPhase;
  resultLabel: string;
  problem: SyncProblem | null;
  politeAnnouncement: string;
  assertiveAnnouncement: string;
};

export const syncResultLabelDuration = 3000;

const idleStatus: SyncStatus = {
  phase: "idle",
  resultLabel: "",
  problem: null,
  politeAnnouncement: "",
  assertiveAnnouncement: ""
};

// The sync button presents its own state; other dashboard actions never change it.
export function useSyncStatus() {
  const t = useTranslations("banking.sync");
  const syncMutation = useSync();

  const [status, setStatus] = useState<SyncStatus>(idleStatus);

  const running = useRef(false);

  // A sync started before a remount keeps running in the mutation cache; the button shows it as syncing until it settles.
  const syncInFlight = useIsMutating({
    mutationKey: syncMutationKey
  }) > 0;

  useEffect(() => {
    if (status.phase !== "synced") {
      return;
    }

    const timer = setTimeout(() => {
      setStatus(current => ({
        ...current,
        phase: "idle"
      }));
    }, syncResultLabelDuration);

    return () => clearTimeout(timer);
  }, [status.phase]);

  async function sync() {
    if (running.current || syncInFlight) {
      return;
    }

    running.current = true;
    setStatus(current => ({
      ...current,
      phase: "syncing",
      politeAnnouncement: t("announceSyncing"),
      assertiveAnnouncement: ""
    }));

    // The mutation refreshes the synced data, including the last sync run, before it settles.
    const result = await settle(syncMutation.mutateAsync());

    running.current = false;
    setStatus(completedStatus(result, t));
  }

  function dismissProblem() {
    setStatus(current => ({
      ...current,
      problem: null,
      assertiveAnnouncement: ""
    }));
  }

  const phase = status.phase === "idle" && syncInFlight ? "syncing" : status.phase;

  return {
    ...status,
    phase,
    sync,
    dismissProblem
  };
}

function completedStatus(result: ActionResult<SyncOutcome>, t: SyncMessages): SyncStatus {
  if (!result.ok) {
    return {
      ...idleStatus,
      problem: {
        title: t("failedTitle"),
        buttonLabel: t("failedButton"),
        note: result.failure.message,
        traceId: result.failure.traceId,
        failures: []
      },
      assertiveAnnouncement: t("failedAnnouncement", {
        message: result.failure.message
      })
    };
  }

  const {
    inserted,
    failures
  } = result.value;
  const count = {
    count: inserted
  };

  if (failures.length) {
    const failedAccounts = t("failedAccounts", {
      count: failures.length
    });

    return {
      ...idleStatus,
      problem: {
        title: failedAccounts,
        buttonLabel: failedAccounts,
        note: t("syncedNote", count),
        failures
      },
      assertiveAnnouncement: t("problemsAnnouncement", {
        failed: failedAccounts,
        count: inserted
      })
    };
  }

  return {
    ...idleStatus,
    phase: "synced",
    resultLabel: inserted ? t("newCount", count) : t("upToDate"),
    politeAnnouncement: inserted ? t("completeAnnouncement", count) : t("upToDateAnnouncement")
  };
}
