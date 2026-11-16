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
import { selectPeriod, setCurrency, useCurrency, usePeriod } from "@/features/dashboard/use-dashboard-url";
import { Select } from "@/components/ui/select";
import { MonthPicker } from "@/features/dashboard/components/month-picker";
import { shownStatus, valueMask } from "@/features/dashboard/components/result-presentation";
import { InlineFailure } from "@/features/dashboard/components/area-placeholder";
import type { Area } from "@/features/dashboard/use-area-result";
import type { SyncRun } from "@/features/dashboard/types";

type Props = {
  /** The currencies of all accounts; until they load, only the selected one is offered. */
  currencies: Area<string[]>;
} & ({
  view: "overview";
  latestSync: Area<SyncRun | undefined>;
} | {
  view: "transactions";
  /** Matches for the selected filters. */
  transactionCount: Area<number>;
});

export function PeriodControls(props: Props) {
  const currency = useCurrency();
  const currencies = props.currencies.data ?? [currency];
  const period = usePeriod();
  const timeZone = useDisplayTimeZone();
  const allMonths = period.kind === "all";

  function moveMonth(months: number) {
    if (period.kind === "month") {
      selectPeriod(monthPeriod(period.month.add({
        months
      })));
    }
  }

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
  latestSync: Area<SyncRun | undefined>;
  timeZone: string;
}) {
  return (
    <>
      <span className={ui["section-kicker"]}>NET WORTH & CASH FLOW</span>
      <LatestSync latestSync={latestSync} timeZone={timeZone} />
    </>
  );
}

function LatestSync({
  latestSync,
  timeZone
}: {
  latestSync: Area<SyncRun | undefined>;
  timeZone: string;
}) {
  if (latestSync.status === "pending") {
    if (latestSync.failure) {
      return <InlineFailure className={styles["subtle"]} failure={latestSync.failure} subject="The last sync" />;
    }

    return <span className={clsx(styles["subtle"], valueMask("loading"))}>Last sync: today · successful</span>;
  }

  const run = latestSync.data;

  return <span className={styles["subtle"]} title={run ? describeDate(Temporal.Instant.from(run.started_at).toZonedDateTimeISO(timeZone)).title : undefined}>{lastSyncLabel(run, timeZone)}</span>;
}

function TransactionCount({ count }: {
  count: Area<number>
}) {
  const shown = count.data ?? 0;

  return <span className={clsx(ui["section-kicker"], valueMask(shownStatus(count)))}>{`${shown} ${shown === 1 ? "TRANSACTION" : "TRANSACTIONS"}`}</span>;
}
