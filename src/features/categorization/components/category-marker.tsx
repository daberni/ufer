import ui from "../../../components/ui/primitives.module.css";

import { ArrowLeftRight, Banknote, Car, GraduationCap, Gift, HeartPulse, House, PiggyBank, Plane, Receipt, ShoppingBag, ShoppingBasket, Tag, Ticket, UtensilsCrossed, Zap, type LucideIcon } from "lucide-react";
import { isCategoryIcon, type CategoryIconKey } from "@/features/categorization/category-icons";

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
  size?: number;
};

// Decorative only: every icon is rendered next to the category name, which identifies the category.
export function CategoryIcon({
  icon,
  color,
  size = 14
}: Props) {
  if (!isCategoryIcon(icon)) {
    return null;
  }

  const Icon = categoryIconComponents[icon];

  return (
    <Icon
      aria-hidden="true"
      size={size}
      style={{
        color
      }}
    />
  );
}

// Falls back to the color dot for categories without a known icon.
export function CategoryMarker(props: Props) {
  if (!isCategoryIcon(props.icon)) {
    return (
      <i
        className={ui["legend-dot"]}
        style={{
          background: props.color
        }}
      />
    );
  }

  return <CategoryIcon {...props} />;
}
