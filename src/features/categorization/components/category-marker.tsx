import styles from "./category-marker.module.css";
import { isCategoryIcon } from "@/features/categorization/category-icons";
import { categoryTileColors, themedColors } from "@/features/categorization/category-colors";
import { categoryIconComponents } from "./category-icon-components";

type Props = {
  icon: string | null;
  color: string;
};

// A small tile for the spending breakdown, whose rows pair it with a colored bar, and for the options of the category select; elsewhere a category is shown as a CategoryChip.
// Decorative only: the marker always accompanies the category name, which remains the accessible label.
export function CategoryMarker({
  icon,
  color
}: Props) {
  const colors = themedColors(scheme => categoryTileColors(color, scheme));

  if (!isCategoryIcon(icon)) {
    return (
      <span
        aria-hidden="true"
        className={styles["tile"]}
        style={{
          background: colors.swatch
        }}
      />
    );
  }

  const Icon = categoryIconComponents[icon];

  return (
    <span
      aria-hidden="true"
      className={styles["tile"]}
      style={{
        background: colors.tile,
        color: colors.icon
      }}
    >
      <Icon size={11} strokeWidth={2.2} />
    </span>
  );
}
