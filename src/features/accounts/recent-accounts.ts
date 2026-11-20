import type { Account } from "@/features/accounts/types";

/**
 * The accounts with the most recent bookings, newest first; accounts without bookings fill the remaining places in their listed order.
 */
export function recentlyBookedAccounts(accounts: Account[], limit: number) {
  const booked = accounts.filter(account => account.last_booking_date !== null);
  const unbooked = accounts.filter(account => account.last_booking_date === null);
  const newestFirst = booked.toSorted((left, right) => String(right.last_booking_date).localeCompare(String(left.last_booking_date)));

  return [...newestFirst, ...unbooked].slice(0, limit);
}
