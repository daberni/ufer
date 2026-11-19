"use client";

import { WealthSummary } from "@/features/reports/components/wealth-summary";
import { OverviewAccounts } from "@/features/accounts/components/overview-accounts";
import { CashFlowInsights } from "@/features/reports/components/cash-flow-insights";
import type { Area } from "@/components/ui/use-area-result";
import type { Account, NetWorth } from "@/features/accounts/types";
import type { CashFlow } from "@/features/reports/types";

type Props = {
  currencyAccounts: Area<Account[]>;
  netWorth: Area<NetWorth>;
  cashFlow: Area<CashFlow>;
};

export function OverviewView({
  currencyAccounts,
  netWorth,
  cashFlow
}: Props) {
  const hasAccounts = currencyAccounts.status === "pending" || currencyAccounts.data.length > 0;

  return (
    <>
      <WealthSummary hasAccounts={hasAccounts} netWorthArea={netWorth} />
      <OverviewAccounts currencyAccounts={currencyAccounts} />
      <CashFlowInsights cashFlow={cashFlow} />
    </>
  );
}
