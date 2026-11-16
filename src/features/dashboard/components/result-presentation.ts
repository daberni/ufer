import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import type { Area, AreaResult, ResultStatus } from "@/features/dashboard/use-area-result";

/** How a value of an area is masked: an area without results pulses like one loading new results until its first load fails. */
export function shownStatus(area: Area<unknown>): ResultStatus {
  if (area.status !== "pending") {
    return area.status;
  }

  return area.failure ? "unavailable" : "loading";
}

/** An area's results or, before the first ones, a placeholder of the same shape whose values the component masks. */
export function withPlaceholder<T>(area: Area<T>, placeholder: () => T): AreaResult<T> {
  if (area.status !== "pending") {
    return area;
  }

  return {
    data: placeholder(),
    status: shownStatus(area)
  };
}

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
