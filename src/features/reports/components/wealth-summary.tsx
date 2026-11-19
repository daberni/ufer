"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import styles from "./wealth-summary.module.css";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Wallet } from "lucide-react";
import { periodLabel } from "@/lib/date-format";
import { periodFromJson, periodToJson } from "@/lib/period";
import { money } from "@/lib/money";
import { valueMask, withPlaceholder } from "@/components/ui/result-presentation";
import { FailureCover } from "@/components/ui/area-placeholder";
import { useCurrency, usePeriod, useViewHref } from "@/client/use-app-url";
import type { Area } from "@/components/ui/use-area-result";
import type { CashFlow } from "@/features/reports/types";
import type { NetWorth } from "@/features/accounts/types";

type Props = {
  /** Whether any account uses the display currency; assumed while the accounts load, so the masked figure keeps its place. */
  hasAccounts: boolean;
  netWorthArea: Area<NetWorth>;
  cashFlowArea: Area<CashFlow>;
};

const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 0
});

/** Refunds and missing income need an explanation instead of a misleading spending percentage. */
function spendingShareText(income: number, expenses: number) {
  if (expenses <= 0) {
    return expenses < 0 ? "Refunds exceeded spending" : "No spending this period";
  }

  if (income <= 0) {
    return "No income to compare spending with";
  }

  return `Spent ${percent.format(expenses / income)} of income`;
}

export function WealthSummary({
  hasAccounts,
  netWorthArea,
  cashFlowArea
}: Props) {
  const selectedCurrency = useCurrency();
  const selectedPeriod = usePeriod();
  const viewHref = useViewHref();
  const netWorth = withPlaceholder(netWorthArea, () => ({
    currency: selectedCurrency,
    netWorth: 0,
    liquidity: 0,
    investments: 0,
    property: 0,
    liabilities: 0,
    unvalued: 0
  }));
  const cashFlow = withPlaceholder(cashFlowArea, () => ({
    period: periodToJson(selectedPeriod),
    currency: selectedCurrency,
    income: 0,
    expenses: 0,
    incomeBreakdown: [],
    expenseBreakdown: [],
    trend: []
  }));
  const summary = netWorth.data;
  const flows = cashFlow.data;
  const period = periodFromJson(flows.period);
  const singleMonth = period.kind === "month";
  const netWorthValue = valueMask(netWorth.status);
  const cashFlowValue = valueMask(cashFlow.status);
  const currency = summary.currency;
  const transactionsHref = viewHref("transactions");
  const scale = Math.max(0, flows.income, flows.expenses);
  const incomeWidth = scale > 0 ? Math.max(0, flows.income) / scale * 100 : 0;
  const expenseWidth = scale > 0 ? Math.max(0, flows.expenses) / scale * 100 : 0;
  const comparisonText = spendingShareText(flows.income, flows.expenses);

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
        {/* Before the first results the loans line is laid out too, so a card with loans keeps its height when they arrive. */}
        {(summary.liabilities !== 0 || netWorthArea.status === "pending") && (
          <div className={styles["liabilities"]}>
            Loans <span className={netWorthValue}>{money(summary.liabilities, currency)}</span>
          </div>
        )}
        {netWorthArea.status === "pending" && netWorthArea.failure && <FailureCover failure={netWorthArea.failure} subject="Your net worth" />}
      </section>
      <section className={clsx(ui["panel"], styles["month-card"])} aria-busy={cashFlow.status === "loading"}>
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
            <span className={clsx(styles["comparison-track"], cashFlowValue)} aria-hidden="true">
              <i
                data-flow="income"
                style={{
                  width: `${incomeWidth}%`
                }}
              />
            </span>
          </div>
        </div>
        <div className={styles["flow-row"]}>
          <span className={clsx(styles["flow-icon"], styles["outgoing"])}>
            <ArrowUpRight size={19} />
          </span>
          <div>
            <span>Expenses</span>
            <strong className={cashFlowValue}>{money(flows.expenses, flows.currency)}</strong>
            <span className={clsx(styles["comparison-track"], cashFlowValue)} aria-hidden="true">
              <i
                data-flow="expenses"
                style={{
                  width: `${expenseWidth}%`
                }}
              />
            </span>
          </div>
        </div>
        <p className={clsx(styles["spending-share"], cashFlowValue)}>{comparisonText}</p>
        <div className={styles["monthly-result"]}>
          <div className={styles["result-row"]}>
            <div>
              <span>{singleMonth ? "Monthly cash flow" : "Net cash flow"}</span>
              <small>Excluding transfers</small>
            </div>
            <strong className={clsx(styles["result-amount"], flows.income - flows.expenses >= 0 && ui["positive"], cashFlowValue)}>{money(flows.income - flows.expenses, flows.currency)}</strong>
          </div>
        </div>
        <Link className={clsx(ui["text-button"], styles["transactions-link"])} href={transactionsHref}>
          View transactions
          <ChevronRight className={styles["link-icon"]} size={18} />
        </Link>
        {cashFlowArea.status === "pending" && cashFlowArea.failure && <FailureCover failure={cashFlowArea.failure} subject="Your cash flow" />}
      </section>
    </div>
  );
}
