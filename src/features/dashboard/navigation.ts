import { ArrowDownLeft, ChartCandlestick, LayoutDashboard, SlidersHorizontal, Wallet, type LucideIcon } from "lucide-react";
import type { Section } from "@/client/app-location";

export type NavigationItem = {
  id: Section;
  /** The view's name in the sidebar and the header. */
  label: string;
  mobileLabel: string;
  /** The page heading above the view. */
  heading: string;
  description: string;
  icon: LucideIcon;
};

export const navigation: NavigationItem[] = [{
  id: "overview",
  label: "Overview",
  mobileLabel: "Overview",
  heading: "Your money. In perspective.",
  description: "A clear picture is the first step forward.",
  icon: LayoutDashboard
}, {
  id: "transactions",
  label: "Transactions",
  mobileLabel: "Activity",
  heading: "Transactions",
  description: "Every transaction, across all your accounts.",
  icon: ArrowDownLeft
}, {
  id: "accounts",
  label: "Accounts & assets",
  mobileLabel: "Accounts",
  heading: "Accounts & assets",
  description: "Your accounts and assets, together in one place.",
  icon: Wallet
}, {
  id: "brokerage",
  label: "Brokerage",
  mobileLabel: "Brokerage",
  heading: "Brokerage",
  description: "Your depots, holdings and performance together.",
  icon: ChartCandlestick
}, {
  id: "rules",
  label: "Categories & rules",
  mobileLabel: "Rules",
  heading: "Categories & rules",
  description: "Less sorting. More clarity.",
  icon: SlidersHorizontal
}];
