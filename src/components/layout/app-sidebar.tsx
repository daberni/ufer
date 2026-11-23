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
import { useTranslations } from "next-intl";

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
  const t = useTranslations("shell.sidebar");
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
          <small>{t("tagline")}</small>
        </span>
      </Link>
      <div className={styles["workspace"]}>
        <span className={styles["workspace-avatar"]}>P</span>
        <div>
          {t("workspace")}<small>{t("workspaceKind")}</small>
        </div>
        <ShieldCheck size={15} />
      </div>
      <span className={styles["nav-label"]}>{t("overviewLabel")}</span>
      <nav aria-label={t("mainNavigation")}>
        {links.map(item => (
          <Link
            key={item.id}
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
            {item.count > 0 && (
              <span className={styles["nav-count"]}>
                {formatCount(item.count, locale)}
                <span className={ui["visually-hidden"]}> {t("needAttention")}</span>
              </span>
            )}
          </Link>
        ))}
      </nav>
      <div className={styles["sidebar-bottom"]}>
        <div className={styles["privacy-note"]}>
          <ShieldCheck size={20} />
          <strong>{t("privacyTitle")}</strong>
          <p>
            {t("selfHosted")}
            <br />
            {t("bankAccess")}
          </p>
        </div>
        {environment === "SANDBOX" && (
          <span className={styles["sidebar-foot"]}>
            <span className={ui["status-dot"]} />
            {t("sandbox")}
          </span>
        )}
      </div>
    </aside>
  );
}
