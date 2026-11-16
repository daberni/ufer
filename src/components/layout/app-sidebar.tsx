"use client";

import ui from "../ui/primitives.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import styles from "./app-sidebar.module.css";
import { ShieldCheck } from "lucide-react";
import { BrandIcon } from "@/components/branding/brand-icon";
import { navigation } from "@/features/dashboard/presentation";
import type { Account } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "view" | "viewHref"> & {
  environment: string;
  /** Bank accounts whose authorization expires soon or has expired. */
  expiring: Account[];
};

export function AppSidebar({
  environment,
  expiring,
  view,
  viewHref
}: Props) {
  return (
    <aside className={styles["sidebar"]}>
      <Link className={styles["brand"]} href={viewHref("overview")}>
        <span className={styles["brand-symbol"]}>
          <BrandIcon />
        </span>
        <span>
          ufer
          <small>ALL IN ONE PLACE.</small>
        </span>
      </Link>
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
          <Link
            key={item.id}
            aria-label={item.label}
            aria-current={view === item.id ? "page" : undefined}
            className={clsx(styles["nav-item"], view === item.id ? styles["active"] : "")}
            href={viewHref(item.id)}
          >
            <item.icon size={18} />
            <span className={styles["nav-full-label"]}>{item.label}</span>
            <span className={styles["nav-mobile-label"]} aria-hidden="true">
              {item.mobileLabel}
            </span>
            {item.id === "connections" && expiring.length > 0 && <span className={styles["nav-count"]}>{expiring.length}</span>}
          </Link>
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
        {environment === "SANDBOX" && (
          <span className={styles["sidebar-foot"]}>
            <span className={ui["status-dot"]} />
            Sandbox · test data
          </span>
        )}
      </div>
    </aside>
  );
}
