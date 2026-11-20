import { decimalAmount, minorUnits } from "@/lib/money";
import type { SplitPartEdit } from "@/features/transactions/mutations";
import type { Transaction } from "@/features/transactions/types";
import { maximumSplitParts, partAmountSupported } from "@/features/transactions/split-limits";

/** A part the person entered; its amount is text in the booking's direction, so an expense's spending is positive. */
export type DraftPart = {
  key: number;
  amount: string;
  categoryId: string | null;
  note: string;
};

/** A split being edited. Parts with an empty or zero amount are ignored and not saved. */
export type SplitDraft = {
  parts: DraftPart[];
  nextKey: number;
};

/** Why the draft cannot be saved as a split yet, or `ready`. A `single` draft is one counted part that covers the booking, which is a plain category. */
export type DraftStatus = "invalid" | "under" | "over" | "single" | "ready";

export type DraftState = {
  /** Each part's signed minor units: 0 for an ignored part, null while its amount is invalid. */
  amounts: (number | null)[];
  /** Assigned by the counted parts, in the booking's direction. */
  assigned: number;
  /** Still to assign, in the booking's direction; negative when the parts exceed the booking. */
  remaining: number;
  status: DraftStatus;
  /** Whether another part fits within the part limit. */
  canAdd: boolean;
};

/** Part amounts are entered in the booking's direction: positive for an expense's spending or an income's receipt. */
function direction(transaction: Pick<Transaction, "amount_minor">) {
  return transaction.amount_minor < 0 ? -1 : 1;
}

/** An existing split's parts, or one part covering the booking with its current category. */
export function initialDraft(transaction: Pick<Transaction, "amount_minor" | "currency" | "split">, categoryId: string | null): SplitDraft {
  const sign = direction(transaction);
  const parts = transaction.split ? transaction.split.parts.map((part, index) => ({
    key: index,
    amount: decimalAmount(part.amount_minor * sign, transaction.currency),
    categoryId: part.category_id,
    note: part.note
  })) : [{
    key: 0,
    amount: decimalAmount(transaction.amount_minor * sign, transaction.currency),
    categoryId,
    note: ""
  }];

  return {
    parts,
    nextKey: parts.length
  };
}

/** A part's signed minor units; 0 when empty or zero, null when invalid or beyond the supported range. */
function partAmount(part: DraftPart, transaction: Pick<Transaction, "amount_minor" | "currency">) {
  if (part.amount.trim() === "") {
    return 0;
  }

  try {
    const amount = minorUnits(part.amount, transaction.currency) * direction(transaction);

    return partAmountSupported(amount) ? amount : null;
  } catch {
    return null;
  }
}

export function draftState(draft: SplitDraft, transaction: Pick<Transaction, "amount_minor" | "currency">): DraftState {
  const sign = direction(transaction);
  const amounts = draft.parts.map(part => partAmount(part, transaction));
  const assigned = amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0) * sign;
  const remaining = transaction.amount_minor * sign - assigned;
  const counted = amounts.filter(amount => amount !== null && amount !== 0).length;
  const canAdd = draft.parts.length < maximumSplitParts;
  let status: DraftStatus = "ready";

  if (amounts.includes(null)) {
    status = "invalid";
  } else if (remaining > 0) {
    status = "under";
  } else if (remaining < 0) {
    status = "over";
  } else if (counted < 2) {
    status = "single";
  }

  return {
    amounts,
    assigned,
    remaining,
    status,
    canAdd
  };
}

/** The counted parts to save, skipping parts with an empty or zero amount; only meaningful for a `ready` draft. */
export function draftEdits(draft: SplitDraft, transaction: Pick<Transaction, "amount_minor" | "currency">): SplitPartEdit[] {
  const state = draftState(draft, transaction);

  return draft.parts.flatMap((part, index) => {
    const amount = state.amounts[index];

    if (!amount) {
      return [];
    }

    return [{
      amount: decimalAmount(amount, transaction.currency),
      category_id: part.categoryId,
      note: part.note.trim()
    }];
  });
}

/** The amount a new part starts with: what is still to assign, or 0 when nothing is. */
export function nextPartAmount(state: DraftState, currency: string) {
  return decimalAmount(Math.max(state.remaining, 0), currency);
}
