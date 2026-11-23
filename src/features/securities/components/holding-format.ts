import { currencyExponent } from "@/lib/money";

/** Display only: a micro-unit quantity as a localized number with up to six decimals. */
export function formatQuantity(micros: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 6
  }).format(micros / 1_000_000);
}

/** Display only: a micro-unit price in its currency with exactly `digits` decimals. */
export function formatPrice(micros: number, currency: string, locale: string, digits = priceDigits([micros], currency)) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(micros / 1_000_000);
}

/** The decimals that show every given micro-unit price exactly: at least the currency's, at most four, so the prices of one holding line up. */
export function priceDigits(prices: number[], currency: string) {
  let digits = currencyExponent(currency) ?? 2;

  for (const micros of prices) {
    while (digits < 4 && micros % 10 ** (6 - digits) !== 0) {
      digits += 1;
    }
  }

  return digits;
}
