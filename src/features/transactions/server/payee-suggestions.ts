import { z } from "zod";
import { environment } from "@/features/banking/server/environment";
import { readPayeeUsage, type PayeeUsage } from "./payee-repository";
import type { PayeeSuggestions } from "@/features/transactions/types";

/** Suggestions stay a short list; typing more narrows them. */
export const payeeSuggestionLimit = 8;

const suggestionInput = z.object({
  query: z.string().max(500)
}).strict();

function searchText(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

/** Whether every typed word starts the payee or one of its words, ignoring case and accents. */
function matchesPayee(payee: string, terms: readonly string[]) {
  const text = searchText(payee);
  const words = text.split(/[\s\-.,/&()]+/);

  return terms.every(term => text.startsWith(term) || words.some(word => word.startsWith(term)));
}

function byUse(left: PayeeUsage, right: PayeeUsage) {
  return right.uses - left.uses || right.last_booking_date.localeCompare(left.last_booking_date) || left.payee.localeCompare(right.payee);
}

/** The payees matching the typed text, most frequently used first and, among equally frequent ones, most recently used first. The exact typed text is not suggested again. */
export function suggestPayees(usages: readonly PayeeUsage[], query: string, limit = payeeSuggestionLimit) {
  const typed = query.trim();
  const terms = searchText(typed).split(/\s+/).filter(Boolean);

  if (!terms.length) {
    return [];
  }

  return usages
    .filter(usage => usage.payee !== typed && matchesPayee(usage.payee, terms))
    .sort(byUse)
    .slice(0, limit)
    .map(usage => usage.payee);
}

/** Existing payees of the current environment that match the typed payee. */
export async function readPayeeSuggestions(payload: unknown): Promise<PayeeSuggestions> {
  const { query } = suggestionInput.parse(payload);

  if (!query.trim()) {
    return {
      payees: []
    };
  }

  const usages = await readPayeeUsage(environment());

  return {
    payees: suggestPayees(usages, query)
  };
}
