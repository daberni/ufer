"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./brokerage-overview.module.css";

import { useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { FormError } from "@/components/ui/form-error";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { useAccountHref } from "@/client/use-app-url";
import { money, signedMoney } from "@/lib/money";
import { activeAccounts, useAccounts } from "@/features/accounts/queries";
import type { Account } from "@/features/accounts/types";
import { useBrokerageTrades, useCombinedBrokeragePerformance, useSecurities } from "../queries";
import type { CombinedBrokeragePerformance } from "../types";
import { HoldingsTable } from "./brokerage-panel";
import { PerformanceView } from "./performance-panel";
import { BookingDialog } from "./booking-dialog";
import { ChangeFigures } from "./change-figures";

/**
 * All active brokerage accounts together: the combined value and time-weighted performance per currency, then each account with its value, gain and holdings.
 * Holdings are grouped by account, so each group links to the account where trades are added.
 */
export function BrokerageOverview() {
  const accounts = useAccounts();
  const performance = useCombinedBrokeragePerformance();
  const [booking, setBooking] = useState<string | null>(null);

  if (accounts.isError) {
    return <FormError failure={toFailure(accounts.error)} />;
  }

  const brokerage = activeAccounts(accounts.data ?? []).filter(account => account.kind === "brokerage");

  if (accounts.data && !brokerage.length) {
    return (
      <section className={ui["panel"]}>
        <Empty title="No brokerage accounts yet" illustration={null}>Add a brokerage account under Accounts &amp; assets to track holdings, trades and performance.</Empty>
      </section>
    );
  }

  const series = performance.data?.currencies ?? [];
  const many = series.length > 1;

  return (
    <div className={styles["overview"]}>
      {performance.isPending && (
        <PerformanceView
          title="Performance"
          isPending
          isError={false}
          performance={undefined}
        />
      )}
      {performance.isError && (
        <PerformanceView
          title="Performance"
          isPending={false}
          isError
          performance={undefined}
        />
      )}
      {series.map(item => (
        <div key={item.currency} className={styles["combined"]}>
          <CombinedValue item={item} accounts={brokerage} />
          <PerformanceView
            title={many ? `Performance (${item.currency})` : "Performance"}
            isPending={false}
            isError={false}
            performance={item}
          />
        </div>
      ))}
      <h2 className={styles["section-title"]}>Accounts</h2>
      {brokerage.map(account => <AccountHoldings key={account.id} account={account} openBooking={setBooking} />)}
      {booking && <BookingDialog transactionId={booking} close={() => setBooking(null)} />}
    </div>
  );
}

function CombinedValue({
  item,
  accounts
}: {
  item: CombinedBrokeragePerformance["currencies"][number];
  accounts: Account[];
}) {
  const locale = useLocale();
  const value = accounts.filter(account => account.currency === item.currency).reduce((sum, account) => sum + (account.balance_minor ?? 0), 0);

  return (
    <section className={clsx(ui["panel"], styles["summary"])} aria-label={`Combined value in ${item.currency}`}>
      <span className={styles["label"]}>Combined value · {item.account_ids.length === 1 ? "1 account" : `${item.account_ids.length} accounts`}</span>
      <strong className={styles["value"]}>{money(value, item.currency, locale)}</strong>
      <ChangeFigures
        summary={item.summary}
        currency={item.currency}
        stacked
        showTotal={false}
      />
    </section>
  );
}

/** One brokerage account: a heading row linking to its page with value and gain, then its holdings in the account's table. */
function AccountHoldings({
  account,
  openBooking
}: {
  account: Account;
  openBooking: (transactionId: string) => void;
}) {
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
        <span className={styles["account-figures"]}>
          {trades.data && <strong>{money(trades.data.valuation.value_minor, account.currency, locale)}</strong>}
          {trades.data && held.length > 0 && <small className={clsx(trades.data.summary.total.gain_minor > 0 && ui["positive"])}>{signedMoney(trades.data.summary.total.gain_minor, account.currency, locale)} total</small>}
        </span>
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
      {trades.isError && <FormError failure={toFailure(trades.error)} />}
      {trades.data && (held.length ? (
        <HoldingsTable
          label={`Holdings of ${account.name}`}
          holdings={held}
          trades={trades.data.trades}
          securities={securities.data?.securities ?? []}
          currency={account.currency}
          openBooking={openBooking}
        />
      ) : <p className={styles["note"]}>No holdings yet.</p>)}
    </section>
  );
}
