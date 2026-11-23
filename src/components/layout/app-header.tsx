"use client";

import styles from "./app-header.module.css";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { UserAccess } from "@/features/auth/components/user-access";

type Props = {
  environment: string;
  /** The current view's name. */
  title: string;
};

export function AppHeader({
  environment,
  title
}: Props) {
  const t = useTranslations("shell.header");

  return (
    <header className={styles["topbar"]}>
      <span>
        {t("workspace")} <ChevronRight size={13} />
        <strong>{title}</strong>
      </span>
      <div>
        {environment === "SANDBOX" && <span className={styles["environment-pill"]}>{t("sandbox")}</span>}
        <UserAccess />
      </div>
    </header>
  );
}
