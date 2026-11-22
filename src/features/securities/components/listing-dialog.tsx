"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useState } from "react";
import { clsx } from "clsx";
import { Check } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { toFailure } from "@/client/api";
import { useListings } from "../queries";
import { useSaveListing } from "../mutations";
import type { Security } from "../types";

const noListing = "";

/** Changes the listing a security is priced with: one of the provider's listings for its ISIN, a typed symbol, or none. Prices from the old listing are replaced on the next update. */
export function ListingDialog({
  security,
  close
}: {
  security: Security;
  close: () => void;
}) {
  const listings = useListings(security.isin);
  const save = useSaveListing(security.id);
  const [symbol, setSymbol] = useState(security.provider_symbol ?? noListing);
  // Only listings quoted in the security's currency can value it without conversion.
  const offered = (listings.data ?? []).filter(listing => listing.currency.toUpperCase() === security.currency);
  const [custom, setCustom] = useState(false);
  const typed = custom || (symbol !== noListing && !offered.some(listing => listing.symbol === symbol));

  return (
    <Dialog eyebrow="PRICE LISTING" title={security.name} onClose={close}>
      <form
        className={ui["form"]}
        onSubmit={event => {
          event.preventDefault();
          save.mutate(symbol.trim() || null, {
            onSuccess: close
          });
        }}
      >
        <p className={ui["form-description"]}>The holding is valued with the daily close of this listing. Choosing another listing or none deletes the stored prices; without a listing the holding is valued at its cost.</p>
        {offered.length > 0 && (
          <label>
            Listing
            <Select
              value={typed ? "typed" : symbol}
              onChange={event => {
                const chosen = event.target.value;

                setCustom(chosen === "typed");
                setSymbol(chosen === "typed" ? "" : chosen);
              }}
            >
              <option value={noListing}>No price listing</option>
              {offered.map(listing => <option key={listing.symbol} value={listing.symbol}>{listing.symbol} · {listing.exchange} · {listing.currency}</option>)}
              <option value="typed">Other symbol…</option>
            </Select>
          </label>
        )}
        {(offered.length === 0 || typed) && (
          <label>
            Provider symbol
            <input
              value={symbol}
              onChange={event => setSymbol(event.target.value)}
              placeholder="e.g. VWCE.XETRA"
              maxLength={50}
            />
          </label>
        )}
        {listings.isError && <p className={ui["form-hint"]}>{toFailure(listings.error).message} Enter a symbol instead.</p>}
        <FormError failure={save.error ? toFailure(save.error) : null} />
        <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={save.isPending}>
          Save <Check size={16} />
        </button>
      </form>
    </Dialog>
  );
}
