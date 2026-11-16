import { ArrowLeftRight, Banknote, Car, GraduationCap, Gift, HeartPulse, House, PiggyBank, Plane, Receipt, ShoppingBag, ShoppingBasket, Tag, Ticket, UtensilsCrossed, Zap, type LucideIcon } from "lucide-react";
import type { CategoryIconKey } from "@/features/categorization/category-icons";

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
