"use client";

import styles from "./overview-view.module.css";
import { WealthSummary } from "@/features/dashboard/components/wealth-summary";
import { OverviewAccounts } from "@/features/accounts/components/overview-accounts";
import { CashFlowChart } from "@/features/dashboard/components/cash-flow-chart";
import { SpendingBreakdown } from "@/features/dashboard/components/spending-breakdown";
import type { AreaResult } from "@/features/dashboard/use-area-result";
import type { Account, CashFlow, NetWorth } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "changeView" | "openBank" | "setModal" | "setSelectedAccount"> & {
  currencyAccounts: Account[];
  netWorth: AreaResult<NetWorth>;
  cashFlow: AreaResult<CashFlow>;
};

export function OverviewView({
  changeView,
  openBank,
  setModal,
  setSelectedAccount,
  currencyAccounts,
  netWorth,
  cashFlow
}: Props) {
  return (
    <>
      <WealthSummary hasAccounts={currencyAccounts.length > 0} netWorth={netWorth} cashFlow={cashFlow} />
      <OverviewAccounts
        changeView={changeView}
        currencyAccounts={currencyAccounts}
        openBank={openBank}
        setModal={setModal}
        setSelectedAccount={setSelectedAccount}
      />
      <div className={styles["analytics-grid"]}>
        <CashFlowChart cashFlow={cashFlow} />
        <SpendingBreakdown cashFlow={cashFlow} />
      </div>
    </>
  );
}
