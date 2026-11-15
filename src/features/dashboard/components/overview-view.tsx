"use client";

import styles from "./overview-view.module.css";
import { WealthSummary } from "@/features/dashboard/components/wealth-summary";
import { OverviewAccounts } from "@/features/accounts/components/overview-accounts";
import { CashFlowChart } from "@/features/dashboard/components/cash-flow-chart";
import { SpendingBreakdown } from "@/features/dashboard/components/spending-breakdown";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "changeView" | "currency" | "loading" | "openBank" | "selectedCurrencyAccounts" | "setModal" | "setSelectedAccount" | "state" | "totalExpenses" | "trend" | "trendMax">;

export function OverviewView({
  changeView,
  currency,
  loading,
  openBank,
  selectedCurrencyAccounts,
  setModal,
  setSelectedAccount,
  state,
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
        loading={loading}
        selectedCurrencyAccounts={selectedCurrencyAccounts}
        state={state}
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
          loading={loading}
          state={state}
          trend={trend}
          trendMax={trendMax}
        />
        <SpendingBreakdown
          currency={currency}
          loading={loading}
          state={state}
          totalExpenses={totalExpenses}
        />
      </div>
    </>
  );
}
