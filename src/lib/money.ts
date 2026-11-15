import { ValidationError } from "./errors";

const exponents: Record<string, number> = {
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

export function minorUnits(value: string, currency = "EUR"): number {
  const exponent = exponents[currency];

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
    maximumFractionDigits: exponents[currency] ?? 2
  }).format(value / 10 ** (exponents[currency] ?? 2));
}

export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
