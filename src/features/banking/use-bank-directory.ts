"use client";

import { useEffect, useState } from "react";
import { api, failureMessage } from "@/client/api";
import type { Bank } from "@/features/dashboard/types";

export function useBankDirectory(active: boolean) {
  const [banks, setBanks] = useState<Bank[]>([]);

  const [bankCountry, setBankCountry] = useState("AT");

  const [bankSearch, setBankSearch] = useState("");

  const [bankName, setBankName] = useState("");

  const [banksLoading, setBanksLoading] = useState(false);

  const [banksError, setBanksError] = useState("");

  useEffect(() => {
    if (!active) {
      return;
    }

    let current = true;

    setBanksLoading(true);
    setBanksError("");
    setBanks([]);
    api<{
      banks: Bank[];
    }>(`banks?country=${bankCountry}`).then(data => {
      if (current) {
        setBanks(data.banks);
        setBankName(current => data.banks.some(bank => bank.name === current) ? current : "");
      }
    }).catch(error => {
      if (current) {
        setBanksError(failureMessage(error));
      }
    }).finally(() => {
      if (current) {
        setBanksLoading(false);
      }
    });

    return () => {
      current = false;
    };
  }, [active, bankCountry]);

  return {
    banks,
    setBanks,
    bankCountry,
    setBankCountry,
    bankSearch,
    setBankSearch,
    bankName,
    setBankName,
    banksLoading,
    setBanksLoading,
    banksError
  };
}
