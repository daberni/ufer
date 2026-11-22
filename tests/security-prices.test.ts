import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { checksSplits, closeMicros, marketDataLease, searchListings, updatePrices } from "../src/features/securities/server/price-update-service";
import { readSecurities, resolveSecurity, updateSecurityListing } from "../src/features/securities/server/security-service";
import { eodhdProvider, parseSplitRatio } from "../src/features/securities/server/market-data/eodhd-provider";
import { MarketDataError, type MarketDataProvider, type ProviderClose } from "../src/features/securities/server/market-data/market-data-provider";
import { acquireLease } from "../src/server/jobs/lease-repository";
import { insertSecurityForIsin } from "../src/features/securities/server/security-repository";
import { HttpError } from "../src/lib/errors";

// A Wednesday; the security "etf" checks its splits on Tuesdays (its weekday from checksSplits).
const now = Temporal.Instant.from("2026-10-14T06:00:00Z");
const etfSplitDay = Temporal.Instant.from("2026-10-20T06:00:00Z");

async function isolatedDatabase(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previous = globals.budgetDb;

  context.after(() => {
    globals.budgetDb = previous;
    client.close();
  });
  await initializeDatabase(client);

  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);
  await db.insert(schema.securities).values([{
    id: "etf",
    name: "Synthetic World ETF",
    currency: "EUR",
    provider: "eodhd",
    provider_symbol: "SYN.XETRA"
  }, {
    id: "fund",
    name: "Synthetic Fund",
    currency: "EUR",
    provider: "eodhd",
    provider_symbol: "SYNF.EUFUND"
  }, {
    id: "manual",
    name: "Synthetic unlisted",
    currency: "EUR"
  }]);

  return db;
}

type Request = {
  kind: "closes" | "splits";
  symbol: string;
  from: string;
  to: string;
};

function fakeProvider(closes: Record<string, ProviderClose[] | Error>, splits: Record<string, string[]> = {}) {
  const requests: Request[] = [];
  const provider: MarketDataProvider = {
    name: "eodhd",
    searchByIsin: async () => [],
    async dailyCloses(symbol, from, to) {
      requests.push({
        kind: "closes",
        symbol,
        from,
        to
      });

      const result = closes[symbol] ?? [];

      if (result instanceof Error) {
        throw result;
      }

      return result;
    },
    async splits(symbol, from, to) {
      requests.push({
        kind: "splits",
        symbol,
        from,
        to
      });

      return (splits[symbol] ?? []).map(entry => parseSplitRatio(entry.split(" ")[0], entry.split(" ")[1]));
    }
  };

  return {
    provider,
    requests
  };
}

async function pricesOf(db: Database, securityId: string) {
  const rows = await db.select().from(schema.securityPrices).where(eq(schema.securityPrices.security_id, securityId)).orderBy(asc(schema.securityPrices.date));

  return rows.map(row => [row.date, row.close_micros]);
}

async function securityRow(db: Database, id: string) {
  return db.select().from(schema.securities).where(eq(schema.securities.id, id)).get();
}

test("without a price source the update does nothing and the securities say so", async context => {
  const db = await isolatedDatabase(context);

  assert.deepEqual(await updatePrices(now, null), {
    status: "not_configured",
    securities: 0,
    failed: 0,
    incomplete: 0
  });
  assert.equal((await db.select().from(schema.securityPrices)).length, 0);
  assert.equal((await securityRow(db, "etf"))?.price_checked_at, null);

  const previous = process.env.MARKET_DATA_API_KEY;

  delete process.env.MARKET_DATA_API_KEY;
  context.after(() => {
    if (previous !== undefined) {
      process.env.MARKET_DATA_API_KEY = previous;
    }
  });
  assert.deepEqual((await readSecurities()).price_source, {
    configured: false,
    provider: null,
    message: "No price source configured."
  });
  await assert.rejects(searchListings(new URLSearchParams({
    isin: "XS0000000009"
  }), null), error => error instanceof HttpError && error.status === 409);
});

test("an update fetches from shortly before the newest price, or from the first trade, and stores exact closes, refetching recent days for corrections", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.securityPrices).values({
    security_id: "etf",
    date: "2026-10-12",
    close_micros: 100_000_000,
    source: "eodhd",
    fetched_at: "2026-10-12T06:00:00.000Z"
  });
  await db.insert(schema.accounts).values({
    id: "depot",
    name: "Synthetic depot",
    kind: "brokerage"
  });
  await db.insert(schema.securityTrades).values({
    id: "trade",
    account_id: "depot",
    security_id: "fund",
    date: "2026-10-01",
    side: "buy",
    sequence: 1,
    quantity_micros: 1_000_000,
    price_micros: 50_000_000,
    gross_minor: 50_00
  });

  const {
    provider,
    requests
  } = fakeProvider({
    "SYN.XETRA": [{
      date: "2026-10-13",
      close: 101.37
    }, {
      date: "2026-10-14",
      close: 0.1 + 0.2
    }],
    "SYNF.EUFUND": [{
      date: "2026-10-02",
      close: 49.5
    }]
  });

  assert.deepEqual(await updatePrices(now, provider), {
    status: "updated",
    securities: 2,
    failed: 0,
    incomplete: 0
  });
  assert.deepEqual(requests.filter(request => request.kind === "closes"), [{
    kind: "closes",
    symbol: "SYN.XETRA",
    from: "2026-10-09",
    to: "2026-10-14"
  }, {
    kind: "closes",
    symbol: "SYNF.EUFUND",
    from: "2026-10-01",
    to: "2026-10-14"
  }]);
  assert.deepEqual(await pricesOf(db, "etf"), [["2026-10-12", 100_000_000], ["2026-10-13", 101_370_000], ["2026-10-14", 300_000]]);
  assert.deepEqual(await pricesOf(db, "fund"), [["2026-10-02", 49_500_000]]);
  assert.deepEqual([(await securityRow(db, "etf"))?.price_checked_at, (await securityRow(db, "etf"))?.price_error], ["2026-10-14T06:00:00.000Z", null]);

  // A later run fetches the last stored days again, so a corrected close replaces the stored one.
  requests.length = 0;
  await updatePrices(now, fakeProvider({
    "SYN.XETRA": [{
      date: "2026-10-13",
      close: 101.4
    }]
  }).provider);
  assert.deepEqual(await pricesOf(db, "etf"), [["2026-10-12", 100_000_000], ["2026-10-13", 101_400_000], ["2026-10-14", 300_000]]);
});

test("a failing security keeps its error visible while the others update", async context => {
  const db = await isolatedDatabase(context);
  const { provider } = fakeProvider({
    "SYN.XETRA": new MarketDataError("The price provider's request limit is reached."),
    "SYNF.EUFUND": [{
      date: "2026-10-13",
      close: 49.5
    }]
  });

  assert.deepEqual(await updatePrices(now, provider), {
    status: "updated",
    securities: 2,
    failed: 1,
    incomplete: 0
  });
  assert.equal((await securityRow(db, "etf"))?.price_error, "The price provider's request limit is reached.");
  assert.deepEqual(await pricesOf(db, "fund"), [["2026-10-13", 49_500_000]]);

  // A later successful update clears the error.
  await updatePrices(Temporal.Instant.from("2026-10-15T06:00:00Z"), fakeProvider({
    "SYN.XETRA": [{
      date: "2026-10-15",
      close: 100
    }]
  }).provider);
  assert.equal((await securityRow(db, "etf"))?.price_error, null);
});

test("splits are checked weekly, on a weekday of their own, from the first trade and stored as whole-number ratios", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values({
    id: "depot",
    name: "Synthetic depot",
    kind: "brokerage"
  });
  await db.insert(schema.securityTrades).values({
    id: "trade",
    account_id: "depot",
    security_id: "etf",
    date: "2026-06-01",
    side: "buy",
    sequence: 1,
    quantity_micros: 1_000_000,
    price_micros: 50_000_000,
    gross_minor: 50_00
  });

  const midweek = fakeProvider({}, {
    "SYN.XETRA": ["2026-09-01 2.000000/1.000000"]
  });

  await updatePrices(now, midweek.provider);
  assert.equal(midweek.requests.filter(request => request.kind === "splits").length, 0);

  const weekly = fakeProvider({}, {
    "SYN.XETRA": ["2026-09-01 2.000000/1.000000", "2026-10-01 1.000000/1.500000"]
  });

  await updatePrices(etfSplitDay, weekly.provider);
  assert.deepEqual(weekly.requests.filter(request => request.kind === "splits"), [{
    kind: "splits",
    symbol: "SYN.XETRA",
    from: "2026-06-01",
    to: "2026-10-20"
  }]);
  assert.deepEqual((await db.select().from(schema.securitySplits).orderBy(asc(schema.securitySplits.date))).map(split => [split.date, split.numerator, split.denominator]), [["2026-09-01", 2, 1], ["2026-10-01", 2, 3]]);
});

test("an update while another holds the lease leaves the work to it", async context => {
  await isolatedDatabase(context);
  await acquireLease(marketDataLease, "other");

  const {
    provider,
    requests
  } = fakeProvider({});

  assert.deepEqual(await updatePrices(now, provider), {
    status: "running",
    securities: 0,
    failed: 0,
    incomplete: 0
  });
  assert.equal(requests.length, 0);
});

test("closes convert to micro-units through their decimal text and invalid ones are rejected", () => {
  assert.equal(closeMicros(101.37), 101_370_000);
  assert.equal(closeMicros(0.1 + 0.2), 300_000);
  assert.equal(closeMicros(1234.5678919), 1234_567_892);
  assert.throws(() => closeMicros(0), MarketDataError);
  assert.throws(() => closeMicros(Number.NaN), MarketDataError);
  assert.throws(() => parseSplitRatio("2026-01-01", "two/one"), MarketDataError);
  assert.throws(() => parseSplitRatio("2026-01-01", `${"9".repeat(309)}/1`), MarketDataError);
});

test("the EODHD adapter maps responses, sends the token only as a query parameter and keeps it out of errors", async () => {
  const urls: URL[] = [];
  const responses: Record<string, unknown> = {
    "/api/search/XS0000000009": [{
      Code: "SYN",
      Exchange: "XETRA",
      Name: "Synthetic World ETF",
      Currency: "EUR",
      ISIN: "XS0000000009"
    }],
    "/api/eod/SYN.XETRA": [{
      date: "2026-10-13",
      close: 101.37,
      open: 100
    }],
    "/api/eod/BAD.XETRA": [{
      date: "2026-10-13-invalid",
      close: 1
    }],
    "/api/splits/BAD.XETRA": [{
      date: "2026-02-30",
      split: "2/1"
    }]
  };
  const provider = eodhdProvider("secret-token", async input => {
    const url = new URL(String(input));

    urls.push(url);

    if (url.pathname === "/api/splits/SYN.XETRA") {
      return new Response("Unauthorized secret-token", {
        status: 401
      });
    }

    return Response.json(responses[url.pathname]);
  });

  assert.deepEqual(await provider.searchByIsin("XS0000000009"), [{
    symbol: "SYN.XETRA",
    name: "Synthetic World ETF",
    exchange: "XETRA",
    currency: "EUR",
    isin: "XS0000000009"
  }]);
  assert.deepEqual(await provider.dailyCloses("SYN.XETRA", "2026-10-13", "2026-10-14"), [{
    date: "2026-10-13",
    close: 101.37
  }]);
  assert.deepEqual([urls[1].searchParams.get("from"), urls[1].searchParams.get("to"), urls[1].searchParams.get("api_token")], ["2026-10-13", "2026-10-14", "secret-token"]);
  await assert.rejects(provider.dailyCloses("BAD.XETRA", "2026-10-13", "2026-10-14"), MarketDataError);
  await assert.rejects(provider.splits("BAD.XETRA", "2026-01-01", "2026-10-14"), MarketDataError);
  await assert.rejects(provider.splits("SYN.XETRA", "2026-01-01", "2026-10-14"), (error: unknown) => error instanceof MarketDataError && error.message === "The price provider rejected the API key." && !error.message.includes("secret"));
});

test("a security first traded before the provider's one-year split history is checked within it and stays flagged", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values({
    id: "depot",
    name: "Synthetic depot",
    kind: "brokerage"
  });
  await db.insert(schema.securityTrades).values({
    id: "old-trade",
    account_id: "depot",
    security_id: "etf",
    date: "2024-03-01",
    side: "buy",
    sequence: 1,
    quantity_micros: 1_000_000,
    price_micros: 50_000_000,
    gross_minor: 50_00
  });

  const weekly = fakeProvider({});
  const result = await updatePrices(etfSplitDay, weekly.provider);

  assert.equal(result.incomplete, 1);
  assert.deepEqual(weekly.requests.filter(request => request.kind === "splits").map(request => request.from), ["2025-10-20"]);
  assert.match((await securityRow(db, "etf"))?.price_error ?? "", /Splits before 2025-10-20 cannot be checked/);
});

test("split checks spread over the week, and a failed one is retried on the next run instead of being cleared", async context => {
  const db = await isolatedDatabase(context);
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"].map(day => Temporal.PlainDate.from(day));
  const checkDays = (id: string) => days.filter(day => checksSplits({
    id,
    price_error: null
  }, day)).map(day => day.toString());

  assert.equal(checkDays("etf").length, 1);
  assert.equal(checkDays("fund").length, 1);
  assert.notDeepEqual(checkDays("etf"), checkDays("fund"));

  await db.insert(schema.accounts).values({
    id: "depot",
    name: "Synthetic depot",
    kind: "brokerage"
  });
  await db.insert(schema.securityTrades).values({
    id: "trade",
    account_id: "depot",
    security_id: "etf",
    date: "2026-06-01",
    side: "buy",
    sequence: 1,
    quantity_micros: 1_000_000,
    price_micros: 50_000_000,
    gross_minor: 50_00
  });

  const failing = fakeProvider({});

  failing.provider.splits = async () => {
    throw new MarketDataError("The price provider's request limit is reached.");
  };

  await updatePrices(etfSplitDay, failing.provider);
  assert.equal((await securityRow(db, "etf"))?.price_error, "Splits: The price provider's request limit is reached.");

  // The next day is not its check day, but the failed check runs again; only its success clears the error.
  const retry = fakeProvider({}, {
    "SYN.XETRA": ["2026-09-01 2.000000/1.000000"]
  });

  await updatePrices(Temporal.Instant.from("2026-10-21T06:00:00Z"), retry.provider);
  assert.equal(retry.requests.filter(request => request.kind === "splits").length, 1);
  assert.equal((await securityRow(db, "etf"))?.price_error, null);
  assert.equal((await db.select().from(schema.securitySplits)).length, 1);
});

test("resolving an ISIN creates the security once, priced with the preferred listing in the trade currency", async context => {
  const db = await isolatedDatabase(context);
  const searched: string[] = [];
  const provider: MarketDataProvider = {
    ...fakeProvider({}).provider,
    async searchByIsin(isin) {
      searched.push(isin);

      return [{
        symbol: "WLD.LSE",
        name: "Synthetic World (London)",
        exchange: "LSE",
        currency: "GBP",
        isin
      }, {
        symbol: "WLD.F",
        name: "Synthetic World",
        exchange: "F",
        currency: "EUR",
        isin
      }, {
        symbol: "WLD.XETRA",
        name: "Synthetic World",
        exchange: "XETRA",
        currency: "EUR",
        isin
      }];
    }
  };

  const first = await resolveSecurity({
    isin: "us0378331005",
    currency: "EUR"
  }, provider);
  const again = await resolveSecurity({
    isin: "US0378331005",
    currency: "EUR"
  }, provider);

  assert.deepEqual([first.created, first.provider_symbol, again.created, again.id], [true, "WLD.XETRA", false, first.id]);
  assert.deepEqual(searched, ["US0378331005"]);
  assert.deepEqual(await db.select({
    name: schema.securities.name,
    venue: schema.securities.venue
  }).from(schema.securities).where(eq(schema.securities.id, first.id)).get(), {
    name: "Synthetic World",
    venue: "XETRA"
  });
  await assert.rejects(resolveSecurity({
    isin: "US0378331006",
    currency: "EUR"
  }, provider));
});

test("without a key or a listing in the trade currency the security is still created without a price source", async context => {
  const db = await isolatedDatabase(context);
  const withoutKey = await resolveSecurity({
    isin: "IE00B4L5Y983",
    currency: "EUR",
    name: "Synthetic fund"
  }, null);
  const dollarsOnly = await resolveSecurity({
    isin: "US0378331005",
    currency: "EUR"
  }, {
    ...fakeProvider({}).provider,
    searchByIsin: async isin => [{
      symbol: "WLD.US",
      name: "Synthetic World",
      exchange: "US",
      currency: "USD",
      isin
    }]
  });

  assert.deepEqual([withoutKey.provider_symbol, dollarsOnly.provider_symbol], [null, null]);
  assert.equal((await securityRow(db, withoutKey.id))?.name, "Synthetic fund");
  assert.equal((await securityRow(db, dollarsOnly.id))?.name, "US0378331005");
});

test("changing a security's listing drops the old listing's prices and refuses a symbol another security uses", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.securityPrices).values({
    security_id: "etf",
    date: "2026-10-12",
    close_micros: 100_000_000,
    source: "eodhd",
    fetched_at: "2026-10-12T06:00:00.000Z"
  });
  await assert.rejects(updateSecurityListing("etf", {
    provider_symbol: "SYNF.EUFUND"
  }), error => error instanceof HttpError && error.status === 409);
  assert.equal((await pricesOf(db, "etf")).length, 1);

  await updateSecurityListing("etf", {
    provider_symbol: "SYN.F"
  });
  assert.deepEqual([(await securityRow(db, "etf"))?.provider_symbol, (await pricesOf(db, "etf")).length], ["SYN.F", 0]);

  await updateSecurityListing("etf", {
    provider_symbol: null
  });
  assert.deepEqual([(await securityRow(db, "etf"))?.provider, (await securityRow(db, "etf"))?.provider_symbol], [null, null]);
});

test("a listing quoted in another currency is refused, and a listing change waits for a running price update", async context => {
  const db = await isolatedDatabase(context);

  await db.update(schema.securities).set({
    isin: "US0378331005"
  }).where(eq(schema.securities.id, "etf"));

  const provider: MarketDataProvider = {
    ...fakeProvider({}).provider,
    searchByIsin: async isin => [{
      symbol: "WLD.LSE",
      name: "Synthetic World",
      exchange: "LSE",
      currency: "GBP",
      isin
    }]
  };

  await assert.rejects(updateSecurityListing("etf", {
    provider_symbol: "WLD.LSE"
  }, provider), /quoted in GBP/);

  await acquireLease(marketDataLease, "running-update");
  await assert.rejects(updateSecurityListing("etf", {
    provider_symbol: "SYN.F"
  }, null), error => error instanceof HttpError && error.status === 409);
  assert.equal((await securityRow(db, "etf"))?.provider_symbol, "SYN.XETRA");
});

test("a resolution that lost a race to another returns the security the other inserted", async context => {
  const db = await isolatedDatabase(context);

  // The other resolution inserted its row after this one found none; the re-check in the insert transaction returns it.
  await db.insert(schema.securities).values({
    id: "winner",
    isin: "IE00B4L5Y983",
    name: "Synthetic New",
    currency: "EUR",
    provider: "eodhd",
    provider_symbol: "NEW.XETRA"
  });

  const loser = await insertSecurityForIsin({
    id: "loser",
    isin: "IE00B4L5Y983",
    name: "Synthetic New",
    currency: "EUR",
    provider: "eodhd",
    provider_symbol: "NEW.XETRA",
    venue: "XETRA"
  });

  assert.deepEqual(loser, {
    id: "winner",
    provider_symbol: "NEW.XETRA",
    created: false
  });
  assert.equal((await db.select().from(schema.securities).where(eq(schema.securities.isin, "IE00B4L5Y983"))).length, 1);
});

test("an update that lost its lease to another run stops before the next security", async context => {
  const db = await isolatedDatabase(context);
  const takeover = fakeProvider({});

  // While the first security is fetched, another run takes over the lease.
  takeover.provider.dailyCloses = async symbol => {
    takeover.requests.push({
      kind: "closes",
      symbol,
      from: "",
      to: ""
    });
    await db.update(schema.leases).set({
      owner: "other-run"
    }).where(eq(schema.leases.name, marketDataLease));

    return [];
  };

  assert.equal((await updatePrices(now, takeover.provider)).status, "interrupted");
  assert.deepEqual(takeover.requests.map(request => request.symbol), ["SYN.XETRA"]);
});
