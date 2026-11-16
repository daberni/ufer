"use client";

import { useReducer } from "react";
import { failureMessage } from "@/client/api";
import type { Connection } from "@/features/dashboard/types";
import { changeBankSelection, chosenBankName, defaultBankCountry, type BankSelection } from "./bank-selection";
import { useBanks, useConnections } from "./queries";

/** The country and bank chosen in the connection dialog; reauthorizing starts with the connection's bank. */
export function useBankDirectory(reauthorized: Connection | null) {
  const connections = useConnections();
  const [selection, dispatch] = useReducer(changeBankSelection, null, (): BankSelection => {
    if (reauthorized) {
      return {
        country: reauthorized.bank_country,
        query: reauthorized.bank_name,
        bankName: reauthorized.bank_name
      };
    }

    return {
      country: null,
      query: "",
      bankName: ""
    };
  });

  const country = selection.country ?? defaultBankCountry(connections.data ?? [], navigator.languages);
  const directory = useBanks(country);
  const banks = directory.data?.banks ?? [];

  return {
    country,
    query: selection.query,
    banks,
    bankName: chosenBankName(selection, banks),
    loading: directory.isPending,
    error: directory.isError ? failureMessage(directory.error) : "",
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
