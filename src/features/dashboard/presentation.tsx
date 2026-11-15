import { ArrowDownLeft, Building2, CreditCard, Landmark, LayoutDashboard, Link2, SlidersHorizontal, ChartNoAxesCombined, Wallet } from "lucide-react";
import { describeDate } from "@/lib/date-format";
import type { View } from "./types";

export const kinds: Record<string, string> = {
  checking: "Current account",
  savings: "Savings account",
  investment: "Investment account",
  loan: "Loan",
  property: "Property",
  credit_card: "Credit card"
};

export const navigation = [{
  id: "overview" as View,
  label: "Overview",
  mobileLabel: "Overview",
  icon: LayoutDashboard
}, {
  id: "transactions" as View,
  label: "Transactions",
  mobileLabel: "Activity",
  icon: ArrowDownLeft
}, {
  id: "accounts" as View,
  label: "Accounts & assets",
  mobileLabel: "Accounts",
  icon: Wallet
}, {
  id: "rules" as View,
  label: "Categories & rules",
  mobileLabel: "Rules",
  icon: SlidersHorizontal
}, {
  id: "connections" as View,
  label: "Bank connections",
  mobileLabel: "Banks",
  icon: Link2
}];

export function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}-01T12:00:00Z`));
}

export function accountIcon(kind: string) {
  switch (kind) {
    case "property":
      return Building2;
    case "investment":
      return ChartNoAxesCombined;
    case "credit_card":
      return CreditCard;
    default:
      return Landmark;
  }
}

export const viewDescriptions: Record<View, string> = {
  overview: "A clear picture is the first step forward.",
  transactions: "Every transaction, across all your accounts.",
  accounts: "Your accounts and assets, together in one place.",
  rules: "Less sorting. More clarity.",
  connections: "Connect your banks and keep track of their authorizations.",
};

export const modalTitles = {
  bank: "Connect bank",
  account: "Add asset",
  rule: "Create rule",
  balance: "Update balance",
  category: "Add category",
  import: "Import CSV",
};

const syncStatusLabels: Record<string, string> = {
  SUCCESS: "successful",
  PARTIAL: "partial",
  RUNNING: "running",
};

export function lastSyncLabel(run: {
  started_at: string;
  status: string
} | undefined, timeZone: string) {
  if (!run) {
    return "No sync yet";
  }

  const status = syncStatusLabels[run.status] || "failed";

  return `Last sync: ${describeDate(run.started_at, undefined, timeZone).label} · ${status}`;
}

export function accountSyncLabel(account: {
  provider: string;
  sync_error: string | null
}) {
  if (account.provider === "manual") {
    return "Manual";
  }

  return account.sync_error ? "Check sync" : "Bank-Sync";
}
