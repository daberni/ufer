"use client";

import ui from "@/components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Empty } from "@/components/ui/empty-state";

/** Sits inside the dashboard layout, so the sidebar and header stay usable when a view fails to render. */
export default function DashboardError({
  retry
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <Empty
      title="This page could not be displayed"
      action={<button className={clsx(ui["button"], ui["primary"])} onClick={retry}>Try again</button>}
    >
      Something went wrong while rendering it. Try again or pick another page from the navigation.
    </Empty>
  );
}
