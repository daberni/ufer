"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./account-cash-flow.module.css";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from "lucide-react";
import { periodLabel } from "@/lib/date-format";
import { periodFromJson, periodToJson } from "@/lib/period";
import { money } from "@/lib/money";
import { valueMask, withPlaceholder } from "@/components/ui/result-presentation";
import { FailureCover } from "@/components/ui/area-placeholder";
import { usePeriod } from "@/client/use-app-url";
import type { Area } from "@/components/ui/use-area-result";
import type { AccountCashFlow } from "@/features/reports/types";

type Props = {
  cashFlow: Area<AccountCashFlow>;
  /** The account's currency, for the placeholder before the first results. */
  currency: string;
};

/** An account's income, spending and categorized transfers in the selected period. */
export function AccountCashFlowSummary({
  cashFlow: area,
  currency
}: Props) {
  const selectedPeriod = usePeriod();
  const cashFlow = withPlaceholder(area, () => ({
    period: periodToJson(selectedPeriod),
    currency,
    income: 0,
    expenses: 0,
    transfersIn: 0,
    transfersOut: 0
  }));
  const flows = cashFlow.data;
  const mask = valueMask(cashFlow.status);
  const transfers = flows.transfersIn - flows.transfersOut;

  return (
    <section className={clsx(ui["panel"], styles["cash-flow"])} aria-busy={cashFlow.status === "loading"}>
      <div className={ui["card-heading"]}>
        <h2>Cash flow</h2>
        <span className={clsx(ui["subtle"], mask)}>{periodLabel(periodFromJson(flows.period))}</span>
      </div>
      <dl className={styles["flows"]}>
        <div>
          <dt>
            <span className={clsx(styles["flow-icon"], styles["incoming"])} aria-hidden="true">
              <ArrowDownLeft size={17} />
            </span>
            Income
          </dt>
          <dd className={clsx(ui["positive"], mask)}>{money(flows.income, flows.currency)}</dd>
        </div>
        <div>
          <dt>
            <span className={clsx(styles["flow-icon"], styles["outgoing"])} aria-hidden="true">
              <ArrowUpRight size={17} />
            </span>
            Spending
          </dt>
          <dd className={mask}>{money(flows.expenses, flows.currency)}</dd>
        </div>
        <div>
          <dt>
            <span className={styles["flow-icon"]} aria-hidden="true">
              <ArrowLeftRight size={17} />
            </span>
            Transfers
          </dt>
          <dd className={mask}>
            {money(transfers, flows.currency)}
            <small>{`In ${money(flows.transfersIn, flows.currency)} · Out ${money(flows.transfersOut, flows.currency)}`}</small>
          </dd>
        </div>
      </dl>
      <p className={styles["note"]}>Transfers are transactions in a transfer category; income and spending leave them out.</p>
      {area.status === "pending" && area.failure && <FailureCover failure={area.failure} subject="The cash flow" />}
    </section>
  );
}
