import { Temporal } from "temporal-polyfill";
import { Building2, ChartNoAxesCombined, CreditCard, HandCoins, Landmark, PiggyBank } from "lucide-react";

export const kinds: Record<string, string> = {
  checking: "Current account",
  savings: "Savings account",
  investment: "Investment account",
  brokerage: "Brokerage account",
  loan: "Loan",
  property: "Property",
  credit_card: "Credit card"
};

export function accountIcon(kind: string) {
  switch (kind) {
    case "property":
      return Building2;
    case "investment":
    case "brokerage":
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

/**
 * Where an account's data comes from and how its sync stands, in the one vocabulary every account view uses: a bank-linked account names its institution
 * (never the provider) and its sync state; an account without a bank connection is "Manual". Archived accounts are not synced, so they only say so.
 */
export type AccountSource = {
  label: string;
  state: {
    kind: "synced";
    at: string;
  } | {
    kind: "pending" | "attention" | "error" | "archived" | "manual";
  };
};

export function accountSource(account: {
  provider: string;
  institution: string | null;
  requisition_id: string | null;
  last_synced_at: string | null;
  valid_until: string | null;
  sync_error: string | null;
  archived_at: string | null
}, now: Temporal.Instant): AccountSource {
  const manual = account.provider === "manual";
  const label = manual ? "Manual" : account.institution ?? "Bank";

  if (account.archived_at) {
    return {
      label,
      state: {
        kind: "archived"
      }
    };
  }

  if (manual) {
    return {
      label,
      state: {
        kind: "manual"
      }
    };
  }

  const problem = accountProblem(account, now);

  if (problem?.kind === "sync_error") {
    return {
      label,
      state: {
        kind: "error"
      }
    };
  }

  // An expired authorization or a bank account whose connection was removed both need the user to reconnect.
  if (problem || !account.requisition_id) {
    return {
      label,
      state: {
        kind: "attention"
      }
    };
  }

  // A connected account before its first sync has nothing to vouch for yet, so it stays neutral.
  if (account.last_synced_at === null) {
    return {
      label,
      state: {
        kind: "pending"
      }
    };
  }

  return {
    label,
    state: {
      kind: "synced",
      at: account.last_synced_at
    }
  };
}
