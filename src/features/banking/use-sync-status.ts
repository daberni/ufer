"use client";

import { useEffect, useRef, useState } from "react";
import { settle, type ActionResult } from "@/features/dashboard/use-dashboard";
import { useSync, type SyncFailure, type SyncOutcome } from "./mutations";

// A sync that did not fully succeed stays reported until it is dismissed or a later sync succeeds.
export type SyncProblem = {
  title: string;
  buttonLabel: string;
  note: string;
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
  const syncMutation = useSync();

  const [status, setStatus] = useState<SyncStatus>(idleStatus);

  const running = useRef(false);

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
    if (running.current) {
      return;
    }

    running.current = true;
    setStatus(current => ({
      ...current,
      phase: "syncing",
      politeAnnouncement: "Syncing transactions …",
      assertiveAnnouncement: ""
    }));

    // The mutation refreshes the synced data, including the last sync run, before it settles.
    const result = await settle(syncMutation.mutateAsync());

    running.current = false;
    setStatus(completedStatus(result));
  }

  function dismissProblem() {
    setStatus(current => ({
      ...current,
      problem: null,
      assertiveAnnouncement: ""
    }));
  }

  return {
    ...status,
    sync,
    dismissProblem
  };
}

function completedStatus(result: ActionResult<SyncOutcome>): SyncStatus {
  if (!result.ok) {
    return {
      ...idleStatus,
      problem: {
        title: "Sync failed",
        buttonLabel: "last sync failed",
        note: result.message,
        failures: []
      },
      assertiveAnnouncement: `Sync failed: ${result.message}`
    };
  }

  const {
    inserted,
    failures
  } = result.value;
  const transactions = `${inserted} new ${inserted === 1 ? "transaction" : "transactions"}`;

  if (failures.length) {
    const failedAccounts = `${failures.length} ${failures.length === 1 ? "account" : "accounts"} failed`;

    return {
      ...idleStatus,
      problem: {
        title: failedAccounts,
        buttonLabel: failedAccounts,
        note: `${transactions} synced.`,
        failures
      },
      assertiveAnnouncement: `Sync finished with problems: ${failedAccounts}. ${transactions} synced.`
    };
  }

  return {
    ...idleStatus,
    phase: "synced",
    resultLabel: inserted ? `${inserted} new` : "Up to date",
    politeAnnouncement: inserted ? `Sync complete: ${transactions}.` : "Sync complete: everything is up to date."
  };
}
