import { derivedTransactionType, manualAccountTypes, type TransactionType } from "@/lib/transaction-types";
import { createdCounterpart, enteredInUfer, enteredPair, touchesArchived } from "./transfer-rules";
import type { Subject } from "./transfer-subjects";

/** Where a transfer goes: an existing booking on another own account, a manual account on which the counterpart is created, or no counterpart (an account not tracked in Ufer). */
export type TransferTarget = {
  counterpartId: string;
} | {
  accountId: string;
} | null;

export type TypeChangeResult = "saved" | "not_found" | "manual_account_only" | "counterpart_not_found" | "same_account" | "not_a_candidate" | "account_not_found" | "currency_mismatch" | "zero_amount" | "created_counterpart" | "archived_account";

/** The state a type change is decided on. `chosen` is the booking `target.counterpartId` names, if it exists. */
export type TypeChangeFacts = {
  subject: Subject;
  counterpart: Subject | undefined;
  chosen: Subject | undefined;
  type: TransactionType;
  target: TransferTarget | undefined;
};

export type TypeChangeDecision = {
  kind: "reject";
  result: TypeChangeResult;
} | {
  kind: "change_entered_pair";
  counterpart: Subject;
} | {
  kind: "leave_transfer";
} | {
  kind: "keep_link";
  pairAfterwards: boolean;
} | {
  kind: "link_existing";
  counterpartId: string;
} | {
  kind: "link_manual_account";
  accountId: string;
} | {
  kind: "without_counterpart";
};

/**
 * Whether a type change only links or unlinks existing bookings: no booking is created, deleted or moved and no date or amount follows the link. Linking chooses an existing candidate; unlinking returns to the sign's type or keeps a transfer without counterpart.
 */
function relinksWithoutBalanceChange({
  subject,
  counterpart,
  chosen,
  type,
  target
}: TypeChangeFacts) {
  if (enteredInUfer(subject)) {
    return false;
  }

  if (counterpart && enteredInUfer(counterpart)) {
    return false;
  }

  if (type !== "transfer") {
    return counterpart !== undefined && type === derivedTransactionType(subject.amount_minor);
  }

  if (target === null) {
    return counterpart !== undefined;
  }

  if (target === undefined || !("counterpartId" in target)) {
    return false;
  }

  // An entered booking follows the imported booking it is linked with, so its date would change.
  return chosen !== undefined && !enteredInUfer(chosen);
}

/**
 * Decides how a manually chosen type and transfer target apply to an existing booking. `target` undefined keeps a transfer's current link; null means no counterpart, chosen deliberately.
 * Checks that need further reads, such as whether a chosen booking is a link candidate, happen while the decision is carried out.
 */
export function decideTypeChange(facts: TypeChangeFacts): TypeChangeDecision {
  const {
    subject,
    counterpart,
    type,
    target
  } = facts;

  // Archiving freezes balances: only links between existing imported bookings may change while either side's account is archived.
  if (touchesArchived(subject, counterpart) && !relinksWithoutBalanceChange(facts)) {
    return {
      kind: "reject",
      result: "archived_account"
    };
  }

  // On a bank-linked account, the opening balance and adjustments keep their type and no booking becomes one, so syncs keep exactly one opening balance.
  if (subject.account_provider !== "manual" && type !== subject.type && (manualAccountTypes.includes(type) || manualAccountTypes.includes(subject.type))) {
    return {
      kind: "reject",
      result: "manual_account_only"
    };
  }

  if (counterpart && enteredPair(subject, counterpart)) {
    return {
      kind: "change_entered_pair",
      counterpart
    };
  }

  if (type !== "transfer") {
    return {
      kind: "leave_transfer"
    };
  }

  const keepsLink = target === undefined || (target !== null && "counterpartId" in target && target.counterpartId === counterpart?.id);

  // A booking Ufer created on a manual account for an imported booking exists only for that link: it can keep it or be removed, never be retargeted.
  if (counterpart && createdCounterpart(subject) && target !== null && !keepsLink) {
    return {
      kind: "reject",
      result: "created_counterpart"
    };
  }

  if (target === undefined) {
    // Only a booking nobody linked or unlinked is paired automatically; pairing skips manual link decisions.
    return {
      kind: "keep_link",
      pairAfterwards: !subject.transfer_id
    };
  }

  if (target && "counterpartId" in target) {
    return {
      kind: "link_existing",
      counterpartId: target.counterpartId
    };
  }

  if (target && "accountId" in target) {
    return {
      kind: "link_manual_account",
      accountId: target.accountId
    };
  }

  return {
    kind: "without_counterpart"
  };
}
