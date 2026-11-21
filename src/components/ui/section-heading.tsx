"use client";

import ui from "./primitives.module.css";

import { clsx } from "clsx";
import type { ReactNode, Ref } from "react";
import styles from "./section-heading.module.css";
import { shownStatus, valueMask } from "@/components/ui/result-presentation";
import type { Area } from "@/components/ui/use-area-result";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";

type Props = {
  title: string;
  /** How many items the section shows, following its active filters. */
  count: Area<number>;
  /** The section's actions; they share the heading's row and wrap below it on phones. */
  children?: ReactNode;
  /** Controls that scope the section, such as its period; they sit before the actions and take their own row on phones. */
  controls?: ReactNode;
  /** Makes the heading a focus target, for example after the focused row disappears. */
  headingRef?: Ref<HTMLHeadingElement>;
};

export function SectionHeading({
  title,
  count,
  children,
  controls,
  headingRef
}: Props) {
  const locale = useLocale();

  return (
    <div className={styles["section-heading"]}>
      <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
        {`${title} `}
        <span className={clsx(ui["count-badge"], valueMask(shownStatus(count)))}>{formatCount(count.data ?? 0, locale)}</span>
      </h2>
      {(controls || children) && (
        <div className={styles["trailing"]}>
          {controls && <div className={styles["controls"]}>{controls}</div>}
          {children && <div className={clsx(ui["button-group"], styles["actions"])}>{children}</div>}
        </div>
      )}
    </div>
  );
}
