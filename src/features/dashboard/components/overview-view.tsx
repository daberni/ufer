"use client";

import styles from "./overview-view.module.css";
import { WealthSummary } from "@/features/dashboard/components/wealth-summary";
import { OverviewAccounts } from "@/features/accounts/components/overview-accounts";
import { CashFlowChart } from "@/features/dashboard/components/cash-flow-chart";
import { SpendingBreakdown } from "@/features/dashboard/components/spending-breakdown";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "changeView" | "currency" | "month" | "openBank" | "selectedCurrencyAccounts" | "setModal" | "setSelectedAccount" | "state" | "summary" | "totalExpenses" | "trend" | "trendMax">;

export function OverviewView({
  changeView,
  currency,
  month,
  openBank,
  selectedCurrencyAccounts,
  setModal,
  setSelectedAccount,
  state,
  summary,
  totalExpenses,
  trend,
  trendMax
}: Props) {
  if (!state) {
    return null;
  }

  return (
    <>
      <WealthSummary
        currency={currency}
        month={month}
        selectedCurrencyAccounts={selectedCurrencyAccounts}
        summary={summary}
      />
      <OverviewAccounts
        changeView={changeView}
        openBank={openBank}
        selectedCurrencyAccounts={selectedCurrencyAccounts}
        setModal={setModal}
        setSelectedAccount={setSelectedAccount}
      />
      <div className={styles["analytics-grid"]}>
        <CashFlowChart
          currency={currency}
          state={state}
          trend={trend}
          trendMax={trendMax}
        />
        <SpendingBreakdown
          currency={currency}
          month={month}
          state={state}
          totalExpenses={totalExpenses}
        />
      </div>
    </>
  );
}
