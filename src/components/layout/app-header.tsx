"use client";

import styles from "./app-header.module.css";
import { ChevronRight } from "lucide-react";
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
  return (
    <header className={styles["topbar"]}>
      <span>
        My finances <ChevronRight size={13} />
        <strong>{title}</strong>
      </span>
      <div>
        {environment === "SANDBOX" && <span className={styles["environment-pill"]}>SANDBOX</span>}
        <UserAccess />
      </div>
    </header>
  );
}
