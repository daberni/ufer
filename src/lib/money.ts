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
  if (Object.hasOwn(pinnedExponents, currency)) {
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

/** The uppercase code when the runtime supports the currency, otherwise null. */
export function parseCurrencyCode(value: string) {
  const code = value.toUpperCase();

  return supportedCurrencies.has(code) ? code : null;
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

/** Minor units as a plain decimal string for an amount field, for example -1250 EUR as "-12.50". */
export function decimalAmount(value: number, currency = "EUR") {
  const exponent = currencyExponent(currency) ?? 2;
  const digits = String(Math.abs(value)).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  const sign = value < 0 ? "-" : "";

  return exponent ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}
