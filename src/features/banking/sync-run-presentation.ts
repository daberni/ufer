import { Temporal } from "temporal-polyfill";
import { describeDate } from "@/lib/date-format";

const syncStatusLabels: Record<string, string> = {
  SUCCESS: "successful",
  PARTIAL: "partial",
  RUNNING: "running",
};

export function lastSyncLabel(run: {
  started_at: string;
  status: string
} | undefined, timeZone: string) {
  if (!run) {
    return "No sync yet";
  }

  const status = syncStatusLabels[run.status] || "failed";

  return `Last sync: ${describeDate(Temporal.Instant.from(run.started_at).toZonedDateTimeISO(timeZone)).label} · ${status}`;
}
