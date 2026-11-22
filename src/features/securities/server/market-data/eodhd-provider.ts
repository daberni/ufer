import { z } from "zod";
import { validDate } from "@/lib/time";
import { MarketDataError, type MarketDataProvider, type ProviderSplit } from "./market-data-provider";

const origin = "https://eodhd.com/api";

const searchResponse = z.array(z.object({
  Code: z.string(),
  Exchange: z.string(),
  Name: z.string(),
  Currency: z.string(),
  ISIN: z.string().nullable().optional()
}));

// Only exact calendar dates are stored; anything else fails this security's update instead of corrupting the price order.
const calendarDate = z.string().refine(validDate);

const closesResponse = z.array(z.object({
  date: calendarDate,
  close: z.number()
}));

const splitsResponse = z.array(z.object({
  date: calendarDate,
  split: z.string()
}));

function statusMessage(status: number) {
  if (status === 401 || status === 403) {
    return "The price provider rejected the API key.";
  }

  if (status === 402 || status === 429) {
    return "The price provider's request limit is reached.";
  }

  return `The price provider answered with status ${status}.`;
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right);
}

/** Parses EODHD's `2.000000/1.000000` into a whole-number ratio. */
export function parseSplitRatio(date: string, ratio: string): ProviderSplit {
  const match = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(ratio.trim());

  if (!match) {
    throw new MarketDataError(`The provider reported an unreadable split on ${date}.`);
  }

  const decimals = Math.max(match[1].split(".")[1]?.replace(/0+$/, "").length ?? 0, match[2].split(".")[1]?.replace(/0+$/, "").length ?? 0);
  const scale = 10 ** decimals;
  const numerator = Math.round(Number(match[1]) * scale);
  const denominator = Math.round(Number(match[2]) * scale);

  // Huge components would become Infinity and break the reduction; only safe whole numbers form a ratio.
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator <= 0 || denominator <= 0) {
    throw new MarketDataError(`The provider reported an invalid split on ${date}.`);
  }

  const divisor = greatestCommonDivisor(numerator, denominator);

  return {
    date,
    numerator: numerator / divisor,
    denominator: denominator / divisor
  };
}

/** EODHD end-of-day data with an instance's own API token; symbols are `CODE.EXCHANGE`, for example `VWCE.XETRA`. */
export function eodhdProvider(token: string, request: typeof fetch = fetch): MarketDataProvider {
  async function get<Schema extends z.ZodType>(path: string, query: Record<string, string>, schema: Schema): Promise<z.infer<Schema>> {
    const url = new URL(`${origin}${path}`);

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    url.searchParams.set("fmt", "json");
    url.searchParams.set("api_token", token);

    let response: Response;

    try {
      response = await request(url, {
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      throw new MarketDataError("The price provider could not be reached.");
    }

    if (!response.ok) {
      throw new MarketDataError(statusMessage(response.status));
    }

    const parsed = schema.safeParse(await response.json().catch(() => undefined));

    if (!parsed.success) {
      throw new MarketDataError("The price provider returned data in an unexpected format.");
    }

    return parsed.data;
  }

  return {
    name: "eodhd",
    async searchByIsin(isin) {
      const listings = await get(`/search/${encodeURIComponent(isin)}`, {}, searchResponse);

      return listings.map(listing => ({
        symbol: `${listing.Code}.${listing.Exchange}`,
        name: listing.Name,
        exchange: listing.Exchange,
        currency: listing.Currency,
        isin: listing.ISIN ?? null
      }));
    },
    async dailyCloses(symbol, from, to) {
      return get(`/eod/${encodeURIComponent(symbol)}`, {
        from,
        to,
        period: "d"
      }, closesResponse);
    },
    async splits(symbol, from, to) {
      const splits = await get(`/splits/${encodeURIComponent(symbol)}`, {
        from,
        to
      }, splitsResponse);

      // Two ratios on one date cannot both be stored, so such a response is rejected rather than half applied.
      if (new Set(splits.map(split => split.date)).size !== splits.length) {
        throw new MarketDataError("The price provider reported two splits on the same date.");
      }

      return splits.map(split => parseSplitRatio(split.date, split.split));
    }
  };
}

/** The configured provider, or null while no key is set: securities can still be entered, and the price job does nothing. */
export function configuredProvider(): MarketDataProvider | null {
  const token = process.env.MARKET_DATA_API_KEY?.trim();

  return token ? eodhdProvider(token) : null;
}
