"use client";

import ui from "../ui/primitives.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import styles from "./app-sidebar.module.css";
import { ShieldCheck, type LucideIcon } from "lucide-react";
import { BrandIcon } from "@/components/branding/brand-icon";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";
import { useTabNavigation } from "@/client/use-tab-navigation";

export type SidebarLink = {
  id: string;
  label: string;
  mobileLabel: string;
  icon: LucideIcon;
  href: string;
  current: boolean;
  /** Items that need attention, shown as a badge when there are any. */
  count: number;
};

type Props = {
  environment: string;
  /** Where the brand links to. */
  homeHref: string;
  links: SidebarLink[];
};

export function AppSidebar({
  environment,
  homeHref,
  links
}: Props) {
  const locale = useLocale();
  const navigateToTab = useTabNavigation();

  return (
    <aside className={styles["sidebar"]}>
      <Link className={styles["brand"]} href={homeHref}>
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
        {links.map(item => (
          <Link
            key={item.id}
            aria-label={item.label}
            aria-current={item.current ? "page" : undefined}
            className={clsx(styles["nav-item"], item.current ? styles["active"] : "")}
            href={item.href}
            onClick={event => navigateToTab(event, item.href)}
          >
            <item.icon size={18} />
            <span className={styles["nav-full-label"]}>{item.label}</span>
            <span className={styles["nav-mobile-label"]} aria-hidden="true">
              {item.mobileLabel}
            </span>
            {item.count > 0 && <span className={styles["nav-count"]}>{formatCount(item.count, locale)}</span>}
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
