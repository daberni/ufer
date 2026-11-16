import { Building2, ChartNoAxesCombined, CreditCard, HandCoins, Landmark, PiggyBank } from "lucide-react";

export const kinds: Record<string, string> = {
  checking: "Current account",
  savings: "Savings account",
  investment: "Investment account",
  loan: "Loan",
  property: "Property",
  credit_card: "Credit card"
};

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
