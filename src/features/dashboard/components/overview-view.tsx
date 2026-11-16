"use client";

import styles from "./overview-view.module.css";
import { WealthSummary } from "@/features/dashboard/components/wealth-summary";
import { OverviewAccounts } from "@/features/accounts/components/overview-accounts";
import { CashFlowChart } from "@/features/dashboard/components/cash-flow-chart";
import { SpendingBreakdown } from "@/features/dashboard/components/spending-breakdown";
import type { Area } from "@/features/dashboard/use-area-result";
import type { Account, CashFlow, NetWorth } from "@/features/dashboard/types";

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
      <WealthSummary hasAccounts={hasAccounts} netWorthArea={netWorth} cashFlowArea={cashFlow} />
      <OverviewAccounts currencyAccounts={currencyAccounts} />
      <div className={styles["analytics-grid"]}>
        <CashFlowChart cashFlow={cashFlow} />
        <SpendingBreakdown cashFlow={cashFlow} />
      </div>
    </>
  );
}
