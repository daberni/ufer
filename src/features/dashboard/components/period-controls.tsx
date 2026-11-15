"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./period-controls.module.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { describeDate } from "@/lib/date-format";
import { useDisplayTimeZone } from "@/components/ui/use-display-time-zone";
import { lastSyncLabel, periodLabel } from "@/features/dashboard/presentation";
import { allMonthsPeriod, currentMonthPeriod, monthPeriod } from "@/features/dashboard/period";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { Select } from "@/components/ui/select";
import { MonthPicker } from "@/features/dashboard/components/month-picker";
import { resultMask } from "@/features/dashboard/components/result-mask";

type Props = Pick<DashboardController, "currencies" | "currency" | "moveMonth" | "period" | "results" | "selectPeriod" | "setCurrency" | "setPage" | "state" | "view">;

export function PeriodControls({
  currencies,
  currency,
  moveMonth,
  period,
  results,
  selectPeriod,
  setCurrency,
  setPage,
  state,
  view
}: Props) {
  const timeZone = useDisplayTimeZone();

  if (!state) {
    return null;
  }

  const allMonths = period.kind === "all";
  const latestSync = state.runs[0];

  return (
    <div className={styles["period-bar"]}>
      <div>
        <span className={clsx(ui["section-kicker"], view === "transactions" && resultMask(results.transactions))}>{view === "overview" ? "NET WORTH & CASH FLOW" : `${state.transactionCount} ${state.transactionCount === 1 ? "TRANSACTION" : "TRANSACTIONS"}`}</span>
        {view === "overview" && <span className={styles["subtle"]} title={latestSync ? describeDate(Temporal.Instant.from(latestSync.started_at).toZonedDateTimeISO(timeZone)).title : undefined}>{lastSyncLabel(latestSync, timeZone)}</span>}
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
        <MonthPicker
          label={periodLabel(period)}
          selected={period.kind === "month" ? period.month : null}
          onSelect={month => selectPeriod(monthPeriod(month))}
        />
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
