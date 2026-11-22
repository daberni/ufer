import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { HttpError, ValidationError } from "@/lib/errors";
import { formatCount } from "@/lib/locale";
import { currentFormatLocale } from "@/server/http/request-locale";
import { carriedCategory, carriedText, duplicateSearchDays, keptCopy } from "@/features/transactions/duplicate-resolution";
import type { DuplicateCandidates } from "@/features/transactions/types";
import { readDuplicateCandidates, resolveDuplicate, type Copy, type DuplicateResult } from "./duplicate-repository";

/** The bookings a person can name this one a duplicate of, each with which booking would stay and whether the other is deleted. Several candidates are all offered; none is chosen for the person. */
export async function duplicateCandidates(id: string): Promise<DuplicateCandidates> {
  const found = await readDuplicateCandidates(id);

  if (!found) {
    throw new HttpError(404, "Transaction not found.");
  }

  return {
    candidates: found.candidates.map(candidate => {
      const outcome = keptCopy(found.subject, candidate);

      return {
        id: candidate.id,
        date: candidate.date,
        counterparty: candidate.counterparty,
        description: candidate.description,
        keeps_candidate: outcome.kept === candidate,
        deletes_other: outcome.deleted
      };
    })
  };
}

const duplicateInput = z.object({
  duplicate_of: z.string().min(1)
}).strict();

function decide(subject: Copy, original: Copy) {
  const {
    kept,
    removed,
    deleted
  } = keptCopy(subject, original);

  return {
    kept,
    removed,
    deleted,
    category: carriedCategory(kept, removed),
    text: carriedText(kept, removed)
  };
}

/** Resolves a booking as a duplicate of the one a person named: a CSV-imported copy beside a bank copy is deleted, otherwise the better-described copy stays; the other copy is deleted when it came from a CSV import and hidden otherwise. The kept copy takes over a manual category and better text. */
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
    throw new HttpError(409, "The booking that would be removed is split. Remove its split before resolving the duplicate.");
  }

  if (result === "entered") {
    throw new ValidationError("A booking entered in Ufer can be deleted instead.");
  }

  if (result === "not_a_candidate") {
    throw new ValidationError(`Choose a booking with the same amount and currency on the same account, at most ${formatCount(duplicateSearchDays, await currentFormatLocale())} days apart.`);
  }
}
