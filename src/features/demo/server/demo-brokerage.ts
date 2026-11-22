import { Temporal } from "temporal-polyfill";
import { amountMinor } from "@/features/securities/holdings";
import type { TradeSide } from "@/features/securities/trade-sides";

/** Synthetic demo brokerage: a cash account, a brokerage account, two made-up securities with weekly prices and a few trades. */
export const demoBrokerage = {
  cashAccount: {
    id: "demo-brokerage-cash",
    name: "Brokerage cash"
  },
  account: {
    id: "demo-brokerage",
    name: "Northwind depot"
  }
};

type DemoSecurity = {
  id: string;
  isin: string;
  name: string;
  start: number;
  drift: number;
};

// Synthetic ISINs with valid check digits under the XS prefix; no real instrument is meant.
const securities: DemoSecurity[] = [{
  id: "demo-security-world",
  isin: "XS0000000017",
  name: "Global Equity ETF (synthetic)",
  start: 92,
  drift: 0.0035
}, {
  id: "demo-security-bonds",
  isin: "XS0000000009",
  name: "Euro Bond Fund (synthetic)",
  start: 48,
  drift: 0.0006
}];

export type DemoTrade = {
  id: string;
  securityId: string;
  date: string;
  side: TradeSide;
  sequence: number;
  quantityMicros: number;
  priceMicros: number;
  grossMinor: number;
  feeMinor: number;
};

export type DemoBrokerageRows = {
  openingDate: string;
  openingMinor: number;
  securities: Omit<DemoSecurity, "start" | "drift">[];
  prices: {
    securityId: string;
    date: string;
    closeMicros: number;
  }[];
  trades: DemoTrade[];
};

/** A deterministic weekly close: a steady drift with a gentle wave, in micro-units. */
function close(security: DemoSecurity, week: number) {
  const value = security.start * (1 + security.drift * week + 0.02 * Math.sin(week / 4));

  return Math.round(value * 100) * 10_000;
}

/** Prices every Friday of the last year through `runDate`, and trades on the Friday closes they refer to. */
export function buildDemoBrokerage(runDate: Temporal.PlainDate): DemoBrokerageRows {
  const firstFriday = runDate.subtract({
    weeks: 52
  }).add({
    days: (5 - runDate.subtract({
      weeks: 52
    }).dayOfWeek + 7) % 7
  });
  const fridays: string[] = [];

  for (let date = firstFriday; Temporal.PlainDate.compare(date, runDate) <= 0; date = date.add({
    weeks: 1
  })) {
    fridays.push(date.toString());
  }

  const prices = securities.flatMap(security => fridays.map((date, week) => ({
    securityId: security.id,
    date,
    closeMicros: close(security, week)
  })));
  const priceOf = (securityId: string, week: number) => close(securities.find(security => security.id === securityId)!, week);
  const plan: {
    securityId: string;
    week: number;
    side: TradeSide;
    quantity: number;
  }[] = [{
    securityId: "demo-security-world",
    week: 2,
    side: "buy",
    quantity: 40
  }, {
    securityId: "demo-security-bonds",
    week: 10,
    side: "buy",
    quantity: 60
  }, {
    securityId: "demo-security-world",
    week: 26,
    side: "buy",
    quantity: 15
  }, {
    securityId: "demo-security-world",
    week: 44,
    side: "sell",
    quantity: 12
  }];
  const trades = plan.filter(step => step.week < fridays.length).map((step, index) => {
    const priceMicros = priceOf(step.securityId, step.week);
    const quantityMicros = step.quantity * 1_000_000;

    return {
      id: `demo-trade-${index + 1}`,
      securityId: step.securityId,
      date: fridays[step.week],
      side: step.side,
      sequence: index + 1,
      quantityMicros,
      priceMicros,
      grossMinor: amountMinor(quantityMicros, priceMicros, "EUR"),
      feeMinor: 4_90
    };
  });

  return {
    openingDate: Temporal.PlainDate.from(fridays[0]).subtract({
      days: 1
    }).toString(),
    openingMinor: 10_000_00,
    securities: securities.map(security => ({
      id: security.id,
      isin: security.isin,
      name: security.name
    })),
    prices,
    trades
  };
}
