import { ArrowDownLeft, LayoutDashboard, Link2, SlidersHorizontal, Wallet, type LucideIcon } from "lucide-react";
import type { View } from "@/client/dashboard-location";

export type NavigationItem = {
  id: View;
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
  id: "rules",
  label: "Categories & rules",
  mobileLabel: "Rules",
  heading: "Categories & rules",
  description: "Less sorting. More clarity.",
  icon: SlidersHorizontal
}, {
  id: "connections",
  label: "Bank connections",
  mobileLabel: "Banks",
  heading: "Bank connections",
  description: "Connect your banks and keep track of their authorizations.",
  icon: Link2
}];
