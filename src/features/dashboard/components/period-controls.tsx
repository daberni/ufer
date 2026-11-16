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
import { valueMask } from "@/features/dashboard/components/result-presentation";
import type { AreaResult } from "@/features/dashboard/use-area-result";
import type { SyncRun } from "@/features/dashboard/types";

type Props = Pick<DashboardController, "currency" | "moveMonth" | "period" | "selectPeriod" | "setCurrency"> & {
  currencies: string[];
} & ({
  view: "overview";
  latestSync: SyncRun | undefined;
} | {
  view: "transactions";
  /** Matches for the selected filters. */
  transactionCount: AreaResult<number>;
});

export function PeriodControls(props: Props) {
  const {
    currencies,
    currency,
    moveMonth,
    period,
    selectPeriod,
    setCurrency
  } = props;
  const timeZone = useDisplayTimeZone();
  const allMonths = period.kind === "all";

  return (
    <div className={styles["period-bar"]}>
      <div>
        {props.view === "overview" ? <OverviewKicker latestSync={props.latestSync} timeZone={timeZone} /> : <TransactionCount count={props.transactionCount} />}
      </div>       <div className={styles["period-controls"]}>
        <Select
          variant="bare"
          aria-label="Display currency"
          value={currency}
          onChange={event => setCurrency(event.target.value)}
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

function OverviewKicker({
  latestSync,
  timeZone
}: {
  latestSync: SyncRun | undefined;
  timeZone: string;
}) {
  return (
    <>
      <span className={ui["section-kicker"]}>NET WORTH & CASH FLOW</span>
      <span className={ui["subtle"]} title={latestSync ? describeDate(Temporal.Instant.from(latestSync.started_at).toZonedDateTimeISO(timeZone)).title : undefined}>{lastSyncLabel(latestSync, timeZone)}</span>
    </>
  );
}

function TransactionCount({ count }: {
  count: AreaResult<number>
}) {
  return <span className={clsx(ui["section-kicker"], valueMask(count.status))}>{`${count.data} ${count.data === 1 ? "TRANSACTION" : "TRANSACTIONS"}`}</span>;
}
