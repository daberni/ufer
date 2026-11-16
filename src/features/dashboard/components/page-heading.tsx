"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./page-heading.module.css";
import { SyncButton } from "@/features/banking/components/sync-button";
import { navigation, viewDescriptions } from "@/features/dashboard/presentation";
import type { Account, View } from "@/features/dashboard/types";
import { useChangeView } from "@/features/dashboard/use-dashboard-url";

type Props = {
  bankAccounts: Account[];
  view: View;
};

export function PageHeading({
  bankAccounts,
  view
}: Props) {
  const changeView = useChangeView();
  const nav = navigation.find(item => item.id === view)!;

  return (
    <div className={styles["page-heading"]}>
      <div>
        <span className={ui["eyebrow"]}>CLARITY FOR YOUR FINANCES</span>
        <h1>{nav.label === "Overview" ? "Your money. In perspective." : nav.label}</h1>
        <p className={styles["description"]}>{viewDescriptions[view]}</p>
      </div>
      <SyncButton bankAccounts={bankAccounts} showConnections={() => changeView("connections")} />
    </div>
  );
}
