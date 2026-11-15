import styles from "./category-marker.module.css";
import { clsx } from "clsx";
import { ArrowLeftRight, Banknote, Car, GraduationCap, Gift, HeartPulse, House, PiggyBank, Plane, Receipt, ShoppingBag, ShoppingBasket, Tag, Ticket, UtensilsCrossed, Zap, type LucideIcon } from "lucide-react";
import { isCategoryIcon, type CategoryIconKey } from "@/features/categorization/category-icons";
import { categoryTileColors } from "@/features/categorization/category-colors";

export const categoryIconComponents: Record<CategoryIconKey, LucideIcon> = {
  groceries: ShoppingBasket,
  dining: UtensilsCrossed,
  transport: Car,
  housing: House,
  utilities: Zap,
  health: HeartPulse,
  shopping: ShoppingBag,
  entertainment: Ticket,
  travel: Plane,
  education: GraduationCap,
  gifts: Gift,
  fees: Receipt,
  income: Banknote,
  savings: PiggyBank,
  transfer: ArrowLeftRight,
  other: Tag
};

type Props = {
  icon: string | null;
  color: string;
  size?: "small" | "medium" | "large";
};

const iconSizes = {
  small: 11,
  medium: 13,
  large: 22
};

// Decorative only: the marker always accompanies the category name, which remains the accessible label.
export function CategoryMarker({
  icon,
  color,
  size = "medium"
}: Props) {
  const colors = categoryTileColors(color);

  if (!isCategoryIcon(icon)) {
    return (
      <span
        aria-hidden="true"
        className={clsx(styles["tile"], styles[size])}
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
      className={clsx(styles["tile"], styles[size])}
      style={{
        background: colors.tile,
        color: colors.icon
      }}
    >
      <Icon size={iconSizes[size]} strokeWidth={2.2} />
    </span>
  );
}
