/** Display only: a micro-unit quantity as a localized number with up to six decimals. */
export function formatQuantity(micros: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 6
  }).format(micros / 1_000_000);
}

/** Display only: a micro-unit price in its currency with up to four decimals. */
export function formatPrice(micros: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 4
  }).format(micros / 1_000_000);
}
