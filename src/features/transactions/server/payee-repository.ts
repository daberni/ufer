import { database } from "@/server/database/connection";

/** How often a payee appears on the visible bookings of an environment and its latest booking date. */
export type PayeeUsage = {
  payee: string;
  uses: number;
  last_booking_date: string;
};

/** Every distinct effective payee (the override when present, otherwise the source's counterparty) of the environment's visible bookings. */
export async function readPayeeUsage(environment: string): Promise<PayeeUsage[]> {
  const db = await database();
  const result = await db.$client.execute({
    sql: `
      SELECT payee,COUNT(*) AS uses,MAX(booking_date) AS last_booking_date
      FROM (
        SELECT TRIM(COALESCE(t.counterparty_override,t.counterparty)) AS payee,t.booking_date
        FROM transactions t
        JOIN accounts a ON a.id=t.account_id
        WHERE a.environment=? AND t.suppressed_at IS NULL
      )
      WHERE payee<>''
      GROUP BY payee
    `,
    args: [environment]
  });

  return result.rows.map(row => ({
    payee: String(row.payee),
    uses: Number(row.uses),
    last_booking_date: String(row.last_booking_date)
  }));
}
