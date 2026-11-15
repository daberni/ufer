"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./period-controls.module.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { lastSyncLabel, periodLabel } from "@/features/dashboard/presentation";
import { allMonthsPeriod, currentMonthPeriod, monthPeriod } from "@/features/dashboard/period";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { Select } from "@/components/ui/select";

type Props = Pick<DashboardController, "currencies" | "currency" | "moveMonth" | "period" | "selectPeriod" | "setCurrency" | "setPage" | "state" | "view">;

export function PeriodControls({
  currencies,
  currency,
  moveMonth,
  period,
  selectPeriod,
  setCurrency,
  setPage,
  state,
  view
}: Props) {
  if (!state) {
    return null;
  }

  const allMonths = period.kind === "all";

  return (
    <div className={styles["period-bar"]}>
      <div>
        <span className={ui["section-kicker"]}>{view === "overview" ? "NET WORTH & CASH FLOW" : `${state.transactionCount} ${state.transactionCount === 1 ? "TRANSACTION" : "TRANSACTIONS"}`}</span>
        {view === "overview" && <span className={styles["subtle"]}>{lastSyncLabel(state.runs[0])}</span>}
      </div>
      <div className={styles["period-controls"]}>
        <Select
          variant="bare"
          aria-label="Display currency"
          value={currency}
          onChange={event => {
            setCurrency(event.target.value);
            setPage(1);
          }}
        >
          {currencies.map(value => <option key={value}>{value}</option>)}
        </Select>
        <button
          className={ui["icon-button"]}
          aria-label="Previous month"
          disabled={allMonths}
          onClick={() => moveMonth(-1)}
        >
          <ChevronLeft size={17} />
        </button>
        <label className={styles["month-label"]}>
          <span>{periodLabel(period)}</span>
          <input
            aria-label="Select month"
            type="month"
            value={period.kind === "month" ? period.month : ""}
            onChange={event => {
              if (event.target.value) {
                selectPeriod(monthPeriod(event.target.value));
              }
            }}
          />
        </label>
        <button
          className={ui["icon-button"]}
          aria-label="Next month"
          disabled={allMonths}
          onClick={() => moveMonth(1)}
        >
          <ChevronRight size={17} />
        </button>
        <label className={styles["all-months"]}>
          <input
            type="checkbox"
            checked={allMonths}
            onChange={event => selectPeriod(event.target.checked ? allMonthsPeriod : currentMonthPeriod())}
          />
          All months
        </label>
      </div>
    </div>
  );
}
