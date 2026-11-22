import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { today } from "@/lib/time";
import { syncLease, withLease } from "@/server/jobs/lease";
import { refuse } from "@/server/database/transaction";
import { archivedAccountMessage } from "@/features/transactions/server/booking-accounts";
import { amountMinor, positionOn, type PositionTrade } from "../holdings";
import { parseMicros } from "../quantities";
import { marketDataLease, priceSourceStatus, searchProviderListings } from "./price-update-service";
import { chooseListing } from "../listing-choice";
import { configuredProvider } from "./market-data/eodhd-provider";
import type { MarketDataProvider } from "./market-data/market-data-provider";
import { valueHoldings } from "../valuation";
import { readHoldingInputs } from "./valuation-repository";
import { settlementRefusal, settlementWindowDays, tradeCashAmount, type SettlementRefusal } from "../trade-decisions";
import { brokerageAccountInput, listingInput, securityInput, settlementCandidatesQuery, tradeInput } from "./security-schema";
import { deleteTrade, findBrokerageAccount, findSecurity, findSettlementAccount, findSettlementBooking, findTrade, insertBrokerageAccount, insertSecurity, insertSettlementEntry, insertTrade, listSecurities, markSettlementBooking, nextTradeSequence, readAccountTrades, readPositionTrades, readSettlementCandidates, readSplits, readTradedSecurityIds, withSecurityTransaction, findOrInsertSecurity, findSecurityListing, saveSecurityListing } from "./security-repository";
import { database, type DatabaseTransaction } from "@/server/database/connection";

/** Replays every trade so a sale never exceeds what was held at that point, now or after a change. */
const replayEnd = "9999-12-31";

const tradeLeaseMessage = "A sync is running. Record the trade after it has finished.";

const settlementFailures: Record<SettlementRefusal, string> = {
  not_bank_booking: "Choose a booking imported from a bank on a current or savings account.",
  archived_account: archivedAccountMessage,
  currency_mismatch: "The booking must be in the security's currency.",
  amount_mismatch: "The booking's amount must equal the trade's cash amount.",
  linked: "This booking is already linked with another booking or trade.",
  hidden: "This booking is hidden. Show it first.",
  split: "Remove the booking's split first.",
  outside_window: `The booking must be at most ${settlementWindowDays} days from the trade date.`
};

export async function createSecurity(payload: unknown) {
  const input = securityInput.parse(payload);
  const id = randomUUID();
  const saved = await insertSecurity({
    id,
    isin: input.isin,
    name: input.name,
    currency: input.currency,
    provider: input.provider_symbol ? "eodhd" : null,
    provider_symbol: input.provider_symbol,
    venue: input.venue
  });

  if (!saved) {
    throw new HttpError(409, "A security with this provider symbol already exists.");
  }

  return {
    id
  };
}

/** The security a new ISIN would get: its price listing chosen automatically from the provider's listings (ADR 012 amendment); without a key or a listing in that currency it has no price source. */
async function securityForIsin(isin: string, currency: string, name: string | undefined, provider: MarketDataProvider | null) {
  const listing = chooseListing(await searchProviderListings(isin, provider), currency);

  return {
    id: randomUUID(),
    isin,
    name: name ?? listing?.name ?? isin,
    currency,
    provider: listing ? "eodhd" : null,
    provider_symbol: listing?.symbol ?? null,
    venue: listing?.exchange ?? null
  };
}

/** Changes the listing a security is priced with, or removes it; a small edit outside the trade flow. */
export async function updateSecurityListing(id: string, payload: unknown, provider: MarketDataProvider | null = configuredProvider()) {
  const input = listingInput.parse(payload);
  const security = await findSecurityListing(id);

  if (!security) {
    throw new HttpError(404, "Security not found.");
  }

  // A listing quoted in another currency would value the holding without conversion; a typed symbol the provider does not list for this ISIN stays the person's choice.
  if (input.provider_symbol && security.isin) {
    const listed = (await searchProviderListings(security.isin, provider)).find(listing => listing.symbol === input.provider_symbol);

    if (listed && listed.currency.toUpperCase() !== security.currency) {
      throw new ValidationError(`This listing is quoted in ${listed.currency}; choose one in ${security.currency}.`);
    }
  }

  // A running price update may be fetching the old listing; changing it waits, so no old closes land after the switch.
  const saved = await withLease(marketDataLease, "A price update is running. Change the listing after it has finished.", () => saveSecurityListing(id, {
    provider: input.provider_symbol ? "eodhd" : null,
    provider_symbol: input.provider_symbol
  }));

  if (!saved) {
    throw new HttpError(409, "Another security already uses this listing.");
  }

  return {
    ok: true
  };
}

/** The securities with their last price update, and whether a price source is configured at all. */
export async function readSecurities() {
  return {
    price_source: priceSourceStatus(),
    securities: await listSecurities()
  };
}

/** A brokerage account holds securities; it has no transactions and no opening balance. */
export async function createBrokerageAccount(payload: unknown) {
  const input = brokerageAccountInput.parse(payload);
  const id = randomUUID();

  await insertBrokerageAccount(id, input);

  return {
    id
  };
}

async function requireBrokerageAccount(id: string) {
  const account = await findBrokerageAccount(await database(), id);

  if (!account) {
    throw new HttpError(404, "Brokerage account not found.");
  }

  return account;
}

function tradeDescription(side: "buy" | "sell", quantity: string, security: string) {
  return `${side === "buy" ? "Buy" : "Sell"} ${quantity.trim()} ${security}`;
}

/**
 * Records a buy or sale on a brokerage account with its cash side: a new entry on a manual settlement account, or an existing bank booking that becomes the trade's cash side.
 * Holds the sync lease because a bank booking's type changes, and refuses a sale beyond the quantity held at any point.
 */
export async function recordTrade(accountId: string, payload: unknown, now = Temporal.Now.instant(), provider: MarketDataProvider | null = configuredProvider()) {
  const input = tradeInput.parse(payload);
  const account = await requireBrokerageAccount(accountId);

  if (account.archived_at !== null) {
    throw new HttpError(409, archivedAccountMessage);
  }

  if (Temporal.PlainDate.compare(Temporal.PlainDate.from(input.date), today(now)) > 0) {
    throw new ValidationError("The trade date cannot be in the future.");
  }

  const quantity = parseMicros(input.quantity, "quantity");
  const price = parseMicros(input.price, "price");
  const id = randomUUID();
  // The listing lookup is a network call, so it runs before the transaction; the security itself is found or created inside it.
  const newSecurity = input.security ? await securityForIsin(input.security.isin, account.currency, input.security.name, provider) : null;

  return withLease(syncLease, tradeLeaseMessage, () => withSecurityTransaction(async tx => {
    const brokerage = await findBrokerageAccount(tx, accountId);

    if (!brokerage || brokerage.archived_at !== null) {
      throw new HttpError(409, archivedAccountMessage);
    }

    const security = newSecurity ? await findOrInsertSecurity(tx, newSecurity) : await findSecurity(tx, input.security_id!);

    if (!security) {
      throw new ValidationError("Security does not exist.");
    }

    if (security.currency !== brokerage.currency) {
      throw new ValidationError("The security must be traded in the brokerage account's currency.");
    }

    const amounts = {
      side: input.side,
      gross_minor: input.gross === undefined ? amountMinor(quantity, price, security.currency) : nonNegative(minorUnits(input.gross, security.currency), "gross amount"),
      fee_minor: nonNegative(minorUnits(input.fee, security.currency), "fee"),
      tax_minor: nonNegative(minorUnits(input.tax, security.currency), "tax")
    };
    const cash = tradeCashAmount(amounts);
    const sequence = await nextTradeSequence(tx, accountId);
    const trade: PositionTrade = {
      date: input.date,
      side: input.side,
      sequence,
      quantity_micros: quantity,
      gross_minor: amounts.gross_minor,
      fee_minor: amounts.fee_minor
    };

    positionOn([...await readPositionTrades(tx, accountId, security.id), trade], await readSplits(tx, security.id), replayEnd);

    let settlementId: string;

    if ("account_id" in input.settlement) {
      const settlement = await findSettlementAccount(tx, input.settlement.account_id);

      if (!settlement) {
        throw new ValidationError("Settlement account not found.");
      }

      if (settlement.archived_at !== null) {
        throw new HttpError(409, archivedAccountMessage);
      }

      if (settlement.provider !== "manual") {
        throw new ValidationError("A bank-linked settlement account receives the trade's cash from its bank. Choose that booking instead.");
      }

      if (settlement.currency !== security.currency) {
        throw new ValidationError("The settlement account must use the security's currency.");
      }

      settlementId = randomUUID();
      await insertSettlementEntry(tx, {
        id: settlementId,
        account_id: settlement.id,
        date: input.date,
        amount_minor: cash,
        currency: security.currency,
        type: input.side,
        counterparty: brokerage.name,
        description: tradeDescription(input.side, input.quantity, security.name)
      });
    } else {
      const booking = await findSettlementBooking(tx, input.settlement.transaction_id);

      if (!booking) {
        throw new ValidationError("The selected booking does not exist.");
      }

      const refusal = settlementRefusal(booking, {
        amount_minor: cash,
        currency: security.currency,
        daysApart: Temporal.PlainDate.from(input.date).until(Temporal.PlainDate.from(booking.date)).days
      });

      if (refusal) {
        refuse(refusal);
      }

      settlementId = booking.id;
      await markSettlementBooking(tx, booking.id, input.side);
    }

    await insertTrade(tx, {
      id,
      account_id: accountId,
      security_id: security.id,
      date: input.date,
      side: input.side,
      sequence,
      quantity_micros: quantity,
      price_micros: price,
      gross_minor: amounts.gross_minor,
      fee_minor: amounts.fee_minor,
      tax_minor: amounts.tax_minor,
      settlement_transaction_id: settlementId
    });

    return {
      id
    };
  })).then(result => {
    if (typeof result === "string") {
      throw new ValidationError(settlementFailures[result]);
    }

    return result;
  });
}

function nonNegative(amount: number, label: string) {
  if (amount < 0) {
    throw new ValidationError(`The ${label} cannot be negative.`);
  }

  return amount;
}

/** Deletes a trade with its cash side, unless a later sale would then exceed the quantity held. */
export async function removeTrade(id: string) {
  await withLease(syncLease, "A sync is running. Delete the trade after it has finished.", () => withSecurityTransaction(async tx => {
    const trade = await findTrade(tx, id);

    if (!trade) {
      throw new HttpError(404, "Trade not found.");
    }

    const brokerage = await findBrokerageAccount(tx, trade.account_id);

    if (brokerage?.archived_at) {
      throw new HttpError(409, archivedAccountMessage);
    }

    // Archiving freezes the settlement account's bookings too, so its cash side cannot be removed or retyped.
    const settlement = trade.settlement_transaction_id ? await findSettlementBooking(tx, trade.settlement_transaction_id) : undefined;

    if (settlement?.account_archived_at) {
      throw new HttpError(409, archivedAccountMessage);
    }

    const remaining = (await readPositionTrades(tx, trade.account_id, trade.security_id)).filter(other => other.id !== trade.id);

    positionOn(remaining, await readSplits(tx, trade.security_id), replayEnd);
    await deleteTrade(tx, trade);
  }));

  return {
    ok: true
  };
}

/** The account's trades and its holdings today: split-adjusted quantity, moving-average cost, realized gains and the value at the latest price on or before today, with missing or stale prices marked. */
export async function readBrokerageTrades(accountId: string, now = Temporal.Now.instant()) {
  const account = await requireBrokerageAccount(accountId);
  const trades = await readAccountTrades(accountId);
  const holdings = (await readHoldingInputs([accountId])).get(accountId)?.holdings ?? [];

  return {
    account_id: account.id,
    currency: account.currency,
    trades,
    valuation: valueHoldings(holdings, today(now).toString())
  };
}

/** Bank bookings that could be the cash side of a trade of the given signed amount on a date. */
export async function settlementCandidates(accountId: string, query: URLSearchParams) {
  const input = settlementCandidatesQuery.parse(Object.fromEntries(query));
  const account = await requireBrokerageAccount(accountId);

  return readSettlementCandidates(account.currency, input.amount_minor, input.date);
}

/** Whether the brokerage account still holds any security; read inside the caller's write transaction, since a trade may be recorded meanwhile. */
export async function holdsSecurities(tx: DatabaseTransaction, accountId: string) {
  for (const securityId of await readTradedSecurityIds(tx, accountId)) {
    if (positionOn(await readPositionTrades(tx, accountId, securityId), await readSplits(tx, securityId), replayEnd).quantity_micros > 0) {
      return true;
    }
  }

  return false;
}
