"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./period-controls.module.css";
import { CalendarRange, Check } from "lucide-react";
import { periodLabel } from "@/lib/date-format";
import { allMonthsPeriod, currentMonthPeriod, monthPeriod } from "@/lib/period";
import { selectPeriod, usePeriod } from "@/client/use-app-url";
import { showsCurrencySelect } from "@/features/accounts/queries";
import { CurrencyChoice } from "@/features/accounts/components/currency-choice";
import { PeriodStepper } from "@/components/ui/period-stepper";
import { shownStatus, valueMask } from "@/components/ui/result-presentation";
import type { Area } from "@/components/ui/use-area-result";
import { useLocale } from "@/client/locale-provider";
import { useTranslations } from "next-intl";

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
  const controls = (
    <div className={clsx(styles["period-controls"], !showsCurrencySelect(currencies) && styles["without-currency"])}>
      <CurrencyChoice currencies={currencies} />
      <PeriodSelect />
    </div>
  );

  // The transactions section heading holds the controls in its row; an account's details give them a row with the count.
  if (props.view === "transactions") {
    return controls;
  }

  return (
    <div className={styles["period-bar"]}>
      <div>
        <TransactionCount count={props.transactionCount} />
      </div>
      {controls}
    </div>
  );
}

function PeriodSelect() {
  const t = useTranslations("overview.period");
  const locale = useLocale();
  const period = usePeriod();
  const allMonths = period.kind === "all";

  return (
    <>
      <PeriodStepper
        label={periodLabel(period, locale, t("allMonths"))}
        previousLabel={t("previousMonth")}
        nextLabel={t("nextMonth")}
        unit="month"
        selected={period.kind === "month" ? period.month.toPlainDate({
          day: 1
        }) : null}
        onSelect={start => selectPeriod(monthPeriod(start.toPlainYearMonth()))}
        onStep={months => {
          if (period.kind === "month") {
            selectPeriod(monthPeriod(period.month.add({
              months
            })));
          }
        }}
        stepDisabled={allMonths}
      />
      <button
        type="button"
        className={styles["all-months"]}
        aria-pressed={allMonths}
        onClick={() => selectPeriod(allMonths ? currentMonthPeriod() : allMonthsPeriod)}
      >
        {allMonths ? <Check size={16} aria-hidden="true" /> : <CalendarRange size={16} aria-hidden="true" />}
        {t("allMonths")}
      </button>
    </>
  );
}

function TransactionCount({ count }: {
  count: Area<number>
}) {
  const t = useTranslations("overview.period");
  const shown = count.data ?? 0;

  return (
    <span className={clsx(ui["section-kicker"], valueMask(shownStatus(count)))}>{t("transactionCount", {
      count: shown
    })}</span>
  );
}
