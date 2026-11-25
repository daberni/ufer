"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import styles from "./insights-summary.module.css";
import { money, signedMoney } from "@/lib/money";
import { formatSignedPercent } from "@/lib/locale";
import { formatSavingsRate, netFlow } from "@/features/reports/cash-flow-selection";
import { shownStatus, valueMask } from "@/components/ui/result-presentation";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { useCurrency } from "@/client/use-app-url";
import { useLocale } from "@/client/locale-provider";
import type { Area } from "@/components/ui/use-area-result";
import type { Insights, NetWorthChangeComparison } from "@/features/insights/types";

type Props = {
  insights: Area<Insights>;
  netWorthChange: Area<NetWorthChangeComparison>;
};

/** Whether a rise is good news: more income, savings or net worth is, more expenses are not. */
type Direction = "higher-is-better" | "lower-is-better";

function tone(change: number, direction: Direction) {
  if (change === 0) {
    return undefined;
  }

  const better = direction === "higher-is-better" ? change > 0 : change < 0;

  return better ? ui["positive"] : ui["negative"];
}

/** Income, expenses, savings and net-worth change of the selected range, each against the previous interval over the same number of days. */
export function InsightsSummary({
  insights,
  netWorthChange
}: Props) {
  const t = useTranslations("insights.summary");
  const locale = useLocale();
  const selectedCurrency = useCurrency();
  const flowsMask = valueMask(shownStatus(insights));
  const netWorthMask = valueMask(shownStatus(netWorthChange));
  const currency = insights.data?.currency ?? selectedCurrency;
  const current = insights.data?.comparison.current;
  const previous = insights.data?.comparison.previous;
  const amount = (value: number) => money(value, currency, locale);

  function change(now: number, before: number) {
    const difference = now - before;
    const shown = signedMoney(difference, currency, locale);

    if (before <= 0) {
      return shown;
    }

    return t("changeWithRate", {
      amount: shown,
      percent: formatSignedPercent(difference / before, locale)
    });
  }

  const saved = current ? netFlow(current.income, current.expenses) : null;
  const savedBefore = previous ? netFlow(previous.income, previous.expenses) : null;
  const netWorth = netWorthChange.data;

  return (
    <section className={styles["summary"]} aria-label={t("label")}>
      <Figure
        label={t("income")}
        value={current ? amount(current.income) : amount(0)}
        detail={current && previous ? change(current.income, previous.income) : t("noComparison")}
        detailTone={current && previous ? tone(current.income - previous.income, "higher-is-better") : undefined}
        mask={flowsMask}
        area={insights}
        failureTitle={t("failure")}
      />
      <Figure
        label={t("expenses")}
        value={current ? amount(current.expenses) : amount(0)}
        detail={current && previous ? change(current.expenses, previous.expenses) : t("noComparison")}
        detailTone={current && previous ? tone(current.expenses - previous.expenses, "lower-is-better") : undefined}
        mask={flowsMask}
        area={insights}
        failureTitle={t("failure")}
      />
      <Figure
        label={t("saved")}
        value={saved ? amount(saved.net) : amount(0)}
        rate={formatSavingsRate(saved?.savingsRate ?? null, locale)}
        detail={saved && savedBefore ? t("savedChange", {
          amount: signedMoney(saved.net - savedBefore.net, currency, locale),
          rate: formatSavingsRate(savedBefore.savingsRate, locale)
        }) : t("noComparison")}
        detailTone={saved && savedBefore ? tone(saved.net - savedBefore.net, "higher-is-better") : undefined}
        mask={flowsMask}
        area={insights}
        failureTitle={t("failure")}
      />
      <Figure
        label={t("netWorthChange")}
        value={netWorth?.current === null || netWorth === undefined ? "–" : signedMoney(netWorth.current, currency, locale)}
        detail={netWorth && netWorth.current !== null && netWorth.previous !== null ? t("change", {
          amount: signedMoney(netWorth.current - netWorth.previous, currency, locale)
        }) : t("noComparison")}
        detailTone={netWorth && netWorth.current !== null && netWorth.previous !== null ? tone(netWorth.current - netWorth.previous, "higher-is-better") : undefined}
        mask={netWorthMask}
        area={netWorthChange}
        failureTitle={t("netWorthFailure")}
      />
    </section>
  );
}

function Figure({
  label,
  value,
  rate,
  detail,
  detailTone,
  mask,
  area,
  failureTitle
}: {
  label: string;
  value: string;
  rate?: string;
  detail: string;
  detailTone?: string;
  mask: string;
  /** The request behind the figure; a failed first load shows its reason and a retry instead of the values. */
  area: Area<unknown>;
  failureTitle: string;
}) {
  if (area.status === "pending" && area.failure) {
    return (
      <div className={clsx(ui["panel"], styles["figure"])}>
        <span className={styles["label"]}>{label}</span>
        <AreaPlaceholder area={area} failureTitle={failureTitle}>{null}</AreaPlaceholder>
      </div>
    );
  }

  return (
    <div className={clsx(ui["panel"], styles["figure"])}>
      <span className={styles["label"]}>{label}</span>
      <strong className={styles["value"]}>
        <span className={mask}>{value}</span>
        {rate && <small className={clsx(styles["rate"], mask)}>{rate}</small>}
      </strong>
      <span className={clsx(styles["detail"], mask)}><span className={detailTone}>{detail}</span></span>
    </div>
  );
}
