import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import type { ProviderDetails } from "@/features/transactions/server/transaction-entry";
import type { BankTransaction } from "./enable-banking-client";

// Larger provider records are not kept verbatim; the instructed amount is stored regardless.
export const maximumPayloadBytes = 64 * 1024;

// An optional field never stops an import: a malformed value is dropped and the rest of the transaction is kept.
const instructedAmount = z.object({
  amount: z.string(),
  currency: z.string()
}).optional().catch(undefined);

const exchangeRate = z.object({
  instructed_amount: instructedAmount
}).optional().catch(undefined);

function signedInstructedAmount(transaction: BankTransaction, debit: boolean) {
  const instructed = exchangeRate.parse(transaction.exchange_rate)?.instructed_amount;

  if (!instructed) {
    return undefined;
  }

  let absolute: number;

  try {
    absolute = minorUnits(instructed.amount, instructed.currency);
  } catch (error) {
    if (error instanceof ValidationError) {
      return undefined;
    }

    throw error;
  }

  // Like the booked amount, the instructed amount is absolute and takes its sign from the debit/credit indicator.
  if (absolute < 0) {
    return undefined;
  }

  return {
    amount: debit ? -absolute : absolute,
    currency: instructed.currency
  };
}

function rawPayload(transaction: BankTransaction) {
  const json = JSON.stringify(transaction);

  if (Buffer.byteLength(json) > maximumPayloadBytes) {
    return undefined;
  }

  return json;
}

/** The validated original amount of a provider transaction and the transaction itself as JSON text. */
export function providerDetails(transaction: BankTransaction, debit: boolean): ProviderDetails {
  const instructed = signedInstructedAmount(transaction, debit);
  const payload = rawPayload(transaction);

  return {
    ...(instructed ? {
      instructedAmount: instructed.amount,
      instructedCurrency: instructed.currency
    } : {}),
    ...(payload ? {
      payload
    } : {})
  };
}
