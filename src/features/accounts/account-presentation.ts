import { Temporal } from "temporal-polyfill";
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

/** A problem that stops a bank account from syncing and needs the user, such as reconnecting; archived accounts are not synced, so they have none. */
export type AccountProblem = {
  kind: "expired";
  since: string;
} | {
  kind: "sync_error";
  message: string;
};

export function accountProblem(account: {
  provider: string;
  requisition_id: string | null;
  valid_until: string | null;
  sync_error: string | null;
  archived_at: string | null
}, now: Temporal.Instant): AccountProblem | null {
  if (account.provider === "manual" || account.archived_at || !account.requisition_id) {
    return null;
  }

  if (account.valid_until && Temporal.Instant.compare(Temporal.Instant.from(account.valid_until), now) <= 0) {
    return {
      kind: "expired",
      since: account.valid_until
    };
  }

  return account.sync_error ? {
    kind: "sync_error",
    message: account.sync_error
  } : null;
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
