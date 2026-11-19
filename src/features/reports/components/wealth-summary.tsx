"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./wealth-summary.module.css";
import { Wallet } from "lucide-react";
import { money } from "@/lib/money";
import { valueMask, withPlaceholder } from "@/components/ui/result-presentation";
import { FailureCover } from "@/components/ui/area-placeholder";
import { useCurrency } from "@/client/use-app-url";
import type { Area } from "@/components/ui/use-area-result";
import type { NetWorth } from "@/features/accounts/types";

type Props = {
  /** Whether any account uses the display currency; assumed while the accounts load, so the masked figure keeps its place. */
  hasAccounts: boolean;
  netWorthArea: Area<NetWorth>;
};

/** Net worth and its composition; the period's income, expenses, net and savings rate belong to the cash-flow panels below. */
export function WealthSummary({
  hasAccounts,
  netWorthArea
}: Props) {
  const selectedCurrency = useCurrency();
  const netWorth = withPlaceholder(netWorthArea, () => ({
    currency: selectedCurrency,
    netWorth: 0,
    liquidity: 0,
    investments: 0,
    property: 0,
    liabilities: 0,
    unvalued: 0
  }));
  const summary = netWorth.data;
  const netWorthValue = valueMask(netWorth.status);
  const currency = summary.currency;

  return (
    <section className={styles["wealth-card"]} aria-busy={netWorth.status === "loading"}>
      <div className={styles["wealth-card-top"]}>
        <span>
          <span className={styles["wealth-mark"]}>
            <Wallet size={17} />
          </span>
          Net worth
        </span>
        <span className={clsx(styles["small-tag"], netWorthValue)}>{currency}</span>
      </div>
      <div className={clsx(styles["wealth-number"], netWorthValue)}>{hasAccounts ? money(summary.netWorth, currency) : "—"}</div>
      <p>Latest known balances · independent of the selected period{summary.unvalued > 0 ? ` · ${summary.unvalued} without a balance` : ""}</p>
      <div className={clsx(styles["allocation-bar"], netWorthValue)} aria-hidden="true">
        <span
          style={{
            flex: Math.max(0, summary.liquidity)
          }}
        />
        <span
          style={{
            flex: Math.max(0, summary.investments)
          }}
        />
        <span
          style={{
            flex: Math.max(0, summary.property)
          }}
        />
      </div>
      <div className={styles["wealth-allocation"]}>
        <span>
          <i className={clsx(styles["legend-dot"], ui["liquid"])} />
          Cash<strong className={netWorthValue}>{money(summary.liquidity, currency)}</strong>
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], styles["invested"])} />
          Investments<strong className={netWorthValue}>{money(summary.investments, currency)}</strong>
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], ui["property"])} />
          Property<strong className={netWorthValue}>{money(summary.property, currency)}</strong>
        </span>
      </div>
      {/* Before the first results the loans line is laid out too, so a card with loans keeps its height when they arrive. */}
      {(summary.liabilities !== 0 || netWorthArea.status === "pending") && (
        <div className={styles["liabilities"]}>
          Loans <span className={netWorthValue}>{money(summary.liabilities, currency)}</span>
        </div>
      )}
      {netWorthArea.status === "pending" && netWorthArea.failure && <FailureCover failure={netWorthArea.failure} subject="Your net worth" />}
    </section>
  );
}
