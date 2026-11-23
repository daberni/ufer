import { ArrowDownLeft, ChartCandlestick, LayoutDashboard, SlidersHorizontal, Wallet, type LucideIcon } from "lucide-react";
import type { Section } from "@/client/app-location";

export type NavigationItem = {
  id: Section;
  /** Its label, mobile label, heading and description are in the shell.navigation catalog under this id. */
  icon: LucideIcon;
};

export const navigation: NavigationItem[] = [{
  id: "overview",
  icon: LayoutDashboard
}, {
  id: "transactions",
  icon: ArrowDownLeft
}, {
  id: "accounts",
  icon: Wallet
}, {
  id: "brokerage",
  icon: ChartCandlestick
}, {
  id: "rules",
  icon: SlidersHorizontal
}];
