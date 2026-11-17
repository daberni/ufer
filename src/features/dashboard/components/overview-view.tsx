"use client";

import styles from "./overview-view.module.css";
import { WealthSummary } from "@/features/reports/components/wealth-summary";
import { OverviewAccounts } from "@/features/accounts/components/overview-accounts";
import { NetWorthHistoryPanel } from "@/features/accounts/components/net-worth-history";
import { CashFlowChart } from "@/features/reports/components/cash-flow-chart";
import { SpendingBreakdown } from "@/features/reports/components/spending-breakdown";
import type { Area } from "@/components/ui/use-area-result";
import type { Account, NetWorth, NetWorthHistory } from "@/features/accounts/types";
import type { CashFlow } from "@/features/reports/types";

type Props = {
  currencyAccounts: Area<Account[]>;
  netWorth: Area<NetWorth>;
  netWorthHistory: Area<NetWorthHistory>;
  cashFlow: Area<CashFlow>;
};

export function OverviewView({
  currencyAccounts,
  netWorth,
  netWorthHistory,
  cashFlow
}: Props) {
  const hasAccounts = currencyAccounts.status === "pending" || currencyAccounts.data.length > 0;

  return (
    <>
      <WealthSummary hasAccounts={hasAccounts} netWorthArea={netWorth} cashFlowArea={cashFlow} />
      <OverviewAccounts currencyAccounts={currencyAccounts} />
      {hasAccounts && (
        <div className={styles["history"]}>
          <NetWorthHistoryPanel history={netWorthHistory} />
        </div>
      )}
      <div className={styles["analytics-grid"]}>
        <CashFlowChart cashFlow={cashFlow} />
        <SpendingBreakdown cashFlow={cashFlow} />
      </div>
    </>
  );
}
