"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./period-controls.module.css";
import { CalendarRange, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { describeDate, periodLabel } from "@/lib/date-format";
import { useDisplayTimeZone } from "@/components/ui/use-display-time-zone";
import { lastSyncLabel } from "@/features/banking/sync-run-presentation";
import { allMonthsPeriod, currentMonthPeriod, monthPeriod } from "@/lib/period";
import { selectPeriod, setCurrency, useCurrency, usePeriod } from "@/client/use-app-url";
import { showsCurrencySelect } from "@/features/accounts/queries";
import { Select } from "@/components/ui/select";
import { MonthPicker } from "@/features/dashboard/components/month-picker";
import { shownStatus, valueMask } from "@/components/ui/result-presentation";
import { InlineFailure } from "@/components/ui/area-placeholder";
import type { Area } from "@/components/ui/use-area-result";
import type { SyncRun } from "@/features/banking/types";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";

type DisplayCurrencies = {
  /** The currencies in use and the selected one; until they load, no currency choice is offered. */
  currencies: Area<string[]>;
};

type Props = (DisplayCurrencies & {
  view: "overview";
  latestSync: Area<SyncRun | undefined>;
}) | (DisplayCurrencies & {
  view: "transactions";
  /** Matches for the selected filters. */
  transactionCount: Area<number>;
}) | {
  /** An account's details use the account's own currency, so they offer no display currency. */
  view: "account";
  transactionCount: Area<number>;
};

export function PeriodControls(props: Props) {
  const currencies = props.view === "account" ? [] : props.currencies.data ?? [];

  return (
    <div className={clsx(styles["period-bar"], props.view === "overview" && styles["overview-bar"])}>
      <div>
        {props.view === "overview" ? <OverviewKicker latestSync={props.latestSync} /> : <TransactionCount count={props.transactionCount} />}
      </div>
      {props.view === "overview" ? (
        <CurrencySelect currencies={currencies} />
      ) : (
        <div className={clsx(styles["period-controls"], !showsCurrencySelect(currencies) && styles["without-currency"])}>
          <CurrencySelect currencies={currencies} />
          <PeriodSelect />
        </div>
      )}
    </div>
  );
}

/** Choosing a currency picks which accounts' figures are shown, without conversion; with one currency in use there is nothing to choose. */
function CurrencySelect({ currencies }: {
  currencies: string[];
}) {
  const currency = useCurrency();

  if (!showsCurrencySelect(currencies)) {
    return null;
  }

  return (
    <Select
      variant="bare"
      aria-label="Accounts shown by currency"
      value={currency}
      onChange={event => setCurrency(event.target.value)}
    >
      {currencies.map(value => <option key={value} value={value}>{`${value} accounts`}</option>)}
    </Select>
  );
}

function PeriodSelect() {
  const locale = useLocale();
  const period = usePeriod();
  const allMonths = period.kind === "all";

  function moveMonth(months: number) {
    if (period.kind === "month") {
      selectPeriod(monthPeriod(period.month.add({
        months
      })));
    }
  }

  return (
    <>
      <button
        className={ui["icon-button"]}
        aria-label="Previous month"
        disabled={allMonths}
        onClick={() => moveMonth(-1)}
      >
        <ChevronLeft size={17} />
      </button>
      <MonthPicker
        label={periodLabel(period, locale)}
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
      <button
        type="button"
        className={styles["all-months"]}
        aria-pressed={allMonths}
        onClick={() => selectPeriod(allMonths ? currentMonthPeriod() : allMonthsPeriod)}
      >
        {allMonths ? <Check size={16} aria-hidden="true" /> : <CalendarRange size={16} aria-hidden="true" />}
        All months
      </button>
    </>
  );
}

function OverviewKicker({ latestSync }: {
  latestSync: Area<SyncRun | undefined>;
}) {
  const timeZone = useDisplayTimeZone();

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
  const locale = useLocale();

  if (latestSync.status === "pending") {
    if (latestSync.failure) {
      return <InlineFailure className={ui["subtle"]} failure={latestSync.failure} subject="The last sync" />;
    }

    return <span className={clsx(ui["subtle"], valueMask("loading"))}>Last sync: today · successful</span>;
  }

  const run = latestSync.data;

  return <span className={ui["subtle"]} title={run ? describeDate(Temporal.Instant.from(run.started_at).toZonedDateTimeISO(timeZone), locale).title : undefined}>{lastSyncLabel(run, timeZone, locale)}</span>;
}

function TransactionCount({ count }: {
  count: Area<number>
}) {
  const locale = useLocale();
  const shown = count.data ?? 0;

  return <span className={clsx(ui["section-kicker"], valueMask(shownStatus(count)))}>{`${formatCount(shown, locale)} ${shown === 1 ? "TRANSACTION" : "TRANSACTIONS"}`}</span>;
}
