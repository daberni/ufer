import clsx from "clsx";
import styles from "./select.module.css";
import type { ComponentPropsWithoutRef } from "react";

type Props = ComponentPropsWithoutRef<"select"> & {
  variant?: "default" | "compact" | "bare";
};

export function Select({
  variant = "default",
  className,
  ...props
}: Props) {
  const variantClass = variant === "default" ? undefined : styles[variant];

  return <select className={clsx(styles["select"], variantClass, className)} {...props} />;
}
