import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/errors";
import { acquireLease, releaseLease } from "./lease-repository";

/** Serializes everything that writes bank-linked bookings and balances: syncs, imports and conflicting user changes. */
export const syncLease = "sync";

/** Runs work while holding the named lease; a held lease is a retryable 409 with the given message, and the lease is released however the work ends. */
export async function withLease<Result>(name: string, conflictMessage: string, work: (owner: string) => Promise<Result>, owner = randomUUID()): Promise<Result> {
  if (!(await acquireLease(name, owner))) {
    throw new HttpError(409, conflictMessage);
  }

  try {
    return await work(owner);
  } finally {
    await releaseLease(name, owner);
  }
}
