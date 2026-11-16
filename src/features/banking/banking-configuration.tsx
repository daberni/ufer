"use client";

import { createContext, useContext } from "react";
import type { BankingConfiguration } from "@/features/banking/types";

/** Deployment configuration rendered by the server layout, so no request is needed to know the banking environment. */
const BankingConfigurationContext = createContext<BankingConfiguration | null>(null);

export function useBankingConfiguration() {
  const configuration = useContext(BankingConfigurationContext);

  if (!configuration) {
    throw new Error("The banking configuration must be provided by the dashboard layout.");
  }

  return configuration;
}

export function BankingConfigurationProvider({
  configuration,
  children
}: {
  configuration: BankingConfiguration;
  children: React.ReactNode;
}) {
  return <BankingConfigurationContext value={configuration}>{children}</BankingConfigurationContext>;
}
