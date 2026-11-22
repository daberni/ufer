import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { HttpError, ValidationError } from "@/lib/errors";
import { formatCount } from "@/lib/locale";
import { currentFormatLocale } from "@/server/http/request-locale";
import { carriedCategory, duplicateSearchDays, keptCopy } from "@/features/transactions/duplicate-resolution";
import type { DuplicateCandidates } from "@/features/transactions/types";
import { readDuplicateCandidates, resolveDuplicate, type Copy, type DuplicateResult } from "./duplicate-repository";

/** The bookings a person can name this one a duplicate of, each with whether it or this booking would stay. Several candidates are all offered; none is chosen for the person. */
export async function duplicateCandidates(id: string): Promise<DuplicateCandidates> {
  const found = await readDuplicateCandidates(id);

  if (!found) {
    throw new HttpError(404, "Transaction not found.");
  }

  return {
    candidates: found.candidates.map(candidate => ({
      id: candidate.id,
      date: candidate.date,
      counterparty: candidate.counterparty,
      description: candidate.description,
      keeps_candidate: keptCopy(found.subject, candidate).kept === candidate
    }))
  };
}

const duplicateInput = z.object({
  duplicate_of: z.string().min(1)
}).strict();

function decide(subject: Copy, original: Copy) {
  const {
    kept,
    hidden
  } = keptCopy(subject, original);

  return {
    kept,
    hidden,
    category: carriedCategory(kept, hidden)
  };
}

/** Resolves a booking as a duplicate of the one a person named: the better-described copy stays, keeping its category or taking over the other copy's manual category, and the other copy is hidden. */
export async function markDuplicate(id: string, payload: unknown, now = Temporal.Now.instant()) {
  const input = duplicateInput.parse(payload);

  if (input.duplicate_of === id) {
    throw new ValidationError("A booking cannot be a duplicate of itself.");
  }

  await requireResolved(await resolveDuplicate(id, input.duplicate_of, now.toString(), decide));

  return {
    ok: true
  };
}

async function requireResolved(result: DuplicateResult) {
  if (result === "not_found") {
    throw new HttpError(404, "Transaction not found.");
  }

  if (result === "archived_account") {
    throw new HttpError(409, "This account is archived. Restore the account first.");
  }

  if (result === "hidden") {
    throw new HttpError(409, "One of these bookings is hidden. Show it before resolving the duplicate.");
  }

  if (result === "split") {
    throw new HttpError(409, "The less described booking is split. Remove its split before resolving the duplicate.");
  }

  if (result === "entered") {
    throw new ValidationError("A booking entered in Ufer can be deleted instead.");
  }

  if (result === "not_a_candidate") {
    throw new ValidationError(`Choose a booking with the same amount and currency on the same account, at most ${formatCount(duplicateSearchDays, await currentFormatLocale())} days apart.`);
  }
}
