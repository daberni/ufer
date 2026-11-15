"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./period-controls.module.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { describeDate } from "@/lib/date-format";
import { useDisplayTimeZone } from "@/components/ui/use-display-time-zone";
import { lastSyncLabel, monthLabel } from "@/features/dashboard/presentation";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { Select } from "@/components/ui/select";

type Props = Pick<DashboardController, "currencies" | "currency" | "month" | "moveMonth" | "setCurrency" | "setMonth" | "setPage" | "state" | "view">;

export function PeriodControls({
  currencies,
  currency,
  month,
  moveMonth,
  setCurrency,
  setMonth,
  setPage,
  state,
  view
}: Props) {
  const timeZone = useDisplayTimeZone();

  if (!state) {
    return null;
  }

  const latestSync = state.runs[0];

  return (
    <div className={styles["period-bar"]}>
      <div>
        <span className={ui["section-kicker"]}>{view === "overview" ? "NET WORTH & MONTHLY CASH FLOW" : `${state.transactionCount} ${state.transactionCount === 1 ? "TRANSACTION" : "TRANSACTIONS"}`}</span>
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
        <button className={ui["icon-button"]} aria-label="Previous month" onClick={() => moveMonth(-1)}>
          <ChevronLeft size={17} />
        </button>
        <label className={styles["month-label"]}>
          <span>{monthLabel(month)}</span>
          <input
            aria-label="Select month"
            type="month"
            value={month}
            onChange={event => {
              if (event.target.value) {
                setMonth(event.target.value);
                setPage(1);
              }
            }}
          />
        </label>
        <button className={ui["icon-button"]} aria-label="Next month" onClick={() => moveMonth(1)}>
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
