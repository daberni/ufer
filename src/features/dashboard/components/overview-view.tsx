"use client";

import styles from "./overview-view.module.css";
import { WealthSummary } from "@/features/reports/components/wealth-summary";
import { OverviewAccounts } from "@/features/accounts/components/overview-accounts";
import { CashFlowChart } from "@/features/reports/components/cash-flow-chart";
import { SpendingBreakdown } from "@/features/reports/components/spending-breakdown";
import type { Area } from "@/components/ui/use-area-result";
import type { Account, NetWorth } from "@/features/accounts/types";
import type { CashFlow } from "@/features/reports/types";

type Props = {
  currencyAccounts: Area<Account[]>;
  /** Whether any account in the currency, archived ones included, contributes to the reports. */
  hasReportedAccounts: boolean;
  netWorth: Area<NetWorth>;
  cashFlow: Area<CashFlow>;
};

export function OverviewView({
  currencyAccounts,
  hasReportedAccounts,
  netWorth,
  cashFlow
}: Props) {
  return (
    <>
      <WealthSummary hasAccounts={hasReportedAccounts} netWorthArea={netWorth} cashFlowArea={cashFlow} />
      <OverviewAccounts currencyAccounts={currencyAccounts} />
      <div className={styles["analytics-grid"]}>
        <CashFlowChart cashFlow={cashFlow} />
        <SpendingBreakdown cashFlow={cashFlow} />
      </div>
    </>
  );
}
