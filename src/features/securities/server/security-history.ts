import type { DatabaseTransaction } from "@/server/database/connection";
import { checkSecurityHistory, type SecurityLeg } from "../transfers";
import { readSecurityLegs, readSplits } from "./security-repository";

export type StoredLeg = Awaited<ReturnType<typeof readSecurityLegs>>[number];

/**
 * Replays a security's history on every account as it would be after `change`, inside the write transaction, so no sale or transfer exceeds what its account held at that point.
 * A transfer's cost and quantity reach into the receiving account, so any change to the security is checked across all accounts.
 */
export async function checkSecurityChange(tx: DatabaseTransaction, securityId: string, change: (legs: StoredLeg[]) => SecurityLeg[]) {
  checkSecurityHistory(change(await readSecurityLegs(tx, [securityId])), await readSplits(tx, securityId));
}
