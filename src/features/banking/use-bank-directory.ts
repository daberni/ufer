"use client";

import { useState } from "react";
import { failureMessage } from "@/client/api";
import { useBanks } from "./queries";

/** The bank chosen in the connection dialog; the directory for the selected country loads while the dialog is open. */
export function useBankDirectory(active: boolean) {
  const [bankCountry, setBankCountry] = useState("AT");

  const [bankSearch, setBankSearch] = useState("");

  const [bankName, setBankName] = useState("");

  const directory = useBanks(bankCountry, active);
  const banks = directory.data?.banks ?? [];

  return {
    banks,
    bankCountry,
    setBankCountry,
    bankSearch,
    setBankSearch,
    // A bank from another country's directory is not a valid choice.
    bankName: banks.some(bank => bank.name === bankName) ? bankName : "",
    setBankName,
    banksLoading: directory.isPending && active,
    banksError: directory.isError ? failureMessage(directory.error) : ""
  };
}
