"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useState } from "react";
import styles from "./balance-history.module.css";
import { money } from "@/lib/money";
import { describeBalanceDate, isKnownBankBalanceType } from "@/features/accounts/balance-presentation";
import { useTranslations } from "next-intl";
import { BalanceHistoryChart, BalanceHistoryChartSkeleton } from "./balance-history-chart";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps } from "@/components/ui/result-presentation";
import type { Area, AreaResult } from "@/components/ui/use-area-result";
import type { BalanceHistory, ReportedBalance } from "@/features/accounts/types";
import { useLocale } from "@/client/locale-provider";

// The table starts with the latest balances; the chart already shows the whole history.
const initialRows = 5;

export function BalanceHistoryPanel({ history }: {
  history: Area<BalanceHistory>
}) {
  const t = useTranslations("accounts.history");
  const locale = useLocale();

  return (
    <section className={clsx(ui["panel"], styles["history"])}>
      <div className={ui["card-heading"]}>
        <h2>{t("title")}</h2>
        {history.status === "pending" && <span className={clsx(ui["subtle"], styles["range"], ui["skeleton"])} aria-hidden="true">Since 12 Jan 2025</span>}
        {history.status !== "pending" && history.data.balances.length > 0 && (
          <span className={clsx(ui["subtle"], styles["range"])} title={describeBalanceDate(history.data.balances[0].date, locale).title}>{t("since", {
            date: describeBalanceDate(history.data.balances[0].date, locale).label
          })}</span>
        )}
      </div>
      {history.status === "pending" ? (
        <AreaPlaceholder area={history} failureTitle={t("failure")}>
          <BalanceHistoryChartSkeleton />
        </AreaPlaceholder>
      ) : <HistoryContent history={history} />}
    </section>
  );
}

function HistoryContent({ history }: {
  history: AreaResult<BalanceHistory>
}) {
  const t = useTranslations("accounts.history");
  const {
    balances,
    currency,
    reported
  } = history.data;

  if (!balances.length && !reported.length) {
    return <p className={styles["note"]}>{t("empty")}</p>;
  }

  return (
    <div {...areaProps(history.status)}>
      {balances.length > 1 ? <BalanceHistoryChart balances={balances} currency={currency} interactive={history.status === "ready"} /> : <p className={styles["note"]}>{t("single")}</p>}
      <ReportedBalanceTable reported={reported} currency={currency} />
    </div>
  );
}

function ReportedBalanceTable({
  reported,
  currency
}: {
  reported: ReportedBalance[];
  currency: string;
}) {
  const t = useTranslations("accounts.history");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const newestFirst = reported.toReversed();
  const shown = expanded ? newestFirst : newestFirst.slice(0, initialRows);
  const latest = newestFirst[0];
  const currentStart = latest && latest.difference_minor !== 0 ? newestFirst.find(report => report.difference_started) : undefined;

  if (!latest) {
    return null;
  }

  // The bank's classification of a reported balance, such as "Closing booked"; an unknown code is shown as reported.
  function bankBalanceType(type: string | null) {
    if (!type) {
      return t("balanceTypes.reported");
    }

    return isKnownBankBalanceType(type) ? t(`balanceTypes.${type}`) : type;
  }

  return (
    <>
      {currentStart && (
        <p className={styles["note"]}>
          {t.rich("differenceStarted", {
            date: () => <time dateTime={currentStart.date}>{describeBalanceDate(currentStart.date, locale).label}</time>
          })}
        </p>
      )}
      <table className={styles["table"]}>
        <caption className={ui["visually-hidden"]}>{t("caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("date")}</th>
            <th scope="col" className={styles["amount"]}>{t("reported")}</th>
            <th scope="col" className={clsx(styles["amount"], styles["calculated"])}>{t("calculated")}</th>
            <th scope="col" className={styles["amount"]}>{t("difference")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(report => (
            <tr key={report.date} className={clsx(report.difference_started && styles["started"])}>
              <th scope="row">
                <time dateTime={report.date} title={describeBalanceDate(report.date, locale).title}>{describeBalanceDate(report.date, locale).label}</time>
                <span className={styles["detail"]}>{report.difference_started ? t("differenceStarts") : bankBalanceType(report.bank_balance_type)}</span>
              </th>
              <td className={styles["amount"]}>{money(report.amount_minor, currency, locale)}</td>
              <td className={clsx(styles["amount"], styles["calculated"])}>{money(report.calculated_minor, currency, locale)}</td>
              <td className={clsx(styles["amount"], report.difference_minor !== 0 && styles["mismatch"])}>{report.difference_minor === 0 ? t("none") : money(report.difference_minor, currency, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {reported.length > initialRows && (
        <button className={ui["text-button"]} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? t("showLatest") : t("showAll", {
            count: reported.length
          })}
        </button>
      )}
    </>
  );
}
