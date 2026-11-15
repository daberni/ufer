"use client";

import ui from "../ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./app-sidebar.module.css";
import { ShieldCheck } from "lucide-react";
import { BrandIcon } from "@/components/branding/brand-icon";
import { navigation } from "@/features/dashboard/presentation";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "changeView" | "expiring" | "state" | "view">;

export function AppSidebar({
  changeView,
  expiring,
  state,
  view
}: Props) {
  if (!state) {
    return null;
  }

  return (
    <aside className={styles["sidebar"]}>
      <a className={styles["brand"]} href="/">
        <span className={styles["brand-symbol"]}>
          <BrandIcon />
        </span>
        <span>
          ufer
          <small>ALL IN ONE PLACE.</small>
        </span>
      </a>
      <div className={styles["workspace"]}>
        <span className={styles["workspace-avatar"]}>P</span>
        <div>
          My finances<small>Personal workspace</small>
        </div>
        <ShieldCheck size={15} />
      </div>
      <span className={styles["nav-label"]}>MY OVERVIEW</span>
      <nav>
        {navigation.map(item => (
          <button
            key={item.id}
            aria-label={item.label}
            aria-current={view === item.id ? "page" : undefined}
            className={clsx(styles["nav-item"], view === item.id ? styles["active"] : "")}
            onClick={() => changeView(item.id)}
          >
            <item.icon size={18} />
            <span className={styles["nav-full-label"]}>{item.label}</span>
            <span className={styles["nav-mobile-label"]} aria-hidden="true">
              {item.mobileLabel}
            </span>
            {item.id === "connections" && expiring.length > 0 && <span className={styles["nav-count"]}>{expiring.length}</span>}
          </button>
        ))}
      </nav>
      <div className={styles["sidebar-bottom"]}>
        <div className={styles["privacy-note"]}>
          <ShieldCheck size={20} />
          <strong>Your data. Your perspective.</strong>
          <p>
            Self-hosted.
            <br />
            Bank access through Enable Banking.
          </p>
        </div>
        <span className={styles["sidebar-foot"]}>
          <span className={ui["status-dot"]} />
          {state?.environment === "PRODUCTION" ? "Production data" : "Sandbox · test data"}
        </span>
      </div>
    </aside>
  );
}
