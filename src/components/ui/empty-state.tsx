import styles from "./empty-state.module.css";
import type { ReactNode } from "react";
import { BrandIcon } from "@/components/branding/brand-icon";

export function Empty({
  title,
  children,
  action
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles["empty"]}>
      <span className={styles["empty-icon"]}>
        <BrandIcon size={32} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
