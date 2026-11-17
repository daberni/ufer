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

/** Expenses as a share of income; without income there is nothing to compare them with. */
function spendingShare(income: number, expenses: number) {
  if (income <= 0) {
    return null;
  }

  return expenses / income;
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
    breakdown: [],
    trend: []
  }));
  const summary = netWorth.data;
  const flows = cashFlow.data;
  const period = periodFromJson(flows.period);
  const singleMonth = period.kind === "month";
  const netWorthValue = valueMask(netWorth.status);
  const cashFlowValue = valueMask(cashFlow.status);
  const currency = summary.currency;
  // The transaction list has no direction or transfer filter, so every figure opens the period's transactions in this currency.
  const transactionsHref = viewHref("transactions");
  const share = spendingShare(flows.income, flows.expenses);
  const shareText = share === null ? "No income to compare spending with" : `Spent ${percent.format(share)} of income`;
  const shareWidth = share === null ? 0 : Math.min(1, share) * 100;

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
        <Link className={clsx(styles["flow-link"], styles["flow-row"])} href={transactionsHref}>
          <span className={clsx(styles["flow-icon"], styles["incoming"])}>
            <ArrowDownLeft size={19} />
          </span>
          <div>
            <span>Income</span>
            <strong className={clsx(ui["positive"], cashFlowValue)}>{money(flows.income, flows.currency)}</strong>
          </div>
          <ChevronRight className={styles["link-icon"]} size={18} />
        </Link>
        <Link className={clsx(styles["flow-link"], styles["flow-row"])} href={transactionsHref}>
          <span className={clsx(styles["flow-icon"], styles["outgoing"])}>
            <ArrowUpRight size={19} />
          </span>
          <div>
            <span>Expenses</span>
            <strong className={cashFlowValue}>{money(flows.expenses, flows.currency)}</strong>
          </div>
          <ChevronRight className={styles["link-icon"]} size={18} />
        </Link>
        <div className={styles["spending-share"]}>
          <span className={cashFlowValue}>{shareText}</span>
          <span className={clsx(styles["share-track"], cashFlowValue)} aria-hidden="true">
            <i
              style={{
                width: `${shareWidth}%`
              }}
            />
          </span>
        </div>
        <div className={styles["monthly-result"]}>
          <Link className={clsx(styles["flow-link"], styles["result-link"])} href={transactionsHref}>
            <div>
              <span>{singleMonth ? "Monthly cash flow" : "Net cash flow"}</span>
              <small>Excluding categorized transfers</small>
            </div>
            <strong className={clsx(flows.income - flows.expenses >= 0 && ui["positive"], cashFlowValue)}>{money(flows.income - flows.expenses, flows.currency)}</strong>
            <ChevronRight className={styles["link-icon"]} size={18} />
          </Link>
        </div>
        {cashFlowArea.status === "pending" && cashFlowArea.failure && <FailureCover failure={cashFlowArea.failure} subject="Your cash flow" />}
      </section>
    </div>
  );
}
