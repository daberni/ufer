import { z } from "zod";
import { validDate } from "@/lib/time";
import { currencyExponent } from "@/lib/money";
import { tradeSides } from "../trade-sides";
import { validIsin } from "../isin";

const currency = z.string().regex(/^[A-Z]{3}$/).refine(code => currencyExponent(code) !== undefined, "Choose a supported currency.");

export const securityInput = z.object({
  name: z.string().trim().min(1).max(200),
  currency,
  isin: z.string().trim().toUpperCase().refine(validIsin, "Enter a valid ISIN.").nullable().default(null),
  // The market-data provider's symbol for the listing whose closes value the security, for example VWCE.XETRA.
  provider_symbol: z.string().trim().min(1).max(50).nullable().default(null),
  venue: z.string().trim().min(1).max(20).nullable().default(null)
});

export const brokerageAccountInput = z.object({
  name: z.string().trim().min(1).max(100),
  currency: currency.default("EUR")
});

const amount = z.string().max(30);

/** The cash side is entered on a manual settlement account or is an existing bank booking. */
const settlement = z.union([z.object({
  account_id: z.string().min(1)
}).strict(), z.object({
  transaction_id: z.string().min(1)
}).strict()]);

export const tradeInput = z.object({
  // An existing security, or an ISIN whose security the trade finds or creates in its own transaction.
  security_id: z.string().min(1).optional(),
  security: z.object({
    isin: z.string().trim().toUpperCase().refine(validIsin, "Enter a valid ISIN."),
    name: z.string().trim().min(1).max(200).optional()
  }).optional(),
  date: z.string().refine(validDate),
  side: z.enum(tradeSides),
  quantity: amount,
  price: amount,
  // The traded amount before fees and taxes; omitted, it is quantity times price rounded to the currency.
  gross: amount.optional(),
  fee: amount.default("0"),
  tax: amount.default("0"),
  settlement
}).refine(input => (input.security_id === undefined) !== (input.security === undefined), "Name either a security or an ISIN.");

export const settlementCandidatesQuery = z.object({
  date: z.string().refine(validDate),
  amount_minor: z.coerce.number().int().refine(value => value !== 0)
});

export const listingInput = z.object({
  provider_symbol: z.string().trim().min(1).max(50).nullable()
});
