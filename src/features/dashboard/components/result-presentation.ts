import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import type { ResultStatus } from "@/features/dashboard/use-area-result";

/** Masks a single value or label that does not match the selected filters: pulsing while loading, static when the load failed. */
export function valueMask(status: ResultStatus) {
  return clsx(status !== "ready" && ui["skeleton"], status === "unavailable" && ui["skeleton-unavailable"]);
}

/** Props for an area, such as a list or chart, whose content does not match the selected filters; whole areas are faded instead of pulsing. */
export function areaProps(status: ResultStatus, className?: string) {
  return {
    className: clsx(className, status === "loading" && ui["area-loading"], status === "unavailable" && ui["area-unavailable"]),
    inert: status !== "ready",
    "aria-busy": status === "loading"
  };
}
