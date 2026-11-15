"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./wealth-summary.module.css";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { periodLabel } from "@/features/dashboard/presentation";
import { money } from "@/lib/money";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "currency" | "selectedCurrencyAccounts" | "state">;

export function WealthSummary({
  currency,
  selectedCurrencyAccounts,
  state
}: Props) {
  if (!state) {
    return null;
  }

  const {
    period,
    summary
  } = state;
  const singleMonth = period.kind === "month";

  return (
    <div className={styles["wealth-grid"]}>
      <section className={styles["wealth-card"]}>
        <div className={styles["wealth-card-top"]}>
          <span>
            <span className={styles["wealth-mark"]}>
              <Wallet size={17} />
            </span>
            Net worth
          </span>
          <span className={styles["small-tag"]}>{currency}</span>
        </div>
        <div className={styles["wealth-number"]}>{selectedCurrencyAccounts.length ? money(summary.netWorth, currency) : "—"}</div>
        <p>Latest known balances · independent of the selected period{summary.unvalued > 0 ? ` · ${summary.unvalued} without a balance` : ""}</p>
        <div className={styles["allocation-bar"]} aria-hidden="true">
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
            Cash<strong>{money(summary.liquidity, currency)}</strong>
          </span>
          <span>
            <i className={clsx(styles["legend-dot"], styles["invested"])} />
            Investments<strong>{money(summary.investments, currency)}</strong>
          </span>
          <span>
            <i className={clsx(styles["legend-dot"], ui["property"])} />
            Property<strong>{money(summary.property, currency)}</strong>
          </span>
        </div>
        {summary.liabilities !== 0 && (
          <div className={styles["liabilities"]}>
            Loans <span>{money(summary.liabilities, currency)}</span>
          </div>
        )}
      </section>
      <section className={styles["month-card"]}>
        <div className={ui["card-heading"]}>
          <h2>{singleMonth ? "Your month" : "Your cash flow"}</h2>
          <span className={styles["subtle"]}>{periodLabel(period)}</span>
        </div>
        <div className={styles["flow-row"]}>
          <span className={clsx(styles["flow-icon"], styles["incoming"])}>
            <ArrowDownLeft size={19} />
          </span>
          <div>
            <span>Income</span>
            <strong className={ui["positive"]}>{money(summary.income, currency)}</strong>
          </div>
          <span className={styles["flow-track"]}>
            <i
              style={{
                width: `${summary.income ? 100 : 0}%`
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
            <strong>{money(summary.expenses, currency)}</strong>
          </div>
          <span className={clsx(styles["flow-track"], styles["expense"])}>
            <i
              style={{
                width: `${Math.min(100, summary.expenses / Math.max(summary.income, summary.expenses, 1) * 100)}%`
              }}
            />
          </span>
        </div>
        <div className={styles["monthly-result"]}>
          <div>
            <span>{singleMonth ? "Monthly cash flow" : "Net cash flow"}</span>
            <small>Excluding categorized transfers</small>
          </div>
          <strong className={summary.income - summary.expenses >= 0 ? ui["positive"] : ""}>{money(summary.income - summary.expenses, currency)}</strong>
        </div>
      </section>
    </div>
  );
}
