import { Temporal } from "temporal-polyfill";
import { valueHolding } from "./holdings";
import { valueHoldings, type HoldingInputs } from "./valuation";

/**
 * One date of a brokerage account's performance: its holdings value, the net amount invested so far (buy costs including fees minus sale proceeds after fees, with transfers at their value on the day) and the time-weighted growth factor since the first trade.
 * Any range's return is `growth` at its end divided by `growth` at its start, minus one; its gain is the change in `value_minor - invested_minor`.
 */
export type PerformancePoint = {
  date: string;
  value_minor: number;
  invested_minor: number;
  growth: number;
};

/**
 * The time-weighted return of a brokerage account's holdings on every date their value can change through `endDate`, starting at a zero value the day before the first trade.
 * Each sub-period returns (value + sale proceeds) ÷ (previous value + buy costs) on its end date: buys count as invested at the start of the day and sales as withdrawn at its end, so neither counts as performance while fees do. A period with nothing invested returns nothing. Values use only prices valid on their date, and a holding without any price counts at its cost basis.
 * Only periods with holdings count: the series starts the day before the first holding, ends on the date the last one is closed, and leaves out the dates between a closing and the next holding, which hold nothing to perform.
 * A transfer is an external flow of the single account at the moved quantity's value on its date: received like a buy, sent like a sale. Across several accounts both legs cancel, so a transfer changes no combined figure.
 */
/** The time-weighted return since the first trade and that trade's date, or null without any trade. The series opens the day before the first trade, so its second point is the first purchase. */
export function totalReturn(points: PerformancePoint[]) {
  const first = points[1];
  const last = points[points.length - 1];

  return first && last ? {
    ratio: last.growth - 1,
    since: first.date
  } : null;
}

export function performanceSeries(holdings: HoldingInputs[], endDate: string): PerformancePoint[] {
  const buys = new Map<string, number>();
  const sales = new Map<string, number>();
  // Transfer legs by transfer, so only both legs of the same transfer between the given accounts cancel.
  const transfers = new Map<string, {
    date: string;
    received: number;
    sent: number;
    legs: number;
  }>();

  for (const holding of holdings) {
    for (const trade of holding.trades) {
      if (trade.date > endDate) {
        continue;
      }

      if (trade.side === "buy") {
        buys.set(trade.date, (buys.get(trade.date) ?? 0) + trade.gross_minor + trade.fee_minor);
      } else if (trade.side === "sell") {
        sales.set(trade.date, (sales.get(trade.date) ?? 0) + trade.gross_minor - trade.fee_minor);
      } else {
        // Without a price the moved holding counts at the cost it carries, as in its valuation.
        const moved = valueHolding(trade.quantity_micros, holding.splits, holding.prices, holding.currency, trade.date).value_minor ?? trade.gross_minor;

        const key = trade.transfer_id ?? `${trade.date}:${trade.sequence}:${trade.side}`;
        const flow = transfers.get(key) ?? {
          date: trade.date,
          received: 0,
          sent: 0,
          legs: 0
        };

        if (trade.side === "transfer_in") {
          flow.received += moved;
        } else {
          flow.sent += moved;
        }

        flow.legs += 1;
        transfers.set(key, flow);
      }
    }
  }

  for (const flow of transfers.values()) {
    if (flow.legs === 2) {
      continue;
    }

    buys.set(flow.date, (buys.get(flow.date) ?? 0) + flow.received);
    sales.set(flow.date, (sales.get(flow.date) ?? 0) + flow.sent);
  }

  const first = [...buys.keys(), ...sales.keys()].sort()[0];

  if (!first) {
    return [];
  }

  const dates = new Set<string>([first, endDate]);

  for (const holding of holdings) {
    for (const event of [...holding.trades, ...holding.splits, ...holding.prices]) {
      if (event.date >= first && event.date <= endDate) {
        dates.add(event.date);
      }
    }
  }

  const points: PerformancePoint[] = [{
    date: Temporal.PlainDate.from(first).subtract({
      days: 1
    }).toString(),
    value_minor: 0,
    invested_minor: 0,
    growth: 1
  }];
  // Whether anything is held at the end of each point's date; the start point opens the first holding period.
  const held = [true];

  for (const date of [...dates].sort()) {
    const previous = points[points.length - 1];
    const bought = buys.get(date) ?? 0;
    const proceeds = sales.get(date) ?? 0;
    const valuation = valueHoldings(holdings, date);
    const value = valuation.value_minor;
    const invested = previous.value_minor + bought;

    points.push({
      date,
      value_minor: value,
      invested_minor: previous.invested_minor + bought - proceeds,
      growth: invested > 0 ? previous.growth * ((value + proceeds) / invested) : previous.growth
    });
    held.push(valuation.holdings.some(holding => holding.quantity_micros > 0));
  }

  // A point counts while something is held, and on the date of a closing; a closing point also opens the next holding period's first day.
  return points.filter((_, index) => held[index] || held[index - 1]);
}
