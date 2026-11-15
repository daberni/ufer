"use client";

import { useSyncExternalStore } from "react";
import { defaultTimeZone } from "@/lib/date-format";

function subscribe() {
  return () => {};
}

function viewerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function serverTimeZone() {
  return defaultTimeZone;
}

// The server snapshot is also used while hydrating, so timestamps switch to the viewer's zone only after mount.
export function useDisplayTimeZone() {
  return useSyncExternalStore(subscribe, viewerTimeZone, serverTimeZone);
}
