"use client";

import ui from "../ui/primitives.module.css";

import styles from "./app-header.module.css";
import { ChevronRight, LogOut } from "lucide-react";
import { api } from "@/client/api";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "nav" | "perform" | "setLocked" | "state">;

export function AppHeader({
  nav,
  perform,
  setLocked,
  state
}: Props) {
  if (!state) {
    return null;
  }

  return (
    <header className={styles["topbar"]}>
      <span>
        My finances <ChevronRight size={13} />
        <strong>{nav.label}</strong>
      </span>
      <div>
        <span className={styles["environment-pill"]}>{state?.environment === "PRODUCTION" ? "PRODUCTION" : "SANDBOX"}</span>
        {state?.passwordConfigured && (
          <button
            className={ui["icon-button"]}
            aria-label="Sign out"
            onClick={() => perform(async () => {
              await api("auth/logout", {});
              setLocked(true);
            })}
          >
            <LogOut size={18} />
          </button>
        )}
        <span className={styles["avatar"]}>P</span>
      </div>
    </header>
  );
}
