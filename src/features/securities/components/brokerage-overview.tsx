"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./brokerage-overview.module.css";
import summaryStyles from "../../accounts/components/account-summary.module.css";
import accountStyles from "../../accounts/components/account-presentation.module.css";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { FormError } from "@/components/ui/form-error";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { accountIcon } from "@/features/accounts/account-presentation";
import { useAccountHref } from "@/client/use-app-url";
import { money, signedMoney } from "@/lib/money";
import { activeAccounts, useAccounts } from "@/features/accounts/queries";
import type { Account } from "@/features/accounts/types";
import { useBrokerageTrades, useCombinedBrokeragePerformance, useSecurities } from "../queries";
import type { CombinedBrokeragePerformance } from "../types";
import { HoldingsTable, HoldingsTableSkeleton } from "./brokerage-panel";
import { PerformanceView } from "./performance-panel";
import { ChangeFigures, ChangeFiguresSkeleton } from "./change-figures";

/**
 * All active brokerage accounts together: the combined value and time-weighted performance per currency, then each account with its value, gain and holdings.
 * Holdings are grouped by account, so each group links to the account where trades are added; each holding opens its page with its prices and trades.
 */
export function BrokerageOverview() {
  const t = useTranslations("securities");
  const accounts = useAccounts();
  const performance = useCombinedBrokeragePerformance();

  if (accounts.isError) {
    return <FormError failure={toFailure(accounts.error)} />;
  }

  const brokerage = activeAccounts(accounts.data ?? []).filter(account => account.kind === "brokerage");

  if (accounts.data && !brokerage.length) {
    return (
      <section className={ui["panel"]}>
        <Empty title={t("overview.noAccountsTitle")} illustration={null}>{t("overview.noAccountsBody")}</Empty>
      </section>
    );
  }

  const series = performance.data?.currencies ?? [];
  const many = series.length > 1;
  // The combined value adds up the accounts' balances, so both queries are needed before it replaces its skeleton.
  const combinedPending = !performance.isError && (performance.isPending || accounts.isPending);

  return (
    <div className={styles["overview"]} aria-busy={combinedPending || accounts.isPending}>
      {combinedPending && (
        <div className={styles["combined"]}>
          <CombinedValueSkeleton />
          <PerformanceView
            title={t("performance.title")}
            isPending
            isError={false}
            performance={undefined}
          />
        </div>
      )}
      {performance.isError && (
        <PerformanceView
          title={t("performance.title")}
          isPending={false}
          isError
          performance={undefined}
        />
      )}
      {!combinedPending && series.map(item => (
        <div key={item.currency} className={styles["combined"]}>
          <CombinedValue item={item} accounts={brokerage} />
          <PerformanceView
            title={many ? t("performance.titleInCurrency", {
              currency: item.currency
            }) : t("performance.title")}
            isPending={false}
            isError={false}
            performance={item}
          />
        </div>
      ))}
      <h2 className={styles["section-title"]}>{t("overview.accounts")}</h2>
      {accounts.isPending && <AccountHoldingsSkeleton />}
      {brokerage.map(account => <AccountHoldings key={account.id} account={account} />)}
    </div>
  );
}

/** The combined value of all active brokerage accounts in one currency, in the same value card layout and figure rows as a brokerage account's page. */
function CombinedValue({
  item,
  accounts
}: {
  item: CombinedBrokeragePerformance["currencies"][number];
  accounts: Account[];
}) {
  const t = useTranslations("securities.overview");
  const source = useTranslations("accounts.source");
  const locale = useLocale();
  const value = accounts.filter(account => account.currency === item.currency).reduce((sum, account) => sum + (account.balance_minor ?? 0), 0);
  const Icon = accountIcon("brokerage");

  return (
    <section
      className={clsx(ui["panel"], summaryStyles["summary"])}
      aria-label={t("combinedValueIn", {
        currency: item.currency
      })}
    >
      <div className={summaryStyles["header"]}>
        <span className={clsx(accountStyles["account-logo"], accountStyles["brokerage"])}>
          <Icon size={23} aria-hidden="true" />
        </span>
        <p className={summaryStyles["meta"]}>{t("allAccounts", {
          count: item.account_ids.length
        })}</p>
      </div>
      <div className={summaryStyles["balance-row"]}>
        <strong className={summaryStyles["balance"]}>{money(value, item.currency, locale)}</strong>
      </div>
      <p className={summaryStyles["status"]}>{source("trades")}</p>
      <ChangeFigures
        summary={item.summary}
        totalReturn={item.total_return}
        currency={item.currency}
      />
    </section>
  );
}

function CombinedValueSkeleton() {
  const t = useTranslations("securities.overview");
  const source = useTranslations("accounts.source");

  return (
    <section className={clsx(ui["panel"], summaryStyles["summary"])} aria-hidden="true">
      <div className={summaryStyles["header"]}>
        <span className={clsx(accountStyles["account-logo"], ui["skeleton"])} />
        <span className={clsx(summaryStyles["meta"], ui["skeleton"])}>{t("allAccounts", {
          count: 2
        })}</span>
      </div>
      <div className={summaryStyles["balance-row"]}>
        <strong className={summaryStyles["balance"]}>
          <span className={ui["skeleton"]}>€00,000.00</span>
        </strong>
      </div>
      <p className={summaryStyles["status"]}>
        <span className={ui["skeleton"]}>{source("trades")}</span>
      </p>
      <ChangeFiguresSkeleton />
    </section>
  );
}

/** A brokerage account's heading and holdings before the accounts are known. */
function AccountHoldingsSkeleton() {
  const t = useTranslations("securities.tradeForm");

  return (
    <section className={ui["panel"]} aria-hidden="true">
      <div className={styles["account-link"]}>
        <h3><span className={ui["skeleton"]}>{t("brokerageAccount")}</span></h3>
        <AccountFiguresSkeleton />
        <ArrowRight size={16} aria-hidden="true" />
      </div>
      <HoldingsTableSkeleton />
    </section>
  );
}

function AccountFiguresSkeleton() {
  const t = useTranslations("securities.overview");

  return (
    <span className={styles["account-figures"]} aria-hidden="true">
      <strong className={ui["skeleton"]}>€00,000.00</strong>
      <small className={ui["skeleton"]}>{t("totalGain", {
        amount: "+€0,000.00"
      })}</small>
    </span>
  );
}

/** One brokerage account: a heading row linking to its page with value and gain, then its holdings in the account's table. */
function AccountHoldings({ account }: {
  account: Account
}) {
  const t = useTranslations("securities.overview");
  const locale = useLocale();
  const accountHref = useAccountHref();
  const trades = useBrokerageTrades(account.id);
  const securities = useSecurities();
  const held = trades.data?.valuation.holdings.filter(holding => holding.quantity_micros > 0) ?? [];
  const headingId = `${account.id}-overview`;

  return (
    <section className={ui["panel"]} aria-labelledby={headingId} aria-busy={trades.isPending}>
      <Link className={styles["account-link"]} href={accountHref(account.id)}>
        <h3 id={headingId}>{account.name}</h3>
        {trades.isPending ? <AccountFiguresSkeleton /> : (
          <span className={styles["account-figures"]}>
            {trades.data && <strong>{money(trades.data.valuation.value_minor, account.currency, locale)}</strong>}
            {trades.data && trades.data.trades.length > 0 && (
              <small className={clsx(trades.data.summary.total.gain_minor > 0 && ui["positive"])} data-negative={trades.data.summary.total.gain_minor < 0 ? "" : undefined}>{t("totalGain", {
                amount: signedMoney(trades.data.summary.total.gain_minor, account.currency, locale)
              })}</small>
            )}
          </span>
        )}
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
      {trades.isPending && <HoldingsTableSkeleton />}
      {trades.isError && <FormError failure={toFailure(trades.error)} />}
      {trades.data && (held.length ? (
        <HoldingsTable
          label={t("holdingsOf", {
            name: account.name
          })}
          holdings={held}
          trades={trades.data.trades}
          securities={securities.data?.securities ?? []}
          currency={account.currency}
          accountId={account.id}
        />
      ) : <p className={styles["note"]}>{trades.data.trades.length > 0 ? t("noOpenPositions") : t("noHoldings")}</p>)}
    </section>
  );
}
