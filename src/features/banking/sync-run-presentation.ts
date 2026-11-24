/** The sync history lists this many of the latest runs. */
export const recentSyncRuns = 5;

export type SyncRunTone = "success" | "partial" | "failed" | "running";

const syncRunToneLabels: Record<SyncRunTone, string> = {
  success: "Successful",
  partial: "Partial",
  failed: "Failed",
  running: "Running"
};

/** The readable, sentence-case status of a run. */
export function syncStatusLabel(status: string) {
  return syncRunToneLabels[syncRunTone(status)];
}

/** The status indicator tone of a run; any status other than the known ones ended in failure. */
export function syncRunTone(status: string): SyncRunTone {
  if (status === "SUCCESS") {
    return "success";
  }

  if (status === "PARTIAL") {
    return "partial";
  }

  if (status === "RUNNING") {
    return "running";
  }

  return "failed";
}

/** Splits a run's error log into one problem per line; account failures read "Account: message". */
export function syncRunProblems(error: string | null) {
  return (error ?? "").split("\n").map(line => line.trim()).filter(Boolean);
}
