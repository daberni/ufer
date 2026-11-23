import { sql, type SQL } from "drizzle-orm";
import { securities, securityPrices } from "@/server/database/schema";

/**
 * Which stored closes a valuation needs, so no request reads a security's whole price history.
 * - `latest`: the newest `count` closes on or before `date`; one values a holding today, two give its day change.
 * - `history`: every close from the second-newest close on or before `from` through `through`, so values on every date from `from` find the price valid then and the day change on `through` finds its previous close.
 * - `dates`: for each date, the newest close on or before it.
 */
export type PriceSelection = {
  kind: "latest";
  date: string;
  count: 1 | 2;
} | {
  kind: "history";
  through: string;
} | {
  kind: "dates";
  dates: string[];
};

/** The newest `count` closes of the outer row's security on or before `date`. */
function newestCloses(date: string, count: number) {
  return sql`SELECT recent.date FROM ${securityPrices} recent WHERE recent.security_id = ${securityPrices.security_id} AND recent.date <= ${date} ORDER BY recent.date DESC LIMIT ${count}`;
}

/** The predicate on `security_prices` rows for a selection; `from` is the earliest date a history values. */
export function selectedPrices(selection: PriceSelection, from: string): SQL {
  switch (selection.kind) {
    case "latest":
      return sql`${securityPrices.date} IN (${newestCloses(selection.date, selection.count)})`;
    case "history":
      return sql`${securityPrices.date} <= ${selection.through} AND ${securityPrices.date} >= COALESCE((SELECT MIN(date) FROM (${newestCloses(from, 2)})), ${from})`;
    case "dates": {
      if (!selection.dates.length) {
        return sql`0`;
      }

      const days = sql.join(selection.dates.map(date => sql`(${date})`), sql`, `);

      // Listing each security's valid close per date first looks up a few index entries instead of testing every stored close against every date.
      return sql`(${securityPrices.security_id}, ${securityPrices.date}) IN (SELECT ${securities.id}, (SELECT MAX(valid.date) FROM ${securityPrices} valid WHERE valid.security_id = ${securities.id} AND valid.date <= sample.column1) FROM ${securities}, (VALUES ${days}) sample)`;
    }
  }
}
