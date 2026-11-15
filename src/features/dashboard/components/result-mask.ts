import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import type { ResultStatus } from "@/features/dashboard/use-dashboard-data";

/** Masks result content that does not match the selected filters: pulsing while loading, static when the load failed. */
export function resultMask(status: ResultStatus) {
  return clsx(status !== "ready" && ui["skeleton"], status === "unavailable" && ui["skeleton-unavailable"]);
}
