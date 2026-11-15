import { ArrowDownLeft, Building2, CreditCard, HandCoins, Landmark, LayoutDashboard, Link2, PiggyBank, SlidersHorizontal, ChartNoAxesCombined, Wallet } from "lucide-react";
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

export function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short"
  }).format(new Date(value)) : "No balance yet";
}

export function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}-01T12:00:00Z`));
}

export function periodLabel(period: Period) {
  return period.kind === "all" ? "All months" : monthLabel(period.month.toString());
}

function shortMonthLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC"
  }).format(new Date(`${value}-01T12:00:00Z`));
}

/** Labels a month range such as the cash-flow trend window, e.g. "Jun – Nov 2026" or "Dec 2025 – May 2026". */
export function monthRangeLabel(months: string[]) {
  if (!months.length) {
    return "";
  }

  const first = months[0];
  const last = months[months.length - 1];
  const firstYear = first.slice(0, 4);
  const lastYear = last.slice(0, 4);
  const start = firstYear === lastYear ? shortMonthLabel(first) : `${shortMonthLabel(first)} ${firstYear}`;

  return `${start} – ${shortMonthLabel(last)} ${lastYear}`;
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
} | undefined) {
  if (!run) {
    return "No sync yet";
  }

  const status = syncStatusLabels[run.status] || "failed";

  return `Last sync: ${date(run.started_at)} · ${status}`;
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
