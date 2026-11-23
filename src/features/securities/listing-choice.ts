/** Liquid venues preferred for valuing a holding, most preferred first: XETRA, then other German venues and Vienna. */
const preferredExchanges = ["XETRA", "F", "STU", "MU", "BE", "DU", "HA", "VI"];

export type Listing = {
  symbol: string;
  exchange: string;
  currency: string;
};

/**
 * The listing a security is priced with: one quoted in the account's currency, on the most preferred venue, otherwise the first such listing.
 * A listing in another currency would need exchange rates, so without one in the account currency the security has no price source.
 */
export function chooseListing<Item extends Listing>(listings: Item[], currency: string): Item | null {
  const inCurrency = listings.filter(listing => listing.currency.toUpperCase() === currency);

  for (const exchange of preferredExchanges) {
    const preferred = inCurrency.find(listing => listing.exchange.toUpperCase() === exchange);

    if (preferred) {
      return preferred;
    }
  }

  return inCurrency[0] ?? null;
}
