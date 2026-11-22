import type { DailyBooking } from "./daily-balances";
import type { ReportedBalance } from "./types";

export type BookedReport = {
  date: string;
  amount_minor: number;
  bank_balance_type: string | null;
};

/**
 * Compares each booked balance a bank reported with the balance calculated from bookings through the end of its date, oldest first.
 * A report that already contains bookings dated up to the next report (a weekend booking the bank dates on the next business day) shows no difference.
 * A difference starts on the first report where it differs from the previous report's difference, so an adjustment can be booked on that date.
 */
export function reportedBalanceDifferences(reports: BookedReport[], bookings: DailyBooking[]): ReportedBalance[] {
  const ordered = reports.toSorted((left, right) => left.date.localeCompare(right.date));
  const bookedThrough = (date: string | undefined) => bookings.filter(booking => date === undefined || booking.date <= date).reduce((total, booking) => total + booking.amount_minor, 0);
  const differences: ReportedBalance[] = [];
  let previousDifference = 0;

  for (const [index, report] of ordered.entries()) {
    const calculated = bookedThrough(report.date);
    const matchesLaterBookings = report.amount_minor === bookedThrough(ordered[index + 1]?.date);
    const difference = matchesLaterBookings ? 0 : report.amount_minor - calculated;

    differences.push({
      date: report.date,
      amount_minor: report.amount_minor,
      bank_balance_type: report.bank_balance_type,
      calculated_minor: matchesLaterBookings ? report.amount_minor : calculated,
      difference_minor: difference,
      difference_started: difference !== 0 && difference !== previousDifference
    });
    previousDifference = difference;
  }

  return differences;
}
