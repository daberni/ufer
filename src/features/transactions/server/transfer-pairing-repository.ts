import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts, transactions } from "@/server/database/schema";
import { automaticPairingDays, unambiguousPairs, type PairingCandidate } from "./transfer-pairing";
import { allowedByRule, pairable, windowEnd, windowStart } from "./transfer-rules";
import { subjectColumns } from "./transfer-subjects";
import { createCounterpart } from "./transfer-link-repository";

const anchor = alias(transactions, "anchor");
const other = alias(transactions, "other");
const candidate = alias(transactions, "candidate");
const booking = alias(transactions, "booking");

/**
 * Links the bookings of transfers between own accounts that match unambiguously: opposite amounts in the same currency on two own accounts, at most three days apart, with at least one side already a transfer.
 * Bookings with more than one candidate stay unpaired. Returns the number of transfers linked.
 */
export async function pairTransfers(executor: DatabaseTransaction) {
  // The anchor is a transfer; a transfer on the other side is reported once, from its outgoing booking.
  const rows = await executor.all<{
    anchor_id: string;
    anchor_amount: number;
    other_id: string;
  }>(sql`
    SELECT anchor.id AS anchor_id,anchor.amount_minor AS anchor_amount,other.id AS other_id
    FROM transactions anchor
    JOIN accounts anchor_account ON anchor_account.id=anchor.account_id
    JOIN transactions other ON other.date BETWEEN date(anchor.date,${windowStart(automaticPairingDays)}) AND date(anchor.date,${windowEnd(automaticPairingDays)})
      AND other.amount_minor=-anchor.amount_minor
      AND other.currency=anchor.currency
      AND other.account_id<>anchor.account_id
    JOIN accounts other_account ON other_account.id=other.account_id
    WHERE anchor_account.archived_at IS NULL
    AND other_account.archived_at IS NULL
    AND anchor.type='transfer'
    AND ${pairable(anchor)}
    AND ${pairable(other)}
    AND (other.type<>'transfer' OR anchor.amount_minor<0)
    AND ${allowedByRule(anchor, other)}
    AND ${allowedByRule(other, anchor)}
  `);
  const candidates: PairingCandidate[] = rows.map(row => Number(row.anchor_amount) < 0 ? {
    outgoingId: String(row.anchor_id),
    incomingId: String(row.other_id)
  } : {
    outgoingId: String(row.other_id),
    incomingId: String(row.anchor_id)
  });
  const pairs = unambiguousPairs(candidates);

  // Bound statement parameters for both local SQLite and remote libSQL deployments.
  for (let offset = 0; offset < pairs.length; offset += 50) {
    const chunk = pairs.slice(offset, offset + 50).map(pair => ({
      ...pair,
      transferId: randomUUID()
    }));
    const cases = chunk.flatMap(pair => [sql`WHEN ${pair.outgoingId} THEN ${pair.transferId}`, sql`WHEN ${pair.incomingId} THEN ${pair.transferId}`]);
    const ids = chunk.flatMap(pair => [pair.outgoingId, pair.incomingId]);

    await executor.run(sql`UPDATE transactions SET type='transfer',transfer_id=CASE id ${sql.join(cases, sql` `)} END WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
  }

  await createRuleCounterparts(executor);

  return pairs.length;
}

/**
 * Creates the counterpart of each unlinked transfer whose rule names a manual account, as a person does in the edit dialog, and links both automatically. Runs after pairing, so a booking already on that account is linked instead; while a booking there could still pair, for example when pairing found it ambiguous, none is created.
 * The counterpart's reference carries its source's id, so a booking never receives a second created counterpart.
 */
async function createRuleCounterparts(tx: DatabaseTransaction) {
  const targets = await tx.all<{
    id: string;
    account_id: string;
  }>(sql`
    SELECT booking.id AS id,target.id AS account_id
    FROM transactions booking
    JOIN accounts own ON own.id=booking.account_id
    JOIN accounts target ON target.id=booking.type_transfer_account_id
    WHERE target.provider='manual'
    AND target.archived_at IS NULL
    AND own.archived_at IS NULL
    AND target.id<>booking.account_id
    AND target.currency=booking.currency
    AND booking.type='transfer'
    AND booking.type_source='auto'
    AND booking.transfer_id IS NULL
    AND booking.transfer_source='auto'
    AND booking.suppressed_at IS NULL
    AND booking.amount_minor<>0
    AND NOT EXISTS (
      SELECT 1 FROM transactions candidate
      WHERE candidate.account_id=target.id
      AND candidate.date BETWEEN date(booking.date,${windowStart(automaticPairingDays)}) AND date(booking.date,${windowEnd(automaticPairingDays)})
      AND candidate.amount_minor=-booking.amount_minor
      AND candidate.currency=booking.currency
      AND ${pairable(candidate)}
      AND ${allowedByRule(candidate, booking)}
    )
  `);

  for (const target of targets) {
    const subject = await tx.select(subjectColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(eq(transactions.id, String(target.id))).get();

    if (subject) {
      await createCounterpart(tx, subject, String(target.account_id), "rule");
    }
  }
}

/** Pairs transfers across every account in one transaction, for example after a sync has stored every account. */
export async function pairAllTransfers() {
  const db = await database();

  return db.transaction(tx => pairTransfers(tx));
}
