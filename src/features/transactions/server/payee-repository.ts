import { database } from "@/server/database/connection";

/** How often a payee appears on the visible bookings and its latest booking date. */
export type PayeeUsage = {
  payee: string;
  uses: number;
  last_booking_date: string;
};

/** Every distinct effective payee (the override when present, otherwise the source's counterparty) of the visible bookings. */
export async function readPayeeUsage(): Promise<PayeeUsage[]> {
  const db = await database();
  const result = await db.$client.execute(`
      SELECT payee,COUNT(*) AS uses,MAX(date) AS last_booking_date
      FROM (
        SELECT TRIM(COALESCE(t.counterparty_override,t.counterparty)) AS payee,t.date
        FROM transactions t
        WHERE t.suppressed_at IS NULL
      )
      WHERE payee<>''
      GROUP BY payee
    `);

  return result.rows.map(row => ({
    payee: String(row.payee),
    uses: Number(row.uses),
    last_booking_date: String(row.last_booking_date)
  }));
}
