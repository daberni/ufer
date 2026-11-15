"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./page-heading.module.css";
import { SyncButton } from "@/features/banking/components/sync-button";
import { viewDescriptions } from "@/features/dashboard/presentation";
import type { Account } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "nav" | "view"> & {
  bankAccounts: Account[];
};

export function PageHeading({
  bankAccounts,
  nav,
  view
}: Props) {
  return (
    <div className={styles["page-heading"]}>
      <div>
        <span className={ui["eyebrow"]}>CLARITY FOR YOUR FINANCES</span>
        <h1>{nav.label === "Overview" ? "Your money. In perspective." : nav.label}</h1>
        <p>{viewDescriptions[view]}</p>
      </div>
      <SyncButton bankAccounts={bankAccounts} view={view} />
    </div>
  );
}
