import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { validDate } from "@/lib/time";
import type { ProviderDetails } from "@/features/transactions/server/transaction-entry";
import type { BankTransaction } from "./enable-banking-client";

// Larger provider records are not kept verbatim; their validated fields are stored regardless.
export const maximumPayloadBytes = 64 * 1024;

type ProviderAmount = {
  amount: string;
  currency: string;
};

// Optional provider fields never stop an import: a malformed value is dropped and the rest of the transaction is kept.
function optional<T extends z.ZodType>(schema: T) {
  return schema.optional().catch(undefined);
}

function text(maximumLength: number) {
  return optional(z.string().trim().min(1).max(maximumLength));
}

const date = optional(z.string().refine(validDate));

const amount = optional(z.object({
  amount: z.string(),
  currency: z.string()
}));

const account = optional(z.object({
  iban: optional(z.string().transform(value => value.replace(/\s/g, "").toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/))),
  other: optional(z.object({
    identification: z.string().trim().min(1).max(70),
    scheme_name: z.string().trim().min(1).max(35)
  }))
}));

const agent = optional(z.object({
  bic_fi: optional(z.string().trim().toUpperCase().regex(/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/))
}));

const providerFields = z.object({
  value_date: date,
  transaction_date: date,
  bank_transaction_code: optional(z.object({
    code: text(35),
    sub_code: text(35),
    description: text(500)
  })),
  merchant_category_code: optional(z.string().regex(/^\d{4}$/)),
  exchange_rate: optional(z.object({
    unit_currency: optional(z.string().regex(/^[A-Z]{3}$/)),
    exchange_rate: optional(z.string().trim().max(32).regex(/^\d+(?:\.\d+)?$/).refine(value => /[1-9]/.test(value))),
    rate_type: optional(z.enum(["AGRD", "SALE", "SPOT"])),
    instructed_amount: amount
  })),
  balance_after_transaction: amount,
  reference_number: text(140),
  creditor_account: account,
  debtor_account: account,
  creditor_agent: agent,
  debtor_agent: agent
});

function minorAmount(value: ProviderAmount | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    return {
      minor: minorUnits(value.amount, value.currency),
      currency: value.currency
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return undefined;
    }

    throw error;
  }
}

function signedInstructedAmount(value: ProviderAmount | undefined, debit: boolean) {
  const instructed = minorAmount(value);

  // Like the booked amount, the instructed amount is absolute and takes its sign from the debit/credit indicator.
  if (!instructed || instructed.minor < 0) {
    return undefined;
  }

  return {
    minor: debit ? -instructed.minor : instructed.minor,
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

function withoutMissing(details: ProviderDetails): ProviderDetails {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

/** Validated optional fields of a provider transaction, with the counterparty taken from the side opposite the booked account. */
export function providerDetails(transaction: BankTransaction, debit: boolean): ProviderDetails {
  const fields = providerFields.parse(transaction);
  const counterpartyAccount = debit ? fields.creditor_account : fields.debtor_account;
  const counterpartyAgent = debit ? fields.creditor_agent : fields.debtor_agent;
  const instructed = signedInstructedAmount(fields.exchange_rate?.instructed_amount, debit);
  const balanceAfter = minorAmount(fields.balance_after_transaction);

  return withoutMissing({
    valueDate: fields.value_date,
    transactionDate: fields.transaction_date,
    bankTransactionCode: fields.bank_transaction_code?.code,
    bankTransactionSubCode: fields.bank_transaction_code?.sub_code,
    bankTransactionDescription: fields.bank_transaction_code?.description,
    merchantCategoryCode: fields.merchant_category_code,
    exchangeRate: fields.exchange_rate?.exchange_rate,
    exchangeRateUnitCurrency: fields.exchange_rate?.unit_currency,
    exchangeRateType: fields.exchange_rate?.rate_type,
    instructedAmount: instructed?.minor,
    instructedCurrency: instructed?.currency,
    balanceAfter: balanceAfter?.minor,
    balanceAfterCurrency: balanceAfter?.currency,
    referenceNumber: fields.reference_number,
    counterpartyIban: counterpartyAccount?.iban,
    counterpartyAccountId: counterpartyAccount?.other?.identification,
    counterpartyAccountScheme: counterpartyAccount?.other?.scheme_name,
    counterpartyBic: counterpartyAgent?.bic_fi,
    payload: rawPayload(transaction)
  });
}
