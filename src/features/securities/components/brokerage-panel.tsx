"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./brokerage-panel.module.css";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { ChevronRight } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { FormError } from "@/components/ui/form-error";
import { Tooltip } from "@/components/ui/tooltip";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { dateWithYear } from "@/lib/date-format";
import { money, signedMoney } from "@/lib/money";
import type { Account } from "@/features/accounts/types";
import { holdingPath } from "@/client/app-location";
import { useBrokerageTrades, useSecurities } from "../queries";
import type { Holding, Security, Trade } from "../types";
import { averageCostMicros } from "../holdings";
import { formatPrice, formatQuantity, priceDigits } from "./holding-format";

/**
 * A brokerage account's holdings: one row per security with quantity, average cost (Einstandskurs), cost basis (Einstandswert), current price, value and gain.
 * Each row opens the holding's page with its prices, buys, sells and transfers.
 */
export function BrokeragePanel({ account }: {
  account: Account
}) {
  const t = useTranslations("securities.holdings");
  const trades = useBrokerageTrades(account.id);
  const securities = useSecurities();
  const priceSource = securities.data?.price_source;

  // The price-source notice comes from the securities query and sits above the table, so the skeleton waits for both.
  if (!trades.isError && (trades.isPending || securities.isPending)) {
    return (
      <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={`${account.id}-holdings`} aria-busy="true">
        <h2 id={`${account.id}-holdings`}>{t("title")}</h2>
        <HoldingsTableSkeleton />
      </section>
    );
  }

  if (trades.isError) {
    return (
      <section className={clsx(ui["panel"], styles["panel"])}>
        <h2>{t("title")}</h2>
        <FormError failure={toFailure(trades.error)} />
      </section>
    );
  }

  const { valuation } = trades.data;
  const open = valuation.holdings.filter(holding => holding.quantity_micros > 0);
  const closed = valuation.holdings.filter(holding => holding.quantity_micros === 0);

  return (
    <>
      <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={`${account.id}-holdings`}>
        <h2 id={`${account.id}-holdings`}>{t("title")}</h2>
        {priceSource && !priceSource.configured && (
          <p className={styles["notice"]}>{t("priceSourceNotice")}</p>
        )}
        {open.length ? (
          <HoldingsTable
            label={t("title")}
            holdings={open}
            trades={trades.data.trades}
            securities={securities.data?.securities ?? []}
            currency={account.currency}
            accountId={account.id}
          />
        ) : <Empty title={t("emptyTitle")} illustration={null}>{t("emptyBody")}</Empty>}
      </section>
      {closed.length > 0 && (
        <section className={clsx(ui["panel"], styles["panel"])} aria-labelledby={`${account.id}-closed`}>
          <h2 id={`${account.id}-closed`}>{t("closed")}</h2>
          <HoldingsTable
            label={t("closed")}
            holdings={closed}
            trades={trades.data.trades}
            securities={securities.data?.securities ?? []}
            currency={account.currency}
            accountId={account.id}
          />
        </section>
      )}
    </>
  );
}

/** Holdings in a table; with an account, each row opens its holding's page. The Brokerage overview reuses it per account, and a holding's page shows its own row. */
export function HoldingsTable({
  label,
  holdings,
  trades,
  securities,
  currency,
  accountId,
  priceDigits: digitsOverride
}: {
  label: string;
  holdings: Holding[];
  /** The account's trades; their prices set the decimals of each holding's per-share figures. */
  trades: Trade[];
  securities: Security[];
  currency: string;
  accountId?: string;
  /** Decimals for per-share figures, so a holding's page matches them with its trades and prices. */
  priceDigits?: number;
}) {
  const t = useTranslations("securities.holdings.columns");
  const locale = useLocale();
  const byId = new Map(securities.map(security => [security.id, security]));

  return (
    <div className={styles["table"]} role="table" aria-label={label}>
      <div className={clsx(styles["row"], styles["head"])} role="row">
        <span role="columnheader">{t("security")}</span>
        <span role="columnheader" className={styles["number"]}>{t("shares")}</span>
        <span role="columnheader" className={styles["number"]}>{t("averageCost")}</span>
        <span role="columnheader" className={styles["number"]}>{t("costBasis")}</span>
        <span role="columnheader" className={styles["number"]}>{t("price")}</span>
        <span role="columnheader" className={styles["number"]}>{t("value")}</span>
        <span role="columnheader" className={styles["number"]}>{t("gain")}</span>
      </div>
      {holdings.map(holding => (
        <HoldingRow
          key={holding.security_id}
          holding={holding}
          trades={trades.filter(trade => trade.security_id === holding.security_id)}
          security={byId.get(holding.security_id)}
          currency={currency}
          locale={locale}
          href={accountId ? holdingPath(accountId, holding.security_id) : undefined}
          digits={digitsOverride}
        />
      ))}
    </div>
  );
}

/** The holdings table's columns with placeholder rows, held while the holdings load. */
export function HoldingsTableSkeleton({ rows = 2 }: {
  rows?: number
}) {
  const t = useTranslations("securities.holdings.columns");

  return (
    <div className={styles["table"]} aria-hidden="true">
      <div className={clsx(styles["row"], styles["head"])}>
        <span>{t("security")}</span>
        <span className={styles["number"]}>{t("shares")}</span>
        <span className={styles["number"]}>{t("averageCost")}</span>
        <span className={styles["number"]}>{t("costBasis")}</span>
        <span className={styles["number"]}>{t("price")}</span>
        <span className={styles["number"]}>{t("value")}</span>
        <span className={styles["number"]}>{t("gain")}</span>
      </div>
      {Array.from({
        length: rows
      }, (_, index) => (
        <div key={index} className={styles["row"]}>
          <span className={clsx(styles["security"], styles["skeleton-security"])}>
            <strong className={ui["skeleton"]}>Global equity ETF</strong>
            <small className={ui["skeleton"]}>IE00B0000000</small>
          </span>
          <span className={styles["number"]} data-label={t("shares")}><span className={ui["skeleton"]}>00.000</span></span>
          <span className={styles["number"]} data-label={t("averageCost")}><span className={ui["skeleton"]}>€00.00</span></span>
          <span className={styles["number"]} data-label={t("costBasis")}><span className={ui["skeleton"]}>€0,000.00</span></span>
          <span className={styles["number"]} data-label={t("price")}>
            <span className={ui["skeleton"]}>€00.00</span>
            <small className={ui["skeleton"]}>23 Nov 2026</small>
          </span>
          <span className={clsx(styles["number"], styles["value"])} data-label={t("value")}><span className={ui["skeleton"]}>€0,000.00</span></span>
          <span className={styles["number"]} data-label={t("gain")}>
            <span className={ui["skeleton"]}>+€000.00</span>
            <small className={ui["skeleton"]}>+0.0%</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function percent(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    signDisplay: "exceptZero",
    maximumFractionDigits: 1
  }).format(value);
}

function HoldingRow({
  holding,
  trades,
  security,
  currency,
  locale,
  href,
  digits: digitsOverride
}: {
  holding: Holding;
  trades: Trade[];
  security: Security | undefined;
  currency: string;
  locale: string;
  href?: string;
  digits?: number;
}) {
  const t = useTranslations("securities.holdings");
  const held = holding.quantity_micros > 0;
  const gain = held ? holding.value_minor - holding.cost_minor : holding.realized_minor;
  const showGain = !held || holding.status !== "missing";
  const gainPercent = held && holding.cost_minor > 0 && showGain ? gain / holding.cost_minor : null;
  // Per-share figures of one holding share their decimals; the average cost is rounded to them.
  const digits = digitsOverride ?? priceDigits([...trades.filter(trade => !trade.transfer).map(trade => trade.price_micros), ...holding.price ? [holding.price.close_micros] : []], currency);
  const averageCost = held ? averageCostMicros(holding.cost_minor, holding.quantity_micros, currency) : null;
  const name = (
    <span>
      <strong>{holding.security_name}</strong>
      {security?.isin && security.isin !== holding.security_name && <small className={styles["isin"]}>{security.isin}</small>}
    </span>
  );

  return (
    <div className={clsx(styles["row"], href && styles["holding"])} role="row">
      <span role="rowheader" className={styles["security"]}>
        {href ? (
          <Link className={styles["open-holding"]} href={href}>
            {name}
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        ) : name}
      </span>
      <span role="cell" className={styles["number"]} data-label={t("columns.shares")}>{held ? formatQuantity(holding.quantity_micros, locale) : t("sold")}</span>
      <span role="cell" className={styles["number"]} data-label={t("columns.averageCost")}>{averageCost === null ? "—" : formatPrice(averageCost, currency, locale, digits)}</span>
      <span role="cell" className={styles["number"]} data-label={t("columns.costBasis")}>{held ? money(holding.cost_minor, currency, locale) : "—"}</span>
      <span role="cell" className={styles["number"]} data-label={t("columns.price")}>
        <PriceCell
          holding={holding}
          security={security}
          currency={currency}
          locale={locale}
          digits={digits}
        />
      </span>
      <span role="cell" className={clsx(styles["number"], styles["value"])} data-label={t("columns.value")}>{held ? money(holding.value_minor, currency, locale) : "—"}</span>
      <span role="cell" className={clsx(styles["number"], showGain && gain > 0 && ui["positive"], showGain && gain < 0 && ui["negative"])} data-label={held ? t("columns.gain") : t("columns.realized")}>
        {showGain ? signedMoney(gain, currency, locale) : "—"}
        {gainPercent !== null && <small>{percent(gainPercent, locale)}</small>}
      </span>
    </div>
  );
}

/** The price a holding is valued with and its date; its listing and closing date are in a tooltip. Without a price, why there is none. */
function PriceCell({
  holding,
  security,
  currency,
  locale,
  digits
}: {
  holding: Holding;
  security: Security | undefined;
  currency: string;
  locale: string;
  digits: number;
}) {
  const t = useTranslations("securities.holdings");

  if (holding.quantity_micros === 0) {
    return "—";
  }

  if (holding.status === "missing" || !holding.price) {
    return (
      <Tooltip text={security?.price_error ?? t("noPriceKnown")}>
        {trigger => (
          <span {...trigger} className={styles["warning"]}>
            {t("noPrice")}
            <small>{t("valuedAtCost")}</small>
          </span>
        )}
      </Tooltip>
    );
  }

  const date = dateWithYear(Temporal.PlainDate.from(holding.price.date), locale);
  const venue = security?.venue ?? security?.provider_symbol?.split(".").at(-1);
  const listing = [venue, security?.provider_symbol && security.provider_symbol !== venue ? security.provider_symbol : null].filter(Boolean);
  const stale = holding.status === "stale";
  const tip = [t("closingPrice", {
    date
  }), listing.join(", "), stale ? t("notUpdatedRecently") : ""].filter(Boolean).join(" · ");

  return (
    <Tooltip text={tip}>
      {trigger => (
        <span {...trigger} className={styles["price"]}>
          {formatPrice(holding.price!.close_micros, currency, locale, digits)}
          <small className={clsx(stale && styles["warning"])}>{date}</small>
        </span>
      )}
    </Tooltip>
  );
}
