"use client";

import { useReducer } from "react";
import { toFailure } from "@/client/api";
import type { Connection } from "@/features/banking/types";
import { changeBankSelection, chosenBankName, defaultBankCountry, type BankSelection } from "./bank-selection";
import { useBankCountries, useBanks, useConnections } from "./queries";

/** The country and bank chosen in the connection dialog; reauthorizing starts with the connection's bank. */
export function useBankDirectory(reauthorized: Connection | null) {
  const connections = useConnections();
  const [selection, dispatch] = useReducer(changeBankSelection, null, (): BankSelection => {
    if (reauthorized) {
      return {
        country: reauthorized.bank_country,
        query: "",
        bankName: reauthorized.bank_name
      };
    }

    return {
      country: null,
      query: "",
      bankName: ""
    };
  });

  const countries = useBankCountries();
  const offered = countries.data ?? [];
  const country = selection.country ?? defaultBankCountry(connections.data ?? [], navigator.languages, offered);
  const directory = useBanks(country);
  const banks = directory.data ?? [];
  const failed = [countries, directory].find(query => query.isError);
  // A reauthorized connection keeps its country even when the provider no longer lists it, so the dialog can say that no bank is available.
  const choices = country && !offered.includes(country) ? [...offered, country] : offered;

  return {
    country,
    countries: choices,
    query: selection.query,
    banks,
    bankName: chosenBankName(selection, banks),
    loading: countries.isPending || (country !== null && directory.isPending),
    error: failed ? toFailure(failed.error) : null,
    retry: () => {
      void failed?.refetch();
    },
    setCountry: (country: string) => dispatch({
      type: "country",
      country
    }),
    search: (query: string) => dispatch({
      type: "search",
      query
    }),
    choose: (bankName: string) => dispatch({
      type: "choose",
      bankName
    })
  };
}
