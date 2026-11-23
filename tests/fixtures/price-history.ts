import { Temporal } from "temporal-polyfill";
import type { Database } from "../../src/server/database/connection";
import * as schema from "../../src/server/database/schema";
import { createSecurity } from "../../src/features/securities/server/security-service";
import { depot, settlementAccount, trade } from "./brokerage";

/** Weekday closes from `start` through `end`, a deterministic random walk so every run stores the same history. */
function closes(seed: number, start: string, end: string) {
  const rows: {
    date: string;
    close_micros: number;
  }[] = [];
  let state = seed;
  let close = 50_000_000 + seed % 7 * 10_000_000;

  for (let date = Temporal.PlainDate.from(start); Temporal.PlainDate.compare(date, Temporal.PlainDate.from(end)) <= 0; date = date.add({
    days: 1
  })) {
    if (date.dayOfWeek > 5) {
      continue;
    }

    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    close = Math.max(1_000_000, close + (state % 2_000_001) - 1_000_000);
    rows.push({
      date: date.toString(),
      close_micros: close
    });
  }

  return rows;
}

async function storeCloses(db: Database, securityId: string, rows: ReturnType<typeof closes>) {
  for (let index = 0; index < rows.length; index += 500) {
    await db.insert(schema.securityPrices).values(rows.slice(index, index + 500).map(row => ({
      security_id: securityId,
      ...row,
      source: "test",
      fetched_at: `${row.date}T20:00:00.000Z`
    })));
  }
}

async function syntheticSecurity(index: number) {
  const { id } = await createSecurity({
    name: `Synthetic fund ${index}`,
    currency: "EUR",
    isin: "XS0000000009",
    provider_symbol: `SYN${index}.XETRA`
  });

  return id;
}

/**
 * Two depots with six securities and weekday closes since 2021: one security's prices stop in 2025 (stale), one has none (missing) and one split in 2024.
 * Trades start in 2022, after years of imported history, and include partial and full sales and a buy after the split.
 */
export async function seedPriceHistory(db: Database) {
  const cash = await settlementAccount();
  const first = await depot();
  const second = await depot();
  const funds = await Promise.all([1, 2, 3, 4, 5, 6].map(syntheticSecurity));

  for (const [index, fund] of funds.slice(0, 4).entries()) {
    await storeCloses(db, fund, closes(index + 3, "2021-01-04", "2026-10-30"));
  }

  await storeCloses(db, funds[4]!, closes(11, "2021-01-04", "2025-03-14"));
  await db.insert(schema.securitySplits).values({
    security_id: funds[1]!,
    date: "2024-06-03",
    numerator: 4,
    denominator: 1
  });

  const trades: [string, string, string, "buy" | "sell", string, string][] = [
    [first, funds[0]!, "2022-02-14", "buy", "10", "51.20"],
    [first, funds[1]!, "2022-05-02", "buy", "20", "61.05"],
    [first, funds[0]!, "2023-01-16", "buy", "5", "48.75"],
    [first, funds[1]!, "2023-09-11", "sell", "8", "63.40"],
    [first, funds[4]!, "2024-01-08", "buy", "12", "55.10"],
    [first, funds[1]!, "2024-07-01", "buy", "16", "15.80"],
    [first, funds[0]!, "2025-04-22", "sell", "15", "52.30"],
    [first, funds[5]!, "2025-08-04", "buy", "3", "100"],
    [second, funds[2]!, "2023-03-06", "buy", "40", "70.10"],
    [second, funds[3]!, "2024-10-14", "buy", "25", "80.55"],
    [second, funds[2]!, "2025-11-03", "sell", "10", "72.90"],
    [second, funds[3]!, "2026-10-28", "buy", "5", "81.25"]
  ];

  for (const [account, fund, date, side, quantity, price] of trades) {
    await trade(account, {
      security_id: fund,
      date,
      side,
      quantity,
      price,
      fee: "1.50",
      settlement: {
        account_id: cash
      }
    });
  }

  return {
    accounts: [first, second],
    securities: funds
  };
}
