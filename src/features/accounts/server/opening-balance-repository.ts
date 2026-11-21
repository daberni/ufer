import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { DatabaseTransaction } from "@/server/database/connection";
import { accounts, transactions } from "@/server/database/schema";
import { manualEntryPrefix } from "@/lib/booking-references";

/** A balance the bank reported for the end of a date. */
export type ReportedBalance = {
  amount: number;
  date: string;
};

function dayBefore(date: string) {
  return Temporal.PlainDate.from(date).subtract({
    days: 1
  }).toString();
}

/**
 * Keeps a bank-linked account's opening balance in front of its bookings, inside the caller's write transaction.
 * Without an opening balance, the reported balance books one for the difference to the visible bookings through its date, dated before the oldest booking.
 * Bookings that arrive dated on or before an existing opening balance were part of it: they reduce it by their sum and it moves before them, so the current balance stays the same.
 * `arrived` selects the rows this write inserted; a redelivered booking whose date moved before the opening balance was already counted and is not absorbed again.
 */
export async function anchorOpeningBalance(tx: DatabaseTransaction, accountId: string, reported: ReportedBalance, arrived: SQL | undefined) {
  const opening = await tx.select({
    id: transactions.id,
    date: transactions.date,
    amount: transactions.amount_minor
  }).from(transactions).where(and(eq(transactions.account_id, accountId), eq(transactions.type, "opening_balance"))).orderBy(asc(transactions.date)).get();

  if (!opening) {
    await bookOpeningBalance(tx, accountId, reported);

    return;
  }

  await moveBefore(tx, accountId, opening, arrived);
}

/** Keeps a bank-linked account's opening balance in front of bookings imported from a file, inside the caller's write transaction; manual accounts and accounts without an opening balance are left as they are. */
export async function keepBankOpeningBalanceFirst(tx: DatabaseTransaction, accountId: string, arrived: SQL | undefined) {
  const opening = await tx.select({
    id: transactions.id,
    date: transactions.date,
    amount: transactions.amount_minor
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.account_id, accountId), eq(transactions.type, "opening_balance"), ne(accounts.provider, "manual"))).orderBy(asc(transactions.date)).get();

  if (opening) {
    await moveBefore(tx, accountId, opening, arrived);
  }
}

async function moveBefore(tx: DatabaseTransaction, accountId: string, opening: {
  id: string;
  date: string;
  amount: number;
}, arrived: SQL | undefined) {
  if (!arrived) {
    return;
  }

  const earlier = await tx.select({
    oldest: sql<string | null>`MIN(${transactions.date})`,
    visible: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.suppressed_at} IS NULL THEN ${transactions.amount_minor} ELSE 0 END),0)`.mapWith(Number)
  }).from(transactions).where(and(eq(transactions.account_id, accountId), ne(transactions.id, opening.id), lte(transactions.date, opening.date), arrived)).get();

  if (earlier?.oldest) {
    await tx.update(transactions).set({
      date: dayBefore(earlier.oldest),
      amount_minor: opening.amount - earlier.visible
    }).where(eq(transactions.id, opening.id));
  }
}

async function bookOpeningBalance(tx: DatabaseTransaction, accountId: string, reported: ReportedBalance) {
  const account = await tx.select({
    currency: accounts.currency
  }).from(accounts).where(eq(accounts.id, accountId)).get();

  if (!account) {
    return;
  }

  const booked = await tx.select({
    oldest: sql<string | null>`MIN(${transactions.date})`,
    // The reported balance contains what the bank booked through its date, by the bank's booking date rather than the value date.
    throughDate: sql<number>`COALESCE(SUM(CASE WHEN COALESCE(${transactions.booking_date},${transactions.date})<=${reported.date} THEN ${transactions.amount_minor} ELSE 0 END),0)`.mapWith(Number)
  }).from(transactions).where(and(eq(transactions.account_id, accountId), isNull(transactions.suppressed_at))).get();
  const beforeBookings = booked?.oldest ? dayBefore(booked.oldest) : reported.date;
  const id = randomUUID();

  await tx.insert(transactions).values({
    id,
    account_id: accountId,
    provider_reference: `${manualEntryPrefix}${id}`,
    date: beforeBookings < reported.date ? beforeBookings : reported.date,
    amount_minor: reported.amount - (booked?.throughDate ?? 0),
    currency: account.currency,
    counterparty: "",
    description: "",
    category_id: null,
    category_source: "manual",
    category_rule_id: null,
    type: "opening_balance",
    type_source: "manual"
  });
}
