"use client";

import styles from "./app-header.module.css";
import { ChevronRight } from "lucide-react";
import { UserAccess } from "@/features/auth/components/user-access";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "lock" | "nav" | "reportFeedback"> & {
  environment: string;
};

export function AppHeader({
  environment,
  lock,
  nav,
  reportFeedback
}: Props) {
  return (
    <header className={styles["topbar"]}>
      <span>
        My finances <ChevronRight size={13} />
        <strong>{nav.label}</strong>
      </span>
      <div>
        <span className={styles["environment-pill"]}>{environment === "PRODUCTION" ? "PRODUCTION" : "SANDBOX"}</span>
        <UserAccess lock={lock} reportFeedback={reportFeedback} />
      </div>
    </header>
  );
}
