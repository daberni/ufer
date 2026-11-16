import { ValidationError } from "./errors";

// Pinned minor units of the currencies stored so far; HUF keeps 2 although the runtime formats it with 0.
const pinnedExponents: Record<string, number> = {
  EUR: 2,
  USD: 2,
  GBP: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  CZK: 2,
  HUF: 2,
  RON: 2,
  BGN: 2,
  JPY: 0,
  ISK: 0,
  KWD: 3,
  BHD: 3
};

const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

/** Decimal places of a currency: pinned for stored currencies, otherwise from the runtime's ISO 4217 data; undefined for unknown codes. */
export function currencyExponent(currency: string) {
  if (currency in pinnedExponents) {
    return pinnedExponents[currency];
  }

  if (!supportedCurrencies.has(currency)) {
    return undefined;
  }

  return new Intl.NumberFormat("en", {
    style: "currency",
    currency
  }).resolvedOptions().maximumFractionDigits;
}

/** A well-formed ISO 4217 code; `Intl.NumberFormat` throws a RangeError for anything else. */
export function isCurrencyCode(value: string) {
  return /^[A-Z]{3}$/.test(value);
}

export function minorUnits(value: string, currency = "EUR"): number {
  const exponent = currencyExponent(currency);

  if (exponent === undefined) {
    throw new ValidationError(`Unsupported currency: ${currency}`);
  }

  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim());

  if (!match) {
    throw new ValidationError("Invalid amount; use a decimal point.");
  }

  const fraction = match[3] || "";

  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent))) {
    throw new ValidationError("The amount has too many decimal places.");
  }

  const factor = 10n ** BigInt(exponent);
  const absolute = BigInt(match[2]) * factor + BigInt(fraction.slice(0, exponent).padEnd(exponent, "0") || "0");
  const result = Number(match[1] === "-" ? -absolute : absolute);

  if (!Number.isSafeInteger(result)) {
    throw new ValidationError("The amount exceeds the supported range.");
  }

  return result;
}

export function money(value: number, currency = "EUR") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: currencyExponent(currency) ?? 2
  }).format(value / 10 ** (currencyExponent(currency) ?? 2));
}
