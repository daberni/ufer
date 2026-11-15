"use client";

import { createContext, useContext } from "react";
import { useDashboard, type DashboardController } from "./use-dashboard";

/** Shares the dashboard controller from the persistent layout with the view routes rendered inside it. */
const DashboardContext = createContext<DashboardController | null>(null);

export function useDashboardController() {
  const dashboard = useContext(DashboardContext);

  if (!dashboard) {
    throw new Error("Dashboard views must be rendered inside the dashboard layout.");
  }

  return dashboard;
}

export function DashboardProvider({ children }: {
  children: React.ReactNode
}) {
  const dashboard = useDashboard();

  return <DashboardContext value={dashboard}>{children}</DashboardContext>;
}
