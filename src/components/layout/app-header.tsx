"use client";

import styles from "./app-header.module.css";
import { ChevronRight } from "lucide-react";
import { UserAccess } from "@/features/auth/components/user-access";
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
        <UserAccess perform={perform} setLocked={setLocked} />
      </div>
    </header>
  );
}
