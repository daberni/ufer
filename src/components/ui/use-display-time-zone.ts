"use client";

import { useSyncExternalStore } from "react";
import { productTimeZone } from "@/lib/time";

function subscribe() {
  return () => {};
}

function viewerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function serverTimeZone() {
  return productTimeZone;
}

// The server snapshot is also used while hydrating, so the render is deterministic and timestamps switch to the viewer's zone only after mount.
export function useDisplayTimeZone() {
  return useSyncExternalStore(subscribe, viewerTimeZone, serverTimeZone);
}
