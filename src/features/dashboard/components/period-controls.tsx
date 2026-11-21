"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./period-controls.module.css";
import { CalendarRange, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { periodLabel } from "@/lib/date-format";
import { allMonthsPeriod, currentMonthPeriod, monthPeriod } from "@/lib/period";
import { selectPeriod, usePeriod } from "@/client/use-app-url";
import { showsCurrencySelect } from "@/features/accounts/queries";
import { CurrencyChoice } from "@/features/accounts/components/currency-choice";
import { MonthPicker } from "@/features/dashboard/components/month-picker";
import { shownStatus, valueMask } from "@/components/ui/result-presentation";
import type { Area } from "@/components/ui/use-area-result";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";

type DisplayCurrencies = {
  /** The currencies in use and the selected one; until they load, no currency choice is offered. */
  currencies: Area<string[]>;
};

type Props = (DisplayCurrencies & {
  /** The transactions section heading shows the count for the selected filters. */
  view: "transactions";
}) | {
  /** An account's details use the account's own currency, so they offer no display currency. */
  view: "account";
  transactionCount: Area<number>;
};

export function PeriodControls(props: Props) {
  const currencies = props.view === "account" ? [] : props.currencies.data ?? [];

  return (
    <div className={styles["period-bar"]}>
      <div>
        {props.view === "account" && <TransactionCount count={props.transactionCount} />}
      </div>
      <div className={clsx(styles["period-controls"], !showsCurrencySelect(currencies) && styles["without-currency"])}>
        <CurrencyChoice currencies={currencies} />
        <PeriodSelect />
      </div>
    </div>
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

function TransactionCount({ count }: {
  count: Area<number>
}) {
  const locale = useLocale();
  const shown = count.data ?? 0;

  return <span className={clsx(ui["section-kicker"], valueMask(shownStatus(count)))}>{`${formatCount(shown, locale)} ${shown === 1 ? "TRANSACTION" : "TRANSACTIONS"}`}</span>;
}
