"use client";

import styles from "./overview-view.module.css";
import { WealthSummary } from "@/features/reports/components/wealth-summary";
import { OverviewAccounts } from "@/features/accounts/components/overview-accounts";
import { CashFlowInsights } from "@/features/reports/components/cash-flow-insights";
import type { Area } from "@/components/ui/use-area-result";
import type { Account, NetWorth } from "@/features/accounts/types";
import type { CashFlow } from "@/features/reports/types";
import type { NetWorthHistory } from "@/features/reports/net-worth-series";

type Props = {
  currencyAccounts: Area<Account[]>;
  /** Whether any account in the currency, archived ones included, contributes to the reports. */
  hasReportedAccounts: boolean;
  netWorth: Area<NetWorth>;
  netWorthHistory: Area<NetWorthHistory>;
  cashFlow: Area<CashFlow>;
};

export function OverviewView({
  currencyAccounts,
  hasReportedAccounts,
  netWorth,
  netWorthHistory,
  cashFlow
}: Props) {
  return (
    <>
      <div className={styles["wealth-overview"]}>
        <WealthSummary hasAccounts={hasReportedAccounts} historyArea={netWorthHistory} netWorthArea={netWorth} />
        <OverviewAccounts currencyAccounts={currencyAccounts} />
      </div>
      <CashFlowInsights cashFlow={cashFlow} />
    </>
  );
}
