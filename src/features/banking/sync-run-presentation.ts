import { Temporal } from "temporal-polyfill";
import { describeDate } from "@/lib/date-format";

/** The sync history lists this many of the latest runs. */
export const recentSyncRuns = 5;

const syncStatusLabels: Record<string, string> = {
  SUCCESS: "successful",
  PARTIAL: "partial",
  RUNNING: "running",
};

export type SyncRunTone = "success" | "partial" | "failed" | "running";

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

export function lastSyncLabel(run: {
  started_at: string;
  status: string
} | undefined, timeZone: string, locale: string) {
  if (!run) {
    return "No sync yet";
  }

  const status = syncStatusLabels[run.status] || "failed";

  return `Last sync: ${describeDate(Temporal.Instant.from(run.started_at).toZonedDateTimeISO(timeZone), locale).label} · ${status}`;
}
