import { ArrowDownLeft, Building2, CreditCard, HandCoins, Landmark, LayoutDashboard, Link2, PiggyBank, SlidersHorizontal, ChartNoAxesCombined, Wallet } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { describeDate, describeMonth } from "@/lib/date-format";
import type { View } from "./types";
import type { Period } from "./period";

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

export function periodLabel(period: Period) {
  return period.kind === "all" ? "All months" : describeMonth(period.month).title;
}

/** Labels a month range such as the cash-flow trend window, e.g. "Jun – Nov 2026" or "Dec 2025 – May 2026". */
export function monthRangeLabel(months: Temporal.PlainYearMonth[]) {
  if (!months.length) {
    return "";
  }

  const first = months[0];
  const last = months[months.length - 1];
  const start = first.year === last.year ? describeMonth(first).label : `${describeMonth(first).label} ${first.year}`;

  return `${start} – ${describeMonth(last).label} ${last.year}`;
}

export function accountIcon(kind: string) {
  switch (kind) {
    case "property":
      return Building2;
    case "investment":
      return ChartNoAxesCombined;
    case "credit_card":
      return CreditCard;
    case "savings":
      return PiggyBank;
    case "loan":
      return HandCoins;
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
  removeConnection: "Remove connection",
  account: "Add account",
  rule: "Create rule",
  balance: "Update balance",
  category: "Add category",
  editCategory: "Edit category",
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

  return `Last sync: ${describeDate(Temporal.Instant.from(run.started_at).toZonedDateTimeISO(timeZone)).label} · ${status}`;
}

export function accountSyncLabel(account: {
  provider: string;
  requisition_id: string | null;
  sync_error: string | null
}) {
  if (account.provider === "manual") {
    return "Manual";
  }

  if (!account.requisition_id) {
    return "Not synced";
  }

  return account.sync_error ? "Check sync" : "Bank-Sync";
}

export function accountSourceLabel(account: {
  provider: string;
  requisition_id: string | null
}) {
  if (account.provider === "manual") {
    return "Manual / import";
  }

  if (!account.requisition_id) {
    return "Enable Banking · not synced";
  }

  return "Enable Banking";
}
