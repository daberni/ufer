"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./wealth-summary.module.css";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { periodLabel } from "@/features/dashboard/presentation";
import { periodFromJson } from "@/features/dashboard/period";
import { money } from "@/lib/money";
import { valueMask } from "@/features/dashboard/components/result-presentation";
import type { AreaResult } from "@/features/dashboard/use-area-result";
import type { CashFlow, NetWorth } from "@/features/dashboard/types";

type Props = {
  /** Whether any account uses the display currency. */
  hasAccounts: boolean;
  netWorth: AreaResult<NetWorth>;
  cashFlow: AreaResult<CashFlow>;
};

export function WealthSummary({
  hasAccounts,
  netWorth,
  cashFlow
}: Props) {
  const summary = netWorth.data;
  const flows = cashFlow.data;
  const period = periodFromJson(flows.period);
  const singleMonth = period.kind === "month";
  const netWorthValue = valueMask(netWorth.status);
  const cashFlowValue = valueMask(cashFlow.status);
  const currency = summary.currency;

  return (
    <div className={styles["wealth-grid"]}>
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
        {summary.liabilities !== 0 && (
          <div className={styles["liabilities"]}>
            Loans <span className={netWorthValue}>{money(summary.liabilities, currency)}</span>
          </div>
        )}
      </section>
      <section className={styles["month-card"]} aria-busy={cashFlow.status === "loading"}>
        <div className={ui["card-heading"]}>
          <h2>{singleMonth ? "Your month" : "Your cash flow"}</h2>
          <span className={clsx(styles["subtle"], cashFlowValue)}>{periodLabel(period)}</span>
        </div>
        <div className={styles["flow-row"]}>
          <span className={clsx(styles["flow-icon"], styles["incoming"])}>
            <ArrowDownLeft size={19} />
          </span>
          <div>
            <span>Income</span>
            <strong className={clsx(ui["positive"], cashFlowValue)}>{money(flows.income, flows.currency)}</strong>
          </div>
          <span className={clsx(styles["flow-track"], cashFlowValue)}>
            <i
              style={{
                width: `${Math.min(100, flows.income / Math.max(flows.income, flows.expenses, 1) * 100)}%`
              }}
            />
          </span>
        </div>
        <div className={styles["flow-row"]}>
          <span className={clsx(styles["flow-icon"], styles["outgoing"])}>
            <ArrowUpRight size={19} />
          </span>
          <div>
            <span>Expenses</span>
            <strong className={cashFlowValue}>{money(flows.expenses, flows.currency)}</strong>
          </div>
          <span className={clsx(styles["flow-track"], styles["expense"], cashFlowValue)}>
            <i
              style={{
                width: `${Math.min(100, flows.expenses / Math.max(flows.income, flows.expenses, 1) * 100)}%`
              }}
            />
          </span>
        </div>
        <div className={styles["monthly-result"]}>
          <div>
            <span>{singleMonth ? "Monthly cash flow" : "Net cash flow"}</span>
            <small>Excluding categorized transfers</small>
          </div>
          <strong className={clsx(flows.income - flows.expenses >= 0 && ui["positive"], cashFlowValue)}>{money(flows.income - flows.expenses, flows.currency)}</strong>
        </div>
      </section>
    </div>
  );
}
