import ui from "../../../components/ui/primitives.module.css";

import styles from "./category-chip.module.css";
import { clsx } from "clsx";
import { CircleDashed, Pin } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { isCategoryIcon } from "@/features/categorization/category-icons";
import { categoryChipColors, uncategorizedColor } from "@/features/categorization/category-colors";
import { categoryIconComponents } from "./category-icon-components";

export type ChipCategory = {
  name: string;
  color: string;
  icon: string | null;
};

export type CategoryChipSize = "small" | "medium" | "large";

type Props = {
  /** The category to show; null shows the neutral "Uncategorized" chip. */
  category: ChipCategory | null;
  size?: CategoryChipSize;
  /** Marks a manual assignment, which syncing and rule application preserve. */
  manual?: boolean;
  className?: string;
  /** Trailing content inside the chip, such as an edit or dropdown indicator. */
  children?: ReactNode;
};

export const manualAssignmentHint = "Set manually; kept when syncing and applying rules";

function CategoryGlyph({
  category
}: {
  category: ChipCategory | null;
}) {
  if (!category) {
    return <CircleDashed className={styles["icon"]} aria-hidden="true" strokeWidth={2.2} />;
  }

  if (!isCategoryIcon(category.icon)) {
    return <span className={styles["dot"]} aria-hidden="true" />;
  }

  const Icon = categoryIconComponents[category.icon];

  return <Icon className={styles["icon"]} aria-hidden="true" strokeWidth={2.2} />;
}

/** The single presentation of a category: a tinted chip with its icon followed by its name. */
export function CategoryChip({
  category,
  size = "medium",
  manual = false,
  className,
  children
}: Props) {
  const colors = categoryChipColors(category?.color ?? uncategorizedColor);
  const colorVariables = {
    "--chip-background": colors.background,
    "--chip-border": colors.border,
    "--chip-foreground": colors.foreground
  } as CSSProperties;

  return (
    <span className={clsx(styles["chip"], styles[size], className)} style={colorVariables}>
      <CategoryGlyph category={category} />
      <span className={styles["name"]}>{category?.name ?? "Uncategorized"}</span>
      {manual && (
        <span className={styles["manual"]} title={manualAssignmentHint}>
          <Pin className={styles["manual-icon"]} aria-hidden="true" strokeWidth={2.2} />
          <span className={ui["visually-hidden"]}>, set manually</span>
        </span>
      )}
      {children}
    </span>
  );
}
