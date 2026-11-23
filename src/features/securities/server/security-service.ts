import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { manualEntryPrefix } from "@/lib/booking-references";
import { today } from "@/lib/time";
import { syncLease, withLease } from "@/server/jobs/lease";
import { refuse } from "@/server/database/transaction";
import { archivedAccountMessage } from "@/features/transactions/server/booking-accounts";
import { amountMinor, averageCostMicros, positionOn, saleGains, type PositionTrade } from "../holdings";
import { checkSecurityChange } from "./security-history";
import { readAccountTransfers } from "./transfer-repository";
import { parseMicros } from "../quantities";
import { priceSourceStatus } from "./price-update-service";
import { changeSummary, valueHoldings } from "../valuation";
import { performanceSeries } from "../performance";
import { readHoldingInputs } from "./valuation-repository";
import { settlementRefusal, settlementWindowDays, tradeCashAmount, type SettlementRefusal } from "../trade-decisions";
import { brokerageAccountInput, securityInput, settlementCandidatesQuery, tradeCorrectionInput, tradeInput } from "./security-schema";
import { deleteTrade, findBrokerageAccount, findSecurity, findSettlementAccount, findSettlementBooking, findTrade, insertBrokerageAccount, insertSecurity, insertSettlementEntry, insertTrade, listAllBrokerageAccounts, listSecurities, markSettlementBooking, nextTradeSequence, readAccountTrades, readSettlementCandidates, isEarliestTrade, markSplitsUnchecked, saveSettlementEntry, saveTradeCorrection, withSecurityTransaction, findOrInsertSecurity } from "./security-repository";
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

/** A security recorded by ISIN starts without a listing; the next price update looks one up, so saving a trade never calls the provider. */
function securityForIsin(isin: string, currency: string, name: string | undefined) {
  return {
    id: randomUUID(),
    isin,
    name: name ?? isin,
    currency,
    provider: null,
    provider_symbol: null,
    venue: null
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
export async function recordTrade(accountId: string, payload: unknown, now = Temporal.Now.instant()) {
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
  // The security for a new ISIN is found or created inside the trade's transaction.
  const newSecurity = input.security ? securityForIsin(input.security.isin, account.currency, input.security.name) : null;

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

    await checkSecurityChange(tx, security.id, legs => [...legs, {
      ...trade,
      id,
      account_id: accountId,
      transfer_id: null
    }]);

    // A trade before the security's earliest one extends the history its splits must cover, so the next price update checks them again.
    if (await isEarliestTrade(tx, security.id, input.date)) {
      await markSplitsUnchecked(tx, security.id);
    }

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

/**
 * Corrects a recorded trade's date, shares, price, fees and taxes. A trade linked to a bank booking must still match the booking's amount and lie within the settlement window; a trade's own cash entry follows the correction.
 * Every change replays the security's trades, so no sale exceeds the quantity held.
 */
export async function correctTrade(id: string, payload: unknown, now = Temporal.Now.instant()) {
  const input = tradeCorrectionInput.parse(payload);

  if (Temporal.PlainDate.compare(Temporal.PlainDate.from(input.date), today(now)) > 0) {
    throw new ValidationError("The trade date cannot be in the future.");
  }

  const quantity = parseMicros(input.quantity, "quantity");
  const price = parseMicros(input.price, "price");

  await withLease(syncLease, "A sync is running. Change the trade after it has finished.", () => withSecurityTransaction(async tx => {
    const trade = await findTrade(tx, id);

    if (!trade) {
      throw new HttpError(404, "Trade not found.");
    }

    const brokerage = await findBrokerageAccount(tx, trade.account_id);
    const security = await findSecurity(tx, trade.security_id);

    if (!brokerage || !security || brokerage.archived_at !== null) {
      throw new HttpError(409, archivedAccountMessage);
    }

    const amounts = {
      side: trade.side,
      gross_minor: input.gross === undefined ? amountMinor(quantity, price, security.currency) : nonNegative(minorUnits(input.gross, security.currency), "gross amount"),
      fee_minor: nonNegative(minorUnits(input.fee, security.currency), "fee"),
      tax_minor: nonNegative(minorUnits(input.tax, security.currency), "tax")
    };
    const cash = tradeCashAmount(amounts);
    const corrected: PositionTrade = {
      date: input.date,
      side: trade.side,
      sequence: trade.sequence,
      quantity_micros: quantity,
      gross_minor: amounts.gross_minor,
      fee_minor: amounts.fee_minor
    };

    await checkSecurityChange(tx, trade.security_id, legs => legs.map(leg => leg.transfer_id === null && leg.id === trade.id ? {
      ...leg,
      ...corrected
    } : leg));

    const booking = trade.settlement_transaction_id ? await findSettlementBooking(tx, trade.settlement_transaction_id) : undefined;

    if (booking?.account_archived_at) {
      throw new HttpError(409, archivedAccountMessage);
    }

    if (booking && booking.provider_reference.startsWith(manualEntryPrefix)) {
      await saveSettlementEntry(tx, booking.id, {
        date: input.date,
        amount_minor: cash,
        description: tradeDescription(trade.side, input.quantity, security.name)
      });
    } else if (booking) {
      // The bank booking stays the source of truth for the cash; the corrected trade must still match it.
      if (booking.amount_minor !== cash) {
        throw new ValidationError(settlementFailures.amount_mismatch);
      }

      if (Math.abs(Temporal.PlainDate.from(input.date).until(Temporal.PlainDate.from(booking.date)).days) > settlementWindowDays) {
        throw new ValidationError(settlementFailures.outside_window);
      }
    }

    if (await isEarliestTrade(tx, security.id, input.date)) {
      await markSplitsUnchecked(tx, security.id);
    }

    await saveTradeCorrection(tx, trade.id, {
      date: input.date,
      quantity_micros: quantity,
      price_micros: price,
      gross_minor: amounts.gross_minor,
      fee_minor: amounts.fee_minor,
      tax_minor: amounts.tax_minor
    });
  }));

  return {
    ok: true
  };
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

    await checkSecurityChange(tx, trade.security_id, legs => legs.filter(leg => leg.transfer_id !== null || leg.id !== trade.id));
    await deleteTrade(tx, trade);
  }));

  return {
    ok: true
  };
}

/**
 * The account's trades and transfers, each sale with the gain it realized, and its holdings today: split-adjusted quantity, moving-average cost, realized gains and the value at the latest price on or before today, with missing or stale prices marked.
 * A transfer shows the cost basis it carried and that cost per unit.
 */
export async function readBrokerageTrades(accountId: string, now = Temporal.Now.instant()) {
  const account = await requireBrokerageAccount(accountId);
  const trades = await readAccountTrades(accountId);
  const transfers = await readAccountTransfers(accountId);
  const date = today(now).toString();
  const holdings = (await readHoldingInputs([accountId], {
    kind: "latest",
    date,
    count: 2
  })).get(accountId)?.holdings ?? [];
  const gains = new Map<string, number>();
  const carried = new Map<string, number>();

  for (const holding of holdings) {
    for (const [leg, gain] of saleGains(holding.trades, holding.splits)) {
      gains.set(leg.id, gain);
    }

    for (const leg of holding.trades) {
      if (leg.transfer_id) {
        carried.set(leg.transfer_id, leg.gross_minor);
      }
    }
  }

  const rows = [...trades.map(trade => ({
    ...trade,
    transfer: null,
    realized_minor: gains.get(trade.id) ?? null
  })), ...transfers.map(transfer => {
    const sent = transfer.from_account_id === accountId;
    const cost = carried.get(transfer.id) ?? 0;

    return {
      id: transfer.id,
      security_id: transfer.security_id,
      security_name: transfer.security_name,
      currency: transfer.currency,
      date: transfer.date,
      side: sent ? "transfer_out" as const : "transfer_in" as const,
      sequence: sent ? transfer.from_sequence : transfer.to_sequence,
      quantity_micros: transfer.quantity_micros,
      price_micros: averageCostMicros(cost, transfer.quantity_micros, transfer.currency),
      gross_minor: cost,
      fee_minor: 0,
      tax_minor: 0,
      settlement_transaction_id: null,
      settlement_account_id: null,
      settlement_account_name: null,
      settlement_counterparty: null,
      settlement_description: null,
      transfer: {
        counterpart_account_id: sent ? transfer.to_account_id : transfer.from_account_id,
        counterpart_account_name: sent ? transfer.to_account_name : transfer.from_account_name
      },
      realized_minor: null
    };
  })].toSorted((left, right) => left.date.localeCompare(right.date) || left.sequence - right.sequence);

  return {
    account_id: account.id,
    currency: account.currency,
    trades: rows,
    valuation: valueHoldings(holdings, date),
    summary: changeSummary(holdings, date)
  };
}

/** A brokerage account's time-weighted performance through today; see `performanceSeries`. */
export async function readBrokeragePerformance(accountId: string, now = Temporal.Now.instant()) {
  const account = await requireBrokerageAccount(accountId);
  const date = today(now).toString();
  const holdings = (await readHoldingInputs([accountId], {
    kind: "history",
    through: date
  })).get(accountId)?.holdings ?? [];

  return {
    account_id: account.id,
    currency: account.currency,
    as_of: date,
    missing: valueHoldings(holdings, date).missing,
    points: performanceSeries(holdings, date)
  };
}

/**
 * The time-weighted performance of all brokerage accounts together, one series per currency, since amounts are never summed across currencies.
 * The series includes archived accounts for the periods they held positions, so closing a depot keeps its history; both legs of a transfer between them cancel. Today's figures cover the active accounts.
 */
export async function readCombinedBrokeragePerformance(now = Temporal.Now.instant()) {
  const accounts = await listAllBrokerageAccounts();
  const active = accounts.filter(account => account.archived_at === null);
  const date = today(now).toString();
  const inputs = await readHoldingInputs(accounts.map(account => account.id), {
    kind: "history",
    through: date
  });
  const currencies = [...new Set(active.map(account => account.currency))];

  return {
    currencies: currencies.map(currency => {
      const accountIds = active.filter(account => account.currency === currency).map(account => account.id);
      const holdings = accountIds.flatMap(id => inputs.get(id)?.holdings ?? []);
      const history = accounts.filter(account => account.currency === currency).flatMap(account => inputs.get(account.id)?.holdings ?? []);

      return {
        currency,
        as_of: date,
        account_ids: accountIds,
        missing: valueHoldings(holdings, date).missing,
        points: performanceSeries(history, date),
        summary: changeSummary(holdings, date)
      };
    })
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
  // Quantities need no prices.
  const holdings = (await readHoldingInputs([accountId], {
    kind: "dates",
    dates: []
  }, tx)).get(accountId)?.holdings ?? [];

  return holdings.some(holding => positionOn(holding.trades, holding.splits, replayEnd).quantity_micros > 0);
}
